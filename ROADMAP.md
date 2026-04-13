# Roil — Roadmap

## What We've Built (Today)

### Core Platform
- 10 Daml smart contract modules (Portfolio, DCA, RewardTracker, FeaturedApp, TokenTransfer, TransferPreapproval, Treasury, Whitelist, Governance, Types)
- 26 Daml test scripts with comprehensive coverage
- TypeScript/Express backend with 17 test files, 200+ test cases
- React 19 frontend with Plus Jakarta Sans, light theme design
- 9 frontend unit + E2E tests

### Smart Order Router
- **Cantex AMM** integration (Ed25519 auth + secp256k1 swap signing)
- **Temple Digital Group Orderbook** integration (CLOB with limit orders)
- Automatic best-price selection across both DEXes
- Pre-swap slippage protection with configurable tolerance
- 0.1% platform fee (configurable)

### Portfolio Management
- 8 pre-built strategy templates (Conservative to All Weather)
- 6-step Create Portfolio wizard with token picker
- 9 supported assets: CC, USDCx, CBTC, ETHx, SOLx, XAUt, XAGt, USTb, MMF
- Drift threshold + price condition auto-triggers
- Rebalance simulation (dry-run before execution)
- Inline Review editing with real-time preview

### DCA Engine
- Hourly, Daily, Weekly, Monthly frequencies
- Pause / Resume / Cancel controls
- Execution history tracking

### Auto-Compound
- 3 reinvestment strategies (Portfolio Targets, Same Asset, USDC Only)
- Yield detection from CC staking, Alpend lending, Cantex LP (simulated on devnet)
- CompoundConfig Daml template for ledger persistence

### Reward System
- Tier-based CC fee rebates: Bronze (0.5%) -> Silver (1.0%) -> Gold (2.0%) -> Platinum (3.0%)
- Monthly reward distribution
- On-chain referral program with credit accrual
- Privacy-preserving leaderboard

### Canton Integration
- Ledger API v2 (7 endpoints)
- CIP-0056 Token Standard (Holding + Transfer + Allocation)
- Canton dApp SDK (@canton-network/dapp-sdk) wallet integration
- Transaction streaming (SSE from /v2/updates/flat)
- Scan API client (network stats, featured apps)
- Featured App rewards (GSF activity marker ready)
- Cost estimation via Interactive Submission

### Infrastructure
- Docker multi-stage builds with non-root containers
- CI/CD: 4 parallel jobs (Daml, Backend, Frontend, Docker) + npm audit
- Prometheus + Grafana monitoring (8-panel dashboard)
- Redis-compatible rate limiting
- JWT RS256/ES256 authentication
- Circuit breaker + retry patterns
- Graceful shutdown
- Load testing script

### Frontend
- 6 pages: Dashboard, Create Portfolio, DCA, Rewards, Settings, Slides
- 20+ components with real CoinGecko token logos
- Custom TokenSelect dropdown
- Performance chart with time range selector (1D/1W/1M/1Y/All)
- Toast notifications, confirmation dialogs
- Mobile responsive sidebar
- Onboarding wizard
- 11-slide pitch deck at /slides

---

## Devnet (Next)

- [ ] Deploy DAR to Canton devnet
- [ ] Real Cantex + Temple swap execution testing
- [ ] GSF Featured App registration
- [ ] Loop Wallet live connection test
- [ ] Real CC/USDCx token operations via tap faucet
- [ ] Stop-loss / take-profit orders
- [ ] Multi-portfolio support
- [ ] Real yield source integration (Alpend, ACME)

---

## Mainnet (Future)

- [ ] RWA token support: tokenized gold, silver, treasury bonds
- [ ] Cross-chain rebalance via Chainlink CCIP
- [ ] Compliance module (KYC/AML for institutional clients)
- [ ] AI portfolio optimization
- [ ] Institutional dashboards
- [ ] DAO governance for platform parameters

---

## Canton-Unique Advantages

1. **Private Portfolio Management** — Holdings, trades, and strategies invisible to other parties
2. **Deterministic Settlement** — Canton's Daml contracts guarantee execution correctness
3. **Privacy-Preserving Leaderboard** — Prove performance without revealing positions
4. **Verifiable Authorization** — Daml's type system enforces multi-party consent
5. **Sub-Transaction Privacy** — Counterparties see only their relevant parts
6. **Featured App Rewards** — Earn CC tokens from GSF for network activity
7. **CIP-0056 Compliance** — Standard token interface for institutional interoperability

---

## Links

- **Live Demo:** https://roil-finance.vercel.app
- **Pitch Deck:** https://roil-finance.vercel.app/slides
- **GitHub:** https://github.com/Himess/roil-finance
