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

## 4. DAR upload (DevNet → TestNet / MainNet)

Build on DevNet so the SDK version matches what the validator expects, then
upload via the **Canton JSON Ledger API** (`/v2/packages`). The older
`/api/validator/v0/admin/package` path returns 404 on Splice 0.5.18+; do not
use it.

```bash
# On local workstation — ship sources up to DevNet
cd <repo>
tar -cf /tmp/roil-daml.tar main/daml main/daml.yaml main/dars test/daml test/daml.yaml
scp /tmp/roil-daml.tar root@159.195.71.102:/tmp/

# On DevNet VPS
ssh root@159.195.71.102
cd /root/roil-build
tar -xf /tmp/roil-daml.tar
export PATH="$HOME/.daml/bin:$PATH"
cd main  && daml build --no-legacy-assistant-warning    # → .daml/dist/roil-finance-<version>.dar
cd ../test && daml build --no-legacy-assistant-warning
daml test --no-legacy-assistant-warning                 # expect "All tests passed"

# Transfer DAR to TestNet / MainNet
scp /root/roil-build/main/.daml/dist/roil-finance-<version>.dar \
    root@159.195.78.106:/root/

# --- Upload on TestNet / MainNet ---------------------------------------------
# Splice nginx has a 1MB client_max_body_size by default; patch it once per
# container recreation (see §10 Known nginx-patch).
ssh root@159.195.78.106
cd /root/splice-node/docker-compose/validator
TOKEN=$(python3 get-token.py administrator 2>&1 | tail -1)

# Authoritative upload path (Canton JSON Ledger API v2).
curl -sS -X POST http://localhost/v2/packages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Host: json-ledger-api.localhost" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @/root/roil-finance-<version>.dar
# Success response is `{}`. On failure Canton returns a NOT_VALID_UPGRADE_PACKAGE
# error with a specific `upgradeError` explaining what the upgrade checker
# rejected (non-Optional new field, non-end-of-record addition, etc.).

# Verify the new package is vetted
curl -sS http://localhost/v2/packages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Host: json-ledger-api.localhost" | jq '.packageIds | length'

# Restart backend so template-ID resolution picks up the new package hash
systemctl restart roil-backend
curl -s http://localhost:3001/health
```

**Daml package upgrade rules (Canton Protocol 34+)**
Any new template field must be (a) `Optional` and (b) appended at the
**end** of the record. Any new choice parameter must also be `Optional`.
Violating either rule results in `NOT_VALID_UPGRADE_PACKAGE`. Archived
contracts from the prior version keep their original schema; new fields
default to `None` on upgraded views.

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

## 8. MainNet cutover (2026-04-20)

MainNet VPS (`roil-mainnet`, `159.195.76.220`) ships bare. The cutover is a
one-off procedure — do it with the onboarding secret open in front of you and
verify each step before moving on. Keep DevNet running throughout in case
rollback is needed.

### 8.1 Prerequisites
- SSH into the MainNet VPS.
- **Onboarding secret** from Pedro (DA / GSF contact) — keep in a password
  manager, do not paste into chat.
- Current Splice release tarball (`0.5.18_splice-node.tar.gz` or later).
- Target MainNet SV URL (typically `https://sv.sv-1.global.canton.network.sync.global`).
- Target MainNet Scan URL (typically `https://scan.sv-1.global.canton.network.sync.global`).
- Caddyfile for `api.roil.app` (copy from TestNet `/etc/caddy/Caddyfile`).

### 8.2 Install Docker + Splice
```bash
# On MainNet VPS
apt-get update && apt-get install -y docker.io docker-compose-v2 jq curl python3
systemctl enable --now docker

# Copy the Splice node tarball (from workstation or DevNet)
scp splice-node-0.5.18.tar.gz root@159.195.76.220:/root/
ssh root@159.195.76.220
cd /root && tar -xzf splice-node-0.5.18.tar.gz
cd splice-node/docker-compose/validator
```

