# Roil — Known TODOs

Living document of deferred work. Each item documents **why it's deferred**,
**how to pick it up**, and **when it blocks** (if ever).

---

## v0.4 — Post-MainNet hardening

### T-01 · Portfolio `PriceCondition` on-chain oracle

**What:** `main/daml/Portfolio.daml:149-153` — `PriceCondition _ -> pure ()`
skips on-chain price validation. The backend asserts "current price matches
condition" externally; a compromised backend could trigger rebalances at
fabricated prices.

**Why deferred:** Canton ecosystem has no standardised oracle contract
pattern yet (no Chainlink equivalent). Writing our own single-source oracle
re-centralises the trust we're trying to remove.

**Plan:**
1. Design per-asset oracle source policy:
   - Canton-native (CC) → Cantex + Temple mid-price (on-chain)
   - Wrapped (CBTC, ETHx, SOLx) → CoinGecko + Binance REST (off-chain,
     signed by a dedicated oracle party)
   - Stablecoin (USDCx) → fixed $1.00 with ±1% circuit breaker
2. Introduce `PriceOracle.daml` template: signed (price, timestamp, source)
   entries with 60s TTL.
3. Portfolio.`InitiateRebalance` re-checks the oracle in the `PriceCondition`
   branch before exercising.

**Blocks:** Only if a malicious backend operator is in the threat model.
v0.3 trust model is "operator-trusted", explicitly documented in SECURITY.md.

**Estimate:** ~1 week (Daml + backend + Daml tests).

---

### T-02 · Governance `CanRebalance` → consuming-ticket pattern

**What:** `main/daml/Governance.daml:152-155` — `nonconsuming CanRebalance`
returns Bool. Backend calls `CanRebalance → true → InitiateRebalance`
sequentially; an admin `EmergencyFreeze` between the two calls still lets
the rebalance proceed because nothing consumes the Bool.

**Why deferred:** Theoretical race (ms window, rare admin action). All four
reviewers agreed the risk is low.

**Plan:**
1. Add consuming `ReserveRebalance` choice on `GovernanceConfig` that creates
   a short-lived `RebalanceTicket` contract (~30s expiry).
2. `Portfolio.InitiateRebalance` consumes the ticket. Missing/expired ticket
   → rebalance fails.
3. `EmergencyFreeze` archives all outstanding tickets.

**Blocks:** Never for production safety at current scale. Would tighten the
story for enterprise audits.

**Estimate:** ~1 day (Daml refactor + 3 tests + backend wrapper update).

---

### T-03 · Multi-instance backend distributed lock

**What:** Backend runs single-process. If we scale horizontally (2+ backend
replicas behind a load balancer for HA), cron jobs will race — two replicas
try to execute the same DCA schedule / rebalance / reward distribution at
the same second.

**Why deferred:** We have zero MainNet users on day one. Single-instance is
correct until we hit ~500 active users or uptime SLA requirements push us
to HA.

**Plan:**
1. Add Redis dependency (already optional via `REDIS_URL` for rate limiter).
2. Implement `utils/distributed-lock.ts` with SETNX + TTL.
3. Wrap cron callbacks: acquire-or-skip pattern.
4. For per-schedule locks (DCA execution), key by `dca:${scheduleId}`.
5. Replace the in-process `executingSchedules` Map in `dca.ts` with the
   distributed lock.

**Blocks:** Horizontal scaling only. Also unlocks blue/green deploys without
cron double-fire.

**Estimate:** ~2 days.

---

### T-04 · Oracle centralisation — multi-source aggregation

**What:** `backend/src/services/price-oracle.ts` — single backend process
polls Cantex + Temple + CoinGecko and feeds prices to every downstream
contract. Compromise surface: one process.

**Why deferred:** Related to T-01. Real solution needs 3+ independent oracle
parties signing attestations on-chain (Chainlink pattern). Canton doesn't
have this primitive standardised.

**Plan:**
1. Coordinate with 2 other Canton validators to run sibling oracle processes.
2. Each publishes `PriceAttestation` contracts signed by their own party.
3. Backend picks the median of 3 most-recent attestations per asset.
4. Reject contracts if fewer than 2 attestations exist for an asset.

**Blocks:** Same as T-01. Only a threat if a malicious operator is in-scope.

