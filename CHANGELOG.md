# Changelog

## [Unreleased]

### Planned
- MainNet validator onboarding (target: 2026-04-20)
- Featured App application submission (window: 2026-04-20 to 2026-05-04)
- Dev Fund grant PR submission (post-MainNet)
- Nightly Postgres `pg_dumpall` backup automation on MainNet

## [0.3.3] - 2026-04-17

Wave-3 hardening pass — 42 items across backend, Daml, frontend (separate
`Himess/roil-app` repo), ops/docs, and TestNet live state.

### Added
- **Daml:** `FeaturedApp.RecordActivity` now rejects empty/long `activityId` (≤128 chars) and out-of-range `activityWeight` (1–100) to cap per-call loop size. 5 new `TestFeaturedApp` scripts exercise the dedup + bounds paths (duplicate reject, max weight, long id reject, zero weight reject, max-weight accept). Test count: 152 → **157**.
- **Backend:** `POST /api/auth/google/verify` server-side Google ID-token verifier (Google JWKS + audience check + email-verified gate). `GET /api/admin/me` lightweight admin-role probe for frontend UI gating. `GET /api/market/instruments` exposes real asset→admin-party map so the frontend can stop hardcoding placeholder admin strings.
- **Backend:** `buildJwt` exported so `transaction-stream` and `xreserve-client` can mint authenticated ledger requests. All raw `fetch` calls in those services now carry a platform-signed JWT; unauthenticated MainNet participants will no longer silently 401 the SSE stream / xReserve flow.
- **Ops:** `monitoring/docker-compose.monitoring.vps.yml` + `prometheus.vps.yml` for standalone Prometheus+Grafana on systemd-hosted VPS. Grafana admin password is now required via env (no default in repo). Stack live on TestNet scraping `localhost:3001`.
- **Docs:** `docs/runbook.md` §8 MainNet cutover procedure (Docker install, Splice bootstrap, DSO fetch, DAR upload via `/v2/packages`, Caddy, hardened systemd). §9 TestNet v0.3.0→v0.3.3 TransferPreapproval archive migration. §10 nginx `client_max_body_size` patch note.

### Changed
- **Daml:** `main/daml.yaml` drops the unused `splice-api-token-allocation-*-1.0.0.dar` data-dependencies (declared but never imported). Will be re-added in v0.4 with a concrete `AllocationRequest.I for Portfolio` interface instance.
- **Backend:** `ledger.queryContracts` default limit raised from 2000 → 50,000 and the truncation warning is now a synchronous `logger.warn` (no more lazy dynamic import). DCA cold-start cache hydration now iterates via `iterateActiveContracts` so it handles the unbounded case.
- **Backend:** `rebalance` engine now uses `decimalMul`/`decimalSub` for platform-fee math (removes JS-float precision loss on small-amount tokens like CBTC). `FailRebalance` in the catch block now targets the EXACT request this call initiated rather than the first `Pending|Executing` request for the platform (prevented nuking concurrent rebalances belonging to other users).
- **Backend:** Cron callbacks (DCA/rebalance, rewards, compound) now skip when `isPlatformPaused()` — `/api/admin/emergency-freeze` is no longer cosmetic.
- **Backend:** Monthly `distributeMonthlyRewards` has an in-memory "already-done for month X" guard on top of Daml-level archive — prevents noisy retry failures on cron double-fire.
- **Backend:** `SmartRouter.getBestQuote` sorts by `outputAmount − fee` (true net) rather than raw output; fee-heavy venues no longer win when a cheaper venue exists.
- **Backend:** `circuit-breaker.ts` exposes `getState()` to the metrics registry; a 10s ticker in `index.ts` pushes current state to Prometheus. The breaker gauge is no longer stuck at 0.
- **Backend:** `xreserve` router fixes the `requireParty` factory bug (was invoked without parentheses → every authenticated xReserve route hung until timeout on non-localnet).
- **Backend:** `/var/log/roil-backend*` tightened to `0640 roil:roil` on live TestNet.
- **Backend:** `CC_FALLBACK_PRICE` no longer has a hardcoded `0.15` default — the engine throws on missing oracle + missing env var so operators must set a sane value.
- **Ops:** `scripts/deploy-dar.sh` picks the highest-versioned DAR from `main/.daml/dist/` by default (was hardcoded to the legacy 0.2.0 path). `backend/.env.example` is now a complete MainNet operator template with all 9 admin-party vars, traffic config, and JWT key paths. `.github/workflows/ci.yml` bumped to Node 22 (Node 20 EOL 2026-04-30). Branch protection tightened with `strict: true`, required PR review (1 admin-bypassable), and `Docker Build Validation` in required checks.
- **Ops:** systemd unit file now reflects the live TestNet layout (User=roil, /opt/roil-backend, full `ProtectSystem=strict` + ExecStartPre `-` prefix). TestNet migrated to this hardened layout on 2026-04-17.
- **Docs:** `ROADMAP.md` rewritten for v0.3.3 reality (10 modules, 157 tests, Phase 3 = TestNet Live, Phase 4 = MainNet 04-20). `TREASURY.md` updated with v0.3.2+ `UpdateBalances` optimistic concurrency. `docs/devnet-application.md` archived to `docs-internal/` (historical). `docs/featured-app-application.md` version-drift corrected (v0.5.18, DAR v0.3.3, 157 tests).