### 8.3 Prepare `.env`
Append the persistent env vars (`start.sh` does not write these to `.env` on
its own — they must be exported or written up-front). The PARTY_HINT value
is permanent; pick it deliberately.

```bash
cat >> /root/splice-node/docker-compose/validator/.env <<'ENVEOF'

# MainNet bootstrap (2026-04-20)
IMAGE_TAG=0.5.18
MIGRATION_ID=1
SPONSOR_SV_ADDRESS=https://sv.sv-1.global.canton.network.sync.global
SCAN_ADDRESS=https://scan.sv-1.global.canton.network.sync.global
ONBOARDING_SECRET=<paste-from-Pedro>
PARTICIPANT_IDENTIFIER=roil
PARTY_HINT=roil
SPLICE_APP_UI_NETWORK_NAME=MainNet
SPLICE_APP_UI_NETWORK_FAVICON_URL=
SPLICE_APP_UI_AMULET_NAME=Canton Coin
SPLICE_APP_UI_AMULET_NAME_ACRONYM=CC
SPLICE_APP_UI_NAME_SERVICE_NAME=Canton Name Service
SPLICE_APP_UI_NAME_SERVICE_NAME_ACRONYM=CNS
ENVEOF
chmod 600 /root/splice-node/docker-compose/validator/.env
```

### 8.4 Bootstrap the validator
```bash
cd /root/splice-node/docker-compose/validator
# start.sh reads env vars; -p = party hint, -m = migration id, -w = wait for health
./start.sh \
  -s "$SPONSOR_SV_ADDRESS" \
  -o "$ONBOARDING_SECRET" \
  -p roil \
  -m 1 \
  -w
# First run can take 3–5 minutes as the participant syncs protocol state.
docker compose ps  # → all 6 containers "healthy"
```

### 8.5 Fetch the MainNet DSO party
The DSO party ID differs per network; production `.env` needs the MainNet
value.

```bash
cd /root/splice-node/docker-compose/validator
TOKEN=$(python3 get-token.py administrator 2>&1 | tail -1)
DSO_PARTY=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "Host: wallet.localhost" \
  http://localhost/api/validator/v0/scan-proxy/dso-party-id \
  | jq -r '.dsoPartyId')
echo "MainNet DSO: $DSO_PARTY"
```

Record this in the secrets manager. You will need it for the backend `.env`.

### 8.6 Patch nginx for DAR upload (once per container recreation)
Splice nginx defaults to a 1 MB body cap. Our DAR is ~1.1 MB, so upload 413s
without this patch.

```bash
docker exec splice-validator-nginx-1 sh -c '
  awk "/^http {/ {print; print \"  client_max_body_size 20M;\"; next} {print}" \
    /etc/nginx/nginx.conf > /tmp/n.conf && cp /tmp/n.conf /etc/nginx/nginx.conf \
    && nginx -t && nginx -s reload
'
```

### 8.7 Upload the DAR
Follow §4 (`/v2/packages` path). Verify `packageIds` length increased.

### 8.8 Install the backend
```bash
# On the workstation
cd backend && npm ci && npm run build
tar -czf /tmp/roil-backend-mainnet.tar.gz dist package.json package-lock.json
scp /tmp/roil-backend-mainnet.tar.gz root@159.195.76.220:/tmp/

# On MainNet VPS
mkdir -p /root/roil-backend && cd /root/roil-backend
tar -xzf /tmp/roil-backend-mainnet.tar.gz
npm ci --omit=dev

# Build .env from the template, populating MainNet-specific values
cp <repo>/backend/.env.example /root/roil-backend/.env
# Edit: CANTON_NETWORK=mainnet, JSON_API_URL=http://localhost:3975,
#       PLATFORM_PARTY=roil::<hash>, CC_ADMIN_PARTY=$DSO_PARTY,
#       USDCX_ADMIN_PARTY=<from Circle>, JWT mode + keys, CC_FALLBACK_PRICE,
#       CANTEX_*, TEMPLE_*, ALLOWED_ORIGINS=https://roil.app,https://api.roil.app
chmod 600 /root/roil-backend/.env

# Install systemd unit (hardened version from repo)
cp <repo>/backend/deploy/roil-backend.service /etc/systemd/system/
# Ensure roil user exists
id -u roil >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin roil
mkdir -p /opt/roil-backend && cp -r /root/roil-backend/* /opt/roil-backend/
chown -R roil:roil /opt/roil-backend /var/log/roil-backend 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now roil-backend.service
systemctl status roil-backend.service
curl -s http://localhost:3001/health | jq
```