**Estimate:** ~1–2 weeks (depends on partner coordination).

---

### T-05 · `GOOGLE_CLIENT_ID` production setup

**What:** Backend `/api/auth/google/verify` returns 503 until
`GOOGLE_CLIENT_ID` is set. Google login does not work in prod.

**How to fix (5 min):**
1. https://console.cloud.google.com/apis/credentials → **Create Credentials**
   → OAuth client ID → Web application.
2. **Authorised JavaScript origins:** `https://roil.app` (+
   `https://www.roil.app` if used, `http://localhost:5173` for dev).
3. **Authorised redirect URIs:** `https://roil.app/auth/google/callback`.
4. Copy the `xxxxxxxx-xxxxxxxx.apps.googleusercontent.com` value.
5. On TestNet/MainNet:
   ```bash
   sed -i "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=<paste>|" \
     /opt/roil-backend/.env
   systemctl restart roil-backend
   ```
6. On Vercel (frontend): same value as `VITE_GOOGLE_CLIENT_ID` env var.

**Blocks:** Google login only. Passkey + email auth are unaffected.

**Estimate:** 5 minutes once the user has Google Cloud access.

---

### T-06 · Slack Alertmanager webhook wiring

**What:** Alertmanager runs in null-receiver mode on TestNet — alerts fire
and are queryable at `http://localhost:9093/api/v2/alerts` via SSH tunnel,
but nothing is delivered externally.

**How to fix (5 min):**
1. Slack workspace → https://api.slack.com/apps → **Create New App** →
   "Roil Alerts".
2. **Incoming Webhooks** → Activate → **Add New Webhook to Workspace** →
   select `#roil-alerts` channel → Allow.
3. Copy the webhook URL (`https://hooks.slack.com/services/T…/B…/X…`).
4. On TestNet:
   ```bash
   ssh root@159.195.78.106
   export ALERTMANAGER_SLACK_WEBHOOK_URL='https://hooks.slack.com/services/...'
   sed "s|__SLACK_WEBHOOK_URL__|$ALERTMANAGER_SLACK_WEBHOOK_URL|" \
     /root/monitoring/alertmanager.slack.yml > /root/monitoring/alertmanager.yml
   docker restart roil-alertmanager
   ```
5. Verify: trigger a synthetic alert by stopping the backend briefly —
   `RoilBackendDown` should arrive in Slack within 2 minutes.

**Blocks:** External alert delivery only. Alerts are still visible in the
Prometheus/Alertmanager web UI (SSH-tunneled) without this step.

**Estimate:** 5 minutes.

---

### T-07 · Migrate remaining `Canton::Admin` frontend callsites

**What:** Backend `normalizeInstruments` middleware (v0.3.3) rewrites the
`Canton::Admin` sentinel to real admin parties at request-entry, so ledger
submissions are correct. However, 98 frontend call sites still construct
`{ symbol, admin: 'Canton::Admin' }` literals. Display-only surfaces
(portfolio templates) show the sentinel to the user.

**Plan:**
1. Replace hardcoded `'Canton::Admin'` with `adminFor(symbol)` from
   `InstrumentsContext` in display-only call sites.
2. For static `config.ts` template definitions, accept the sentinel and let
   the backend normalise (current behaviour is fine).

**Blocks:** Purely cosmetic — the string appears only in dev-tools inspection
of static templates.

**Estimate:** ~2 hours.

---

## Opportunistic cleanup (no priority)

- **Frontend lint warnings (45).** Pre-existing technical debt (unused
  imports, missing `useEffect` deps, `any` types). CI passes on warnings.
  Tackle as a rainy-day PR.
- **E2E test coverage.** Current suite is 10 navigation-heavy scenarios;
  no auth/bridge/swap flow coverage. Add Playwright tests for the three
  critical paths.
- **Node 20 actions in CI.** `actions/checkout@v4` etc. use Node 20 runner
  which reaches EOL 2026-09-16 on GitHub Actions. Switch to Node 24 runner
  via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` when Node 20 support is
  actually pulled.
- **Load test baseline.** 15-minute 100-rps autocannon run against TestNet
  to pin p50/p95/p99 before MainNet. See `docs/load-test-<date>.md` for
  results once recorded.

---

*Last updated: 2026-04-18 · v0.3.3 on TestNet · MainNet cutover 2026-04-20*
