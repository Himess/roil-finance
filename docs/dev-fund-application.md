# Roil Finance — Canton Network Dev Fund Application

**Submission target:** Canton Foundation · [github.com/canton-foundation/canton-dev-fund](https://github.com/canton-foundation/canton-dev-fund/)
**Applicant:** Himess (contact: semih@roil.app)
**Amount requested:** **≈ $10,750 USD-equivalent (paid in Canton Coin)**
**Project:** Roil Finance — portfolio management dApp on Canton Network
**Status:** Live on TestNet (`https://api.roil.app`, `https://roil.app`), MainNet validator cutover scheduled 2026-04-20.

---

## 1. Summary

Roil Finance is a privacy-preserving, automated portfolio manager already running on Canton TestNet with 10 Daml modules, 146 passing tests, full Splice integration (FeaturedApp + Token Standard + TransferInstruction factory), Cantex AMM + Temple CLOB Smart Order Routing, and Circle xReserve USDC bridging.

We are requesting Dev Fund support to (a) seed treasury liquidity so early users can swap without waiting on secondary market depth, and (b) subsidize Canton Coin traffic fees during the first month so whitelist users experience zero-friction onboarding.

This request is for **bootstrapping**, not ongoing subsidy. After month 1 the app self-funds from fees and Featured App rewards.

## 2. Use of Funds

| Line item | Amount (USD-eq) | Purpose |
|---|---|---|
| **Treasury swap liquidity** | **$10,000** | Seed pool balances across CC, USDCx, cBTC, ETHx so the treasury module can execute small user swaps with tight spread (0.5%) before third-party liquidity arrives. Balances sit in the `TreasuryPool` contract, on-chain auditable. Remaining liquidity at MainNet handover to be returned or rolled into on-chain market-making. |
| **Traffic fee seed fund** | **$750** | Canton Coin for traffic fees (~5,000 CC at $0.15/CC — roughly one month of sponsored traffic for 100 whitelist users × ~30 TX/user). Covers the gap until FA rewards clear and the app can self-fund. |
| **Total** | **$10,750** | — |

## 3. Why This Matters for the Canton Network

1. **Demonstrates institutional-grade DeFi on Canton.** Roil is the first portfolio manager to combine Splice Token Standard, xReserve USDC, Cantex AMM, Temple CLOB, Featured App Activity Markers, and TransferPreapproval into a single user-facing product. Canton's pitch for "private DeFi for financial institutions" needs working reference apps; Roil is one.
2. **Drives Featured App adoption and showcases FA economics.** Every rebalance, DCA execution, compound event, and xReserve deposit produces weighted activity markers (CIP-0047 V2). Projected **~145k weighted markers/year** from 100 active users.
3. **Validates CIP-0056 end-to-end.** Our DAR imports and exercises `TransferFactory_Transfer` atomically, proving the Splice factory pattern works in production for real DvP use cases.
4. **Brings RWA users to Canton.** Portfolio templates (Institutional, All-Weather) encourage exposure to tokenized treasuries (USTb) and precious metals (XAUt/XAGt). As these listings mature on Canton, Roil is a ready-made distribution channel.

## 4. Milestones & Success Metrics

| Month | Milestone | Measurable outcome |
|---|---|---|
| M+0 (2026-04-20) | MainNet validator live + FA submitted | Validator node active; FA application accepted |
| M+1 | 10 whitelist users onboarded | 10 active `Portfolio` contracts; first AppRewardCoupons claimed |
| M+2 | 50 users | ≥ 30 rebalances / week, ≥ 500 weighted markers / week |
| M+3 | 100 active users | ≥ 2,000 weighted markers / week; 3-month FA report submitted |
| M+6 | Treasury self-funded from fees | Roil treasury pool returns seed liquidity; app runs on fee income + FA rewards |

## 5. Financial Accountability

- **Treasury pool balances:** all seed liquidity held in the on-chain `TreasuryPool` Daml contract — auditable in real-time.
- **Traffic seed fund:** dedicated Canton party (`roil-traffic-subsidy`) with monthly consumption report.
- **Monthly burn-rate report** published to repository and Canton Foundation email contact.
- **Unused liquidity clawback:** if Roil has not onboarded at least 25 active users by M+3, we return the unused seed liquidity.

## 6. Team

- **Himess (semih@roil.app)** — Technical lead. 10 Daml contracts, backend architecture, TestNet deployment.

Roil is currently a solo-maintainer project. We are hiring a second engineer contingent on Dev Fund approval to cover (a) MainNet operational on-call and (b) frontend polish for the 100-user rollout.

## 7. Prior Proof of Work

- **Repositories:**
  - [github.com/Himess/roil-finance](https://github.com/Himess/roil-finance) (public, Daml + backend)
  - `Himess/roil-app` (private, frontend)
- **Live deployment:**
  - Frontend: [https://roil.app](https://roil.app)
  - API: [`https://api.roil.app/health`](https://api.roil.app/health) (live, Let's Encrypt TLS, Prometheus-scrapable)
- **Test evidence:** 146 Daml test scripts passing (verifiable via `cd test && daml test`). Backend vitest suite green.
- **Audit report:** [`PRE-APPLICATION-AUDIT.md`](../PRE-APPLICATION-AUDIT.md) — honest self-audit across backend, Daml/CIP, frontend, and ops domains.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Real-world token issuers (cBTC, ETHx, RWAs) delay | Roil runs with available tokens first (CC + USDCx via xReserve). Other asset rows in the UI are clearly marked "demo only" until issuers list. |
| Featured App approval delay | The app is fully functional without FA; rebalance, DCA, compound work regardless. FA rewards are upside, not dependency. |
| Single maintainer bottleneck | Dev Fund triggers the second engineer hire. On-call procedures already documented in `backend/deploy/` and `SECURITY.md`. |
| MainNet instability during first weeks | TestNet dogfooding continues; automatic fallback to TestNet for non-critical endpoints. Circuit breakers on Cantex / Temple prevent cascade failure. |

## 9. Reporting & Governance Commitments

- Open-source everything on the main backend + Daml repo (frontend remains private but compiled assets are served openly on `roil.app`).
- Monthly report: active users, TX volume, FA coupon claims, burn rate, incidents.
- On request, quarterly call with Canton Foundation reps to review trajectory and answer questions.
- Unused funds returned at M+6 if success metrics are missed.

## 10. Contact

- **Primary:** semih@roil.app
- **GitHub:** @Himess
- **Architecture deep-dive available on request.**

---

### Appendix — Dev Fund math

**Traffic seed fund ($750):**
- 5,000 CC @ $0.15/CC = $750
- At ~30 TX per user × 100 users = 3,000 TX/month × ~1 CC/TX traffic fee = 3,000 CC/month
- 5,000 CC covers ~1.5 months of projected whitelist activity

**Treasury liquidity ($10,000):**
- Split: $3,000 CC + $3,000 USDCx + $2,500 cBTC + $1,500 ETHx
- Enables ~500 small swaps ($5-50) at tight spread before external AMM depth is sufficient
- Funds remain on-chain, redeployable after seed period