### 8.9 Caddy TLS for `api.roil.app` (MainNet subdomain TBD)
Install Caddy, deploy Caddyfile that terminates TLS for the chosen MainNet
API hostname, reverse-proxies to `localhost:3001`. Point Splice nginx at
`127.0.0.1:80` via `HOST_BIND_IP` (as documented on TestNet — see memory
`deploy_topology.md`).

### 8.10 Featured App submission (within 2-week window)
Once MainNet is live and /health is green for 24 hours, submit at
https://canton.foundation/featured-app-request/ using the draft at
`docs/featured-app-application.md`. Deadline: 2026-05-04.

### 8.11 Post-cutover checklist
- [ ] `docker compose ps` on MainNet → 6/6 healthy
- [ ] DSO party captured and backed up
- [ ] DAR v0.3.3+ uploaded and vetted
- [ ] `/health` returns healthy on MainNet
- [ ] `api.<mainnet-domain>` responds with TLS green padlock
- [ ] Frontend env var `VITE_BACKEND_URL` pointed at MainNet
- [ ] Featured App form submitted
- [ ] Dev Fund grant PR submitted
- [ ] Announcement posted to #validator-operations

## 9. TestNet → v0.3.3 upgrade path

The Wave 2 sprint promoted `TransferPreapproval.provider` from observer to
signatory. Canton's upgrade checker accepts this (the field type/position
didn't change), but **existing v0.3.0 preapproval contracts on the ledger
carry the 2-party signatory set baked in**. Exercising those contracts under
the new template shape will fail with an authorization error.

Procedure before or concurrent with the DAR upgrade:

1. Inventory active preapprovals:
   ```bash
   curl -sS http://localhost/v2/state/active-contracts \
     -H "Authorization: Bearer $TOKEN" \
     -H "Host: json-ledger-api.localhost" \
     -H 'Content-Type: application/json' \
     -d '{"eventFormat":{"filtersByParty":{"'"$PLATFORM"'":{"cumulative":[{"identifierFilter":{"TemplateFilter":{"value":{"templateId":"#roil-finance:TransferPreapproval:TransferPreapproval","includeCreatedEventBlob":false}}}}]}},"verbose":false},"activeAtOffset":'$LEDGER_END'}'
   ```
2. For each active preapproval, have either the sender or receiver exercise
   `RevokePreapproval` / `SenderRevokePreapproval` — this archives the 2-party
   contract. Coordinate with users if any are in use.
3. Upload `roil-finance-0.3.3.dar` (§4).
4. Recreated preapprovals under v0.3.3 will automatically have the 3-party
   signatory set.
5. `PreapprovedTransferLog` contracts from v0.3.0/v0.3.1 remain readable with
   `provider = None`. New log entries from v0.3.3+ will populate `Some
   provider`. Backend queries must handle both shapes.

Fresh MainNet deployment does not need this — no pre-existing contracts.

## 10. Known nginx-patch requirement

Splice 0.5.18 nginx defaults to `client_max_body_size 1M`, which rejects
the ~1.1 MB DAR. Apply the 20M patch via `docker exec` (see §8.6) whenever
the nginx container is recreated (image upgrade, `down && up`, etc.). A
long-term fix would be a custom nginx image; not required for launch.