### Fixed
- Transaction stream now uses `envelope.transaction.events` from v2 `/v2/updates` (the prior `eventsById` shape was never produced by v2 — engine events had never fired).
- `middleware/idempotency.ts` guards `res.once('close', …)` with a `typeof` check so test-env Response doubles without event emitters don't throw (blocked CI before).

### Security
- Google ID tokens are now verified server-side against Google's JWKS before minting a wallet. Client-side decode alone (previous behaviour) was trivially forgeable by any script in the page.
- Frontend `ProtectedRoute` supports `requireAdmin`; `/admin` route is gated by a backend-authoritative `isAdmin` flag. Backend still enforces on every admin endpoint.
- Runtime network-mismatch guard in the frontend hard-refuses to render when `backend.health.network !== config.network`. Prevents launch-day foot-gun of a frontend build pointed at the wrong Canton network.
- `vercel.json` ships full security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) — prior Vercel deploy had none.
- `monitoring/docker-compose.monitoring*.yml` require `GRAFANA_ADMIN_PASSWORD` from env; no default password in repo.

## [0.3.2] - 2026-04-17

Post-audit hardening pass. DAR v0.3.2 built and deployed to TestNet.

### Added
- **TestTypes** Daml test module — calcMaxDrift edge cases (empty / zero-value holdings), tier boundaries, duplicate-asset detection
- **CommandDedupCache** — backend-side dedup so application-level retries collapse into the same Canton `commandId`, layered on top of Canton's native 10-minute dedup window
- **Canton JSON API response validation** — fail-soft Zod schemas on `/state/ledger-end`, `/state/active-contracts`, `/commands/submit-and-wait`, `/packages` catch upstream drift without causing regressions
- **Prometheus alert rules** — backend down, circuit-open spikes, ledger 5xx rate, DCA lag, idempotency timeout rate
- **Frontend CI** (in `Himess/roil-app`) — build, test, lint, e2e on every PR
- **Rollback runbook** — `docs/runbook.md` with deploy, rollback, DAR upload, common incident procedures

### Changed
- **Daml: `TransferPreapproval`** — provider is now a signatory (was observer). Every preapproval, execution, and log entry is authorized on-chain rather than enforced only by backend code. `PreapprovedTransferLog` also adds provider as observer for reward audit.
- **Daml: `Treasury.UpdateBalances`** — optimistic concurrency via `expectedLastUpdatedAt`. Two concurrent backend workers with stale snapshots can no longer both succeed.
- **Daml: `FeaturedApp.FeaturedAppConfig`** — new `recentActivityIds` field (capped at 1,000 most-recent) rejects duplicate `activityId`s inside the choice, defending against backend retries without relying on contract keys (unavailable in Daml-LF 3.x).
- **Backend: circuit breaker** — atomic state transitions via a generation counter; half-open admits a single probe at a time so concurrent callers cannot corrupt the state machine across `await` boundaries.
- **Backend: rate limiter** — the in-memory Map is now bounded (`RATE_LIMIT_MAX_KEYS`, default 50,000) with LRU eviction and an iteration cap on the cleanup sweep.
- **Monitoring: Prometheus config** — removed stale `rebalancer-frontend` nginx target (frontend moved to Vercel); added commented systemd-context scrape target for the VPS deployments.
- **Docs: README, ARCHITECTURE, SECURITY** — corrected test counts, added TestNet topology section, and converted backend-trusted Daml patterns to an explicit "Known Limitations → Planned on-chain hardening" matrix.

## [0.3.1] - 2026-04-17

Sprint hardening pass — CIP-0056 TransferInstruction factory, 3 new Daml test modules, backend P0 fixes.

### Added
- **Daml: TestDCA, TestWhitelist, TestTransferPreapproval** — 48 new test scripts across three previously-untested modules. Total: 146 passing.
- **CIP-0056 TransferInstruction factory** — `splice-api-token-transfer-instruction-v1` imported as Daml data-dependency; `TokenTransfer` exposes `spliceInstructionCid` field + `LinkSpliceInstruction` / `LinkSwapSpliceInstruction` choices.
- **Backend idempotency per-key lock** — in-flight Promise map collapses concurrent retries into one execution.
- **Backend ledger pagination** — `queryContracts(limit)` with truncation warning + `iterateActiveContracts` async generator.
- **Backend admin-party allocation validator** — engine startup distinguishes real / mock / missing parties and logs a summary.
- **Frontend TestNet transparency** — persistent NetworkBadge, two-state DemoBanner, ProtectedRoute with `requireAuth` for wallet/admin.

