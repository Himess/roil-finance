# Roil — Roadmap

**Last updated:** 2026-04-17 (v0.3.3)

---

## Phase 1: Foundation — COMPLETE

### Smart contracts (Daml)
- 10 modules: `Portfolio`, `DCA`, `RewardTracker`, `FeaturedApp`, `TokenTransfer`, `TransferPreapproval`, `Treasury`, `Whitelist`, `Governance`, `Types`
- **157 Daml test scripts** across 10 test modules (`test/daml/Test*.daml`)
- Daml-LF 3.x compliance (contract keys removed)
- Splice DAR integration: `splice-api-featured-app-v1`, `splice-api-token-holding-v1`, `splice-api-token-metadata-v1`, `splice-api-token-transfer-instruction-v1`

### Backend (TypeScript/Express)
- Engine / service / route / middleware layering (`backend/src/`)
- 19 test suites, 258 passing tests
- Canton JSON Ledger API v2 client with atomic circuit breaker, command-dedup cache, fail-soft Zod response validation, command-retry idempotency
- Smart Order Router across Cantex AMM + Temple CLOB
- Price oracle with 3-tier fallback
- Auto-compound (3 reinvestment strategies)
- xReserve USDC bridge (Ethereum ↔ Canton)
- Prometheus metrics, structured logging, OpenTelemetry tracing

### Frontend (React 19 + Vite)
- Private repo `Himess/roil-app`, deployed to Vercel at `roil.app`
- 6 authenticated pages + docs pages + landing page
- Persistent TestNet `NetworkBadge` + two-state `DemoBanner`
- Route guard (`ProtectedRoute` soft + `requireAuth` hard)
- xReserve deposit/withdraw UI with viem
- Passkey (WebAuthn) + Google + Canton Wallet auth
- Dark mode, mobile responsive

---

## Phase 2: DEX Aggregation — COMPLETE

- Cantex AMM integration (Ed25519 auth + secp256k1 swap signing)
- Temple Digital Group Orderbook (CLOB with limit orders)
- Net-output (output − fee) best-price selection
- Pre-swap slippage protection
- Circuit breakers for each upstream

---

## Phase 3: TestNet — LIVE (2026-04-17)

- DAR v0.3.3 uploaded to Canton TestNet validator
- Backend at `https://api.roil.app` (Caddy + Let's Encrypt + systemd)
- Frontend at `https://roil.app` (Vercel, env-driven network switch)
- Splice v0.5.18 validator
- CIP-0056 TransferInstruction factory integrated
- CIP-0047 Activity Marker V2 path wired (awaiting GSF `FeaturedAppRight` registration)

### Wave 1/2 hardening (pre-FA submission)
- Backend: idempotency per-key lock, ledger pagination (50k default), admin-party allocation validator, circuit-breaker atomic state + single-probe half-open, rate-limiter bounded Map with LRU eviction, command-dedup TTL cache, Canton API fail-soft Zod schemas, xReserve/stream authenticated
- Daml: `TransferPreapproval.provider` promoted to signatory; `Treasury.UpdateBalances` optimistic concurrency; `FeaturedApp.RecordActivity` in-contract dedup + activityId + activityWeight bounds
- Ops: runbook with MainNet cutover, hardened systemd unit, branch protection, Prometheus alert rules, complete `.env.example`

---

## Phase 4: MainNet — 2026-04-20 CUTOVER

### Pre-cutover (by 2026-04-19)
- [x] `docs/runbook.md` §8 complete (MainNet cutover)
- [x] Complete `backend/.env.example` for operator
- [x] DSO fetch command documented
- [x] DAR upload path corrected (`/v2/packages`)
- [ ] MainNet VPS provisioned (Docker + Splice 0.5.18)
- [ ] UFW firewall rules applied
- [ ] Caddy TLS cert for MainNet API subdomain
- [ ] 5-minute pitch video recorded

### Cutover day (2026-04-20)
- [ ] Pedro onboarding secret applied
- [ ] MainNet validator healthy (6/6 containers)
- [ ] MainNet DSO party fetched + backend `.env` populated
- [ ] DAR v0.3.3+ uploaded and vetted
- [ ] Backend deployed with hardened systemd unit
- [ ] Frontend `VITE_BACKEND_URL` flipped to MainNet API
- [ ] `/health` green on MainNet

### Post-cutover (2026-04-20 → 2026-05-04)
- [ ] Featured App submission via canton.foundation/featured-app-request
- [ ] Dev Fund grant PR on canton-foundation/canton-dev-fund
- [ ] Postgres nightly `pg_dumpall` backup automation
- [ ] Production monitoring stack running (Prometheus + Grafana + alertmanager)
- [ ] First 100 users onboarded (target)

---

## Phase 5: Post-MainNet (Q2–Q3 2026)

### Ecosystem compliance
- **CIP-0104 Increment 4** (end of Jun 2026): full traffic-based reward transition — our marker flow stays intact, add per-transaction reward preview
- **Canton Protocol 35 LSU** (mid-Jun 2026): automatic via Splice 0.6.x — monitor, no code change expected
- **Splice 0.5.16 → 0.5.18 MainNet enforcement** (2026-05-05): we're already on 0.5.18

### Product
- CIP-0056 Allocation/DvP: `AllocationRequest.I for Portfolio` interface instance
- Stop-loss / take-profit orders
- Multi-portfolio per user
- Real yield source integration (Alpend, ACME lending)
- Cross-chain rebalance via Chainlink CCIP
- Governance voting for platform parameter changes (move from platform-only)

### Institutional
- RWA expansion: tokenized gold, silver, treasury bonds (as DA partners go live)
- Compliance module (KYC/AML gate for institutional clients)
- Institutional dashboards

### Technical hardening
- Portfolio `PriceCondition` on-chain oracle contract (remove backend trust)
- `Governance.CanRebalance` consuming choice with short-lived token (race-free)
- Treasury custody proof contract (replace backend-trusted `UpdateBalances`)
- Persist DCA `lastExecutionCache` to Postgres (remove restart ambiguity)
- AI portfolio optimization

---

## Canton-Unique Advantages

1. **Private portfolio management** — holdings, trades, strategies invisible to counterparties via Canton's sub-transaction privacy
2. **Deterministic settlement** — Daml contracts guarantee execution correctness at ledger level
3. **Privacy-preserving leaderboard** — prove performance without revealing positions
4. **Verifiable authorization** — Daml's signatory/observer type system enforces multi-party consent
5. **Featured App Rewards** — per-transaction CC earnings from GSF (CIP-0047 + CIP-0104)
6. **CIP-0056 Compliance** — atomic token transfers via TransferInstruction factory

---

## Links

- **Live app:** https://roil.app
- **Backend:** https://api.roil.app
- **Public repo:** https://github.com/Himess/roil-finance
- **Frontend (private):** github.com/Himess/roil-app
