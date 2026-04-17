# Roil Finance — Featured App Application

**Submission target:** Canton Foundation · [canton.foundation/featured-app-request](https://canton.foundation/featured-app-request/)
**Submission window:** 2026-04-20 → 2026-05-04 (within two weeks of MainNet launch)
**App name:** Roil Finance
**Applicant:** Himess (contact: semih@roil.app)
**Live URL:** https://roil.app
**Backend API:** https://api.roil.app
**Repositories:** [github.com/Himess/roil-finance](https://github.com/Himess/roil-finance) (public, Daml + backend) · `Himess/roil-app` (private, frontend)

---

## 1. One-line Pitch

Roil is a privacy-preserving, automated portfolio manager on Canton Network — drift-based rebalancing, DCA, and yield compounding across CC, USDCx, cBTC and tokenized RWAs, built on Canton's sub-transaction privacy so trade sizes and strategies never leak on-chain.

## 2. What Roil Does

- **Portfolio templates + custom allocation** — 8 curated strategies (Conservative, Balanced, BTC-ETH Maxi, Precious Metals, Institutional, All-Weather, Stablecoin Yield, Crypto Basket) plus a fully custom builder across 9 Canton-native assets.
- **Drift-based auto-rebalance** — each user sets a drift threshold (e.g. 3%). When portfolio holdings deviate, Roil's backend executes the minimal set of swaps needed to restore target allocation.
- **Smart Order Router** — every swap is quoted against **Cantex AMM** and **Temple CLOB** and routed through whichever venue has better effective price after fees.
- **Dollar-Cost Averaging (DCA)** — hourly, daily, weekly, or monthly recurring buys. Configurable per asset pair.
- **Auto-compound** — staking / lending / LP yield is automatically reinvested per user-selected strategy.
- **USDC bridge (xReserve)** — users bring USDC from Ethereum Sepolia (later MainNet) into Canton as USDCx through the Digital Asset / Circle xReserve atomic pattern.
- **Loyalty tiers** — Bronze → Silver → Gold → Platinum based on transaction activity, with fee rebates that grow with usage.
- **Governance & treasury** — on-chain pause/unpause, fee updates, emergency freeze, identical-asset swap guard, immutable audit log.

## 3. Why Canton

Portfolio composition, trade timing, and rebalancing strategy are **sensitive data**. Roil is impossible to build honestly on a transparent L1:

- Target allocations would expose user strategy to copy-traders and MEV.
- Auto-rebalance cadence would telegraph incoming flow to the market.
- RWA holdings (USTb, tokenized gold) would disclose compliance-relevant positions.

Canton's sub-transaction privacy lets Roil keep each user's portfolio confidential while still providing the atomic settlement guarantees institutional users need. This is the specific differentiator that justifies building on Canton rather than any transparent chain.

## 4. Technical Architecture

| Layer | Stack |
|---|---|
| **Smart contracts** | Daml SDK 3.4.11 — 10 modules (1,786 LOC), 146 passing tests (4,300 LOC test coverage). Contract keys removed for Daml-LF 3.x compatibility. |
| **Splice / Canton integration** | `splice-api-featured-app-v1`, `splice-api-token-holding-v1`, `splice-api-token-metadata-v1`, `splice-api-token-transfer-instruction-v1`, `splice-api-token-allocation-v1`, `splice-api-token-allocation-request-v1` — declared as data-dependencies, transfers use the Splice TransferInstruction factory pattern for atomic settlement. |
| **Backend** | TypeScript / Express, Canton JSON Ledger API v2, Node 20, OpenTelemetry, Prometheus metrics, JWT auth (HS256 / RS256 / ES256), circuit breaker + retry with jitter, per-key idempotency locks. |
| **Frontend** | React 19 + Vite + Tailwind, deployed on Vercel with custom domain `roil.app`. Persistent TestNet network badge + demo-mode banner for transparency. |
| **Infrastructure** | 3 Netcup VPS (DevNet, TestNet, MainNet), systemd + logrotate, Caddy reverse proxy with Let's Encrypt TLS. |

## 5. CIP Compliance Matrix

| CIP / Feature | Status | Evidence |
|---|---|---|
| **CIP-0056 Token Standard Holding** | ✅ | `TokenTransfer.daml` imports `Splice.Api.Token.HoldingV1`; transfers link to Holding contract IDs. |
| **CIP-0056 Settlement Deadlines** | ✅ | `ApproveTransfer` / `ExecuteSwap` enforce `allocateBefore` and `settleBefore` timestamps (`TokenTransfer.daml:46-50, 102-105`). |
| **CIP-0056 TransferInstruction Factory** | ✅ | `TransferRequest` + `SwapRequest` carry `spliceInstructionCid : Optional (ContractId TransferInstruction)`; backend exercises `TransferFactory_Transfer` and calls `LinkSpliceInstruction` to bind atomic settlement. |
| **CIP-0047 Featured App Activity Markers (V2 weight)** | ✅ | `FeaturedApp.daml:101-109` — `mapA exerciseOnce [1..activityWeight]` creates weighted markers per multi-leg rebalance. Beneficiary weight distribution supported. |
| **TransferPreapproval (inbound CC reward)** | ✅ | `TransferPreapproval.daml` — provider (Roil) is observer; backend calls `RecordActivity` on executed transfers, earning Featured App rewards. |
| **Immutable audit logs** | ✅ | 9 log templates (TreasurySwapLog, RebalanceLog, DCALog, GovernanceAuditLog, PortfolioAuditLog, CompoundLog, RewardPayout, ReferralCredit, PreapprovedTransferLog). |
| **Daml-LF 3.x migration** | ✅ | All contract keys removed; no `fetchByKey` / `lookupByKey`. |

## 6. Network Impact — 6-month Projection

Conservative estimate, assuming 100 active whitelisted users by month 6:

| Activity | Frequency | TX per user | Weighted markers |
|---|---|---|---|
| Auto-rebalance | weekly | 3–5 swaps × activityWeight(3) | ~12/wk |
| DCA (hourly/daily/weekly/monthly) | per schedule | 1 swap × activityWeight(1) | ~7/wk median |
| Compound | per yield event | 2–3 swaps × activityWeight(2) | ~4/wk |
| xReserve deposit/withdraw | event-driven | 1 per event × activityWeight(1) | ~2/wk |
| CC inbound (preapproval) | event-driven | 1 per transfer × activityWeight(1) | ~3/wk |

**Median user generates ~28 FeaturedAppActivityMarkers per week.** With 100 active users: **~2,800 weighted markers/week ≈ 145,600 markers/year**, spread across meaningful on-chain activity (not spam-transfers).

## 7. User Flow (5-minute demo outline)

**0:00–0:30 — Landing page.** Marketing; example portfolio rendered with a prominent "Demo Preview" banner. Connect-wallet CTA.

**0:30–1:30 — Dashboard.** Once connected, user sees empty real portfolio with "No holdings yet — bridge USDC or start DCA" empty state. TestNet badge in header.

**1:30–2:30 — xReserve deposit.** Walk through Ethereum Sepolia USDC deposit → on-chain attestation → `BridgeUserAgreement_Mint` → USDCx appears in wallet. Show backend log confirming Splice TransferInstruction factory exercise.

**2:30–3:30 — Choose strategy.** Pick "Balanced Growth" template → Daml `Portfolio` contract created with `DriftThreshold 5.0` trigger. Target allocation visualised.

**3:30–4:30 — Auto-rebalance + DCA.** Show cron-driven rebalance engine detecting drift → Smart Order Router quoting Cantex + Temple → executing lowest-price route → Featured App marker created. DCA schedule triggering daily.

**4:30–5:00 — Rewards & ledger proof.** Rewards page showing tier progression and FA coupon accrual. Link to `cantonscan.com` or participant inspector showing `FeaturedAppActivityMarker` contracts on-ledger.

## 8. Security & Operational Readiness

- **Daml tests:** 146 scripts covering lifecycle, authorization, ensure clauses, failure modes, reward distribution, governance transitions, preapproval flows.
- **Backend test suite:** vitest — config validation, admin party guards, retry/circuit-breaker behaviour, rate-limit store, idempotency concurrency.
- **OpenAPI spec:** `backend/src/openapi.yaml` documents every endpoint; deployed schema matches implementation.
- **Monitoring:** Prometheus + Grafana stack; backend emits request duration, circuit-breaker state, DCA execution count, reward distribution count.
- **Security posture:** JWT mode enforced (no `unsafe` outside localnet), prototype-pollution guard, rate limiting, per-key idempotency locks, Zod input validation on every route, `SECURITY.md` with disclosure policy.
- **Deployment hardening:** systemd unit runs as unprivileged `roil` user with `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`. Caddy TLS with automatic Let's Encrypt renewal.

## 9. Current Deployment Status

- **DevNet (`159.195.71.102`):** Splice v0.5.17 validator — 6 containers healthy for 7+ days. Roil DAR v0.3.1 built and test suite 146/146 passing.
- **TestNet (`159.195.78.106`):** Splice v0.5.17 validator + Roil backend (systemd, live at `https://api.roil.app`). DAR v0.3.1 uploaded. Frontend at `https://roil.app`.
- **MainNet (`159.195.76.220`):** VPS provisioned; awaiting Pedro's onboarding secret on 2026-04-20.

## 10. Roadmap (post-FA approval)

| Milestone | Target |
|---|---|
| MainNet validator live | 2026-04-20 |
| FA activation + first AppRewardCoupon claim | 2026-04-27 |
| First 10 whitelist users onboarded | 2026-05-15 |
| 100 active users | 2026-08-01 |
| Tokenized treasury (USTb) integration via DTCC pilot | contingent on Canton Foundation / DTCC timeline |
| Stop-loss & take-profit orders | 2026-Q3 |
| Multi-portfolio per user | 2026-Q3 |

## 11. Reporting Commitments

Roil commits to the Canton Foundation reporting cadence:

- **30-day report** — activity marker counts, unique users, transaction volume, AppRewardCoupon claims.
- **Quarterly operational report** — uptime, incident log, FA reward distribution to beneficiaries, compliance attestations.

## 12. Contact

- **Primary:** semih@roil.app
- **GitHub:** @Himess
- **Technical escalation:** on-call pager via Grafana alert rules (staging; MainNet alerting enforced at launch).

---

### Appendix A — Splice DAR dependencies (from `main/daml.yaml` v0.3.1)

```yaml
data-dependencies:
  - dars/splice-api-featured-app-v1-1.0.0.dar
  - dars/splice-api-token-holding-v1-1.0.0.dar
  - dars/splice-api-token-metadata-v1-1.0.0.dar
  - dars/splice-api-token-transfer-instruction-v1-1.0.0.dar
  - dars/splice-api-token-allocation-v1-1.0.0.dar
  - dars/splice-api-token-allocation-request-v1-1.0.0.dar
```

### Appendix B — Key file references for reviewers

- Daml contracts: [`main/daml/`](../main/daml/)
- Test scripts: [`test/daml/`](../test/daml/) — 146 scripts
- Backend engines: [`backend/src/engine/`](../backend/src/engine/) — rebalance, DCA, compound, featured-app, trigger-manager, treasury, rewards, whitelist
- Backend services: [`backend/src/services/`](../backend/src/services/) — cantex-client, temple-client, xreserve-client, price-oracle, yield-sources, admin-party-validator
- Security notes: [`../SECURITY.md`](../SECURITY.md)
- Architecture overview: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Changelog: [`../CHANGELOG.md`](../CHANGELOG.md)