### Changed
- systemd unit runs as unprivileged `roil` user (was `root`) with `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`.
- CI DAR artifact path switched from hardcoded `roil-finance-0.2.0.dar` to wildcard + `if-no-files-found: error`.
- Turkish internal strategy documents relocated to `docs-internal/` and gitignored.

### Fixed
- `LandingV2.tsx` — replaced `dangerouslySetInnerHTML` with ES2015 codepoint escapes (XSS vector).

## [0.3.0] - 2026-04-16

TestNet deployment live at `https://api.roil.app` with v0.3.0 DAR uploaded on 2026-04-10.

### Added
- **CIP-0056 TransferInstruction factory** — `splice-api-token-transfer-instruction-v1` integrated as Daml data-dependency; token transfers use Splice factory pattern for atomic settlement (replacing custom log-based transfer)
- **xReserve USDC bridge** — full Ethereum Sepolia ↔ Canton USDCx flow: onboarding, deposit, burn tx recording, attestation polling (60s), mint via `BridgeUserAgreement_Mint`, withdrawal with auto-selected holdings
- **Governance audit log on fee updates** — `UpdateFeeRate` now emits `GovernanceAuditLog` for full audit trail
- **Treasury identical-asset swap guard** — `RequestTreasurySwap` rejects same-asset swaps with explicit `assertMsg`
- **Beneficiary weight distribution** — featured-app engine supports multi-beneficiary rewards with configurable weights
- **Transaction stream fix** — endpoint corrected from `/v2/updates/flat` to `/v2/updates`
- **TransferPreapproval provider** — preapproval template for auto-accept inbound transfers (provider earns Featured App rewards)
- **Production deployment infrastructure** — systemd service (`roil-backend.service`), logrotate (daily, 14-day retention, 100MB cap), unprivileged service user, pre-start health check
- **TLS reverse proxy** — Caddy 2 with Let's Encrypt ACME on TestNet VPS, HTTP→HTTPS 308 redirect, gzip/zstd compression
- **CORS whitelist** — `ALLOWED_ORIGINS` env var (`roil.app`, `api.roil.app`) with credentials support
- **Admin party configuration** — real TestNet DSO party for CC, Digital Asset xReserve operator for USDCx, deterministic mock parties for CBTC/ETHx/SOLx/XAUt/XAGt/USTb/MMF (until production issuers available)

### Changed
- Backend `.env` `JWT_SECRET` rotated to 88-char openssl-generated random (from placeholder)
- `/root/roil-backend/.env` permissions tightened to 0600
- Splice nginx bound to `127.0.0.1:80` (via `HOST_BIND_IP`) to free 80/443 for Caddy; wallet/ANS UIs accessible via SSH tunnel only
- Backend idempotency middleware now uses per-key in-flight promise lock to prevent duplicate execution under concurrent requests
- Ledger active-contract queries now use offset-pagination loop (no more silent 50-result truncation)
- Engine startup validates admin parties are allocated on ledger (not just env-present)
- Frontend: persistent TestNet badge in header, always-visible demo-mode banner when data originates from fallback
- Frontend: protected routes enforce `isLoading` check before rendering authenticated content

### Fixed
- `LandingV2.tsx` removed unsafe `dangerouslySetInnerHTML` for step icons (XSS vector)
- CI workflow `.github/workflows/ci.yml` DAR upload path now uses wildcard (was hardcoded to `roil-finance-0.2.0.dar`)
- Internal Turkish strategy documents (`CANTON-ECONOMICS-REPORT.md`, `REPORT.md`) moved to private `docs-internal/` directory and excluded from git

### Security
- systemd unit runs as unprivileged `roil` user instead of root
- `.env` files and private reports added to `.gitignore`

## [0.2.0] - 2026-03-26

### Added
- Treasury swap system with oracle pricing and spread fees
- Whitelist system with invite codes (max 1000 users)
- Governance module (freeze, pause, fee updates, audit logs)
- TransferPreapproval contract for auto-accept patterns
- Featured App integration for GSF App Rewards
- Smart Order Router (Cantex AMM + Temple CLOB)
- Compound engine with 3 reinvestment strategies
- Circuit breaker pattern for external service calls
- Prometheus + Grafana monitoring stack
- Comprehensive security middleware (rate limiting, prototype pollution protection)

### Changed
- Upgraded from 6 to 10 Daml contract modules
- Removed contract keys for Daml-LF 3.x compatibility
- Backend restructured with engine/service/route separation

## [0.1.0] - 2026-02-15

### Added
- Initial release
- Portfolio management with drift-based rebalancing
- DCA scheduling (hourly/daily/weekly/monthly)
- Reward tier system (Bronze/Silver/Gold/Platinum)
- Token transfer (CIP-0056)
- Basic Cantex DEX integration
