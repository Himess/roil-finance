# Canton Private Rebalancer — Roadmap

## Current Status (v1.0 — Devnet Ready)

### Core Features ✅
- Portfolio management with 8 pre-built strategy templates
- Auto-rebalance (drift threshold + price condition triggers)
- Dollar-Cost Averaging (DCA) — Hourly/Daily/Weekly/Monthly
- Auto-compound with 3 reinvestment strategies
- Reward tier system (Bronze → Platinum) with CC fee rebates
- Referral program with on-chain tracking
- Featured App rewards (GSF integration ready)
- Real-time event streaming (SSE from Canton Ledger)
- Performance tracking with 24h/7d/30d analytics
- Rebalance simulation (dry-run before execution)
- Platform fee (0.1% configurable)

### Technical Foundation ✅
- 6 Daml contract modules, 26 Daml tests
- Canton Ledger API v2 (7 endpoints)
- Cantex DEX native integration (Ed25519 + secp256k1)
- CIP-0056 token standard (Holding + Transfer + Allocation)
- ~240 automated tests (backend + frontend + E2E)
- Docker + CI/CD + Grafana monitoring
- Redis-compatible rate limiting
- Transaction streaming + Scan API

---

## Phase 1 — Devnet (Current Sprint)
- [x] Submit devnet application to Canton GSF
- [ ] Receive devnet onboarding credentials
- [ ] Deploy validator node
- [ ] Upload DAR to devnet participant
- [ ] Configure real admin party IDs
- [ ] Test with real Cantex DEX
- [ ] Register as Featured App with GSF
- [ ] Demo to Canton community

## Phase 2 — Testnet (Q2 2026)
- [ ] Stop-Loss / Take-Profit orders
- [ ] Multi-portfolio support
- [ ] Limit orders (single-asset trades)
- [ ] Real yield integration (Alpend, Cantex LP)
- [ ] Tax reporting (cost basis, CSV export)
- [ ] Premium subscription tiers
- [ ] Full CIP-0056 integration (DvP, Lock/Unlock)
- [ ] Daml Trigger migration (cron → reactive)
- [ ] Professional security audit
- [ ] Cantex crypto code review

## Phase 3 — Mainnet (Q3 2026)
- [ ] **Auto Yield Optimizer** — Automatically find and route capital to highest-yield source (Alpend lending vs Cantex LP vs CC staking), rebalance yield positions dynamically
- [ ] **Cross-Chain Rebalance** — Via Chainlink CCIP integration on Canton, include EVM-based assets (real ETH, USDC on Base/Ethereum) in portfolio rebalancing alongside Canton-native tokens
- [ ] **Compliance Module** — KYC/AML-compliant rebalancing for institutional clients, leveraging Canton's privacy model to keep client data confidential while meeting regulatory requirements
- [ ] Social strategies / copy trading
- [ ] Institutional delegation (fund managers)
- [ ] Backtesting engine
- [ ] Public API / SDK for third-party integrations
- [ ] Strategy marketplace with creator fees
- [ ] Multi-synchronizer portfolio management
- [ ] Atomic multi-step rebalancing
- [ ] Privacy-preserving ZK proofs for performance claims
- [ ] Mobile app (React Native)

## Phase 4 — Growth (Q4 2026+)
- [ ] Cross-chain portfolio management (multi-chain beyond CCIP)
- [ ] AI-powered strategy optimization
- [ ] Institutional dashboards with compliance reporting
- [ ] White-label platform for other Canton apps
- [ ] DAO governance for platform parameters
- [ ] DTCC Tokenized Treasury direct integration

---

## Canton-Unique Advantages

These features are only possible on Canton Network:

1. **Private Portfolio Management** — Holdings, trades, and strategies are invisible to other parties
2. **Atomic Multi-Step Rebalancing** — All swap legs execute or none do (no partial failures)
3. **Privacy-Preserving Leaderboard** — Prove performance without revealing positions
4. **Daml Smart Contracts** — Formally verifiable financial logic
5. **Sub-Transaction Privacy** — Counterparties see only their relevant transaction parts
6. **Featured App Rewards** — Earn CC tokens from GSF for generating network activity
7. **CIP-0056 Compliance** — Standard token interface for institutional interoperability
8. **Multi-Party Workflows** — Propose/accept patterns for regulated finance

---

## Technical Debt

| Item | Priority | Status |
|------|----------|--------|
| Performance tracker → persistent storage | P1 | ✅ Done |
| DCA lastExecutedAt cache | P1 | ✅ Done |
| Consistent Zod validation | P1 | ✅ Done |
| Cron circuit breaker | P1 | ✅ Done |
| CompoundLog Daml template | P2 | Planned |
| Dependency injection refactor | P3 | Planned |
| Full CIP-0056 DvP integration | P2 | Planned |

---

## Metrics & KPIs

| Metric | Target (Devnet) | Target (Mainnet) |
|--------|----------------|-----------------|
| Total portfolios | 50+ | 1,000+ |
| Monthly rebalances | 500+ | 10,000+ |
| DCA schedules | 100+ | 2,000+ |
| Featured App rewards | First coupon | Top 10 featured app |
| Uptime | 95% | 99.9% |
| Test coverage | ~240 tests | 500+ tests |
