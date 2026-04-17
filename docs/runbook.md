# Roil — Operations Runbook

Operational playbook for deploying, rolling back, and diagnosing the Roil backend on TestNet / MainNet VPS nodes.

## 1. Nodes & surface

| Node | Host | Role |
|---|---|---|
| DevNet | `159.195.71.102` (roil-devnet) | Daml DAR build + pre-deploy validation. No backend process. |
| TestNet | `159.195.78.106` (roil-testnet) | Live `api.roil.app` backend + Splice validator. |
| MainNet | `159.195.76.220` (roil-mainnet) | Provisioning on 2026-04-20. |

`journalctl -u roil-backend` is the authoritative log source on TestNet (the file `/root/roil-backend.log` is legacy).

## 2. Backend deploy (TestNet)

```bash
# On local workstation
cd backend
npm ci
npm run build                       # produces dist/
tar -czf /tmp/roil-backend-dist.tar.gz dist package.json package-lock.json
scp /tmp/roil-backend-dist.tar.gz root@159.195.78.106:/tmp/

# On TestNet VPS
cp -r /root/roil-backend /root/roil-backend.prev          # point-in-time backup
tar -xzf /tmp/roil-backend-dist.tar.gz -C /root/roil-backend --overwrite
cd /root/roil-backend && npm ci --production
systemctl restart roil-backend
systemctl status roil-backend --no-pager
journalctl -u roil-backend -n 50 --no-pager
curl -s http://localhost:3001/health | jq
```

Verification must show:
- `systemctl is-active roil-backend` → `active`
- `/health` returns `{"status":"healthy", checks.{server,ledger,cantex} = "healthy"}`
- No `FATAL` lines in the last 50 journald entries
- External: `curl -s https://api.roil.app/health` mirrors the local output

## 3. Rollback (backend)

If the new build fails health checks or exhibits regressions within 10 minutes of deploy:

```bash
# On TestNet VPS
systemctl stop roil-backend
rm -rf /root/roil-backend
mv /root/roil-backend.prev /root/roil-backend
systemctl start roil-backend
systemctl status roil-backend --no-pager
```

The `.prev` directory is created by the deploy step above and holds the previously-working tree. Confirm `/health` returns to green before closing the incident.

## 4. DAR upload (DevNet → TestNet)

Build on DevNet so the SDK version matches what the validator expects.

```bash
# On DevNet VPS
cd /root/roil-finance/main
daml build                                  # outputs .daml/dist/roil-finance-<version>.dar
cd /root/roil-finance/test
daml test                                   # expect "All tests passed"

# Transfer
scp /root/roil-finance/main/.daml/dist/roil-finance-<version>.dar root@159.195.78.106:/root/

# On TestNet VPS
cd /root/splice-node/docker-compose/validator
TOKEN=$(python3 get-token.py administrator)
curl -sS -X POST http://localhost/api/validator/v0/admin/package \
  -H "Authorization: Bearer $TOKEN" \
  -F "darFile=@/root/roil-finance-<version>.dar"

# Update backend env to reference the new package (if version bumped)
sed -i "s/DAML_PACKAGE_VERSION=.*/DAML_PACKAGE_VERSION=<version>/" /root/roil-backend/.env
systemctl restart roil-backend
```

## 5. Common incidents

### `roil-backend` fails to start
1. `journalctl -u roil-backend -n 200 --no-pager` — look for `FATAL`/`Error:` on the first lines after the unit start.
2. Typical causes: missing env var (compare against `backend/.env.example`), unreachable JSON API, expired JWT signing key.
3. Validate env permissions: `stat -c '%a' /root/roil-backend/.env` must be `600`.

### `/health` returns degraded ledger
1. Confirm the Splice stack: `cd /root/splice-node/docker-compose/validator && docker compose ps` — all six containers should be `healthy`.
2. If the participant is down, `docker compose restart participant` and wait for `healthy`.
3. If the restart does not recover the participant, inspect `docker compose logs participant --tail=200` for crash signatures.

### `/health` returns degraded cantex
1. Cantex outages are usually transient; the circuit breaker trips and logs `breaker=open`.
2. Check the circuit-breaker gauge via `curl -s http://localhost:3001/metrics | grep cantex_breaker_state`.
3. No action is required unless the breaker stays open for >15 minutes — then escalate to the Cantex operator channel.

### `api.roil.app` returns 502
1. Caddy is the edge. `journalctl -u caddy -n 50` and `caddy validate --config /etc/caddy/Caddyfile`.
2. If Caddy is healthy but still 502, the backend is the issue — run the health-check block above.

## 6. Secrets & rotation

- `JWT_SECRET` rotation: `openssl rand -hex 64 > /root/roil-backend/.env.new`, replace the key, restart, then invalidate any issued tokens client-side.
- Admin party refresh (MainNet day): re-run the DSO fetch on MainNet validator and update `CC_ADMIN_PARTY` before restarting.
- Caddy TLS auto-renews via Let's Encrypt; no action needed unless the cert expiry is within 15 days and renewal is failing (check `journalctl -u caddy --since '-7 days' | grep -i acme`).

## 7. Observability quick links

- `/metrics` on the backend exposes Prometheus counters for request duration, circuit state, DCA/reward events.
- Dashboards live under `monitoring/grafana/` and auto-provision when the compose monitoring profile is started.
- Alert rules in `monitoring/alerts.yml` cover backend hangs, circuit-open spikes, ledger 5xx, DCA lag. Deploy with `prometheus --config.file=monitoring/prometheus.yml`.
