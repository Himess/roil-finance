# Changelog

## [Unreleased]

### Planned
- MainNet validator onboarding (target: 2026-04-20)
- Featured App application submission (window: 2026-04-20 to 2026-05-04)

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
