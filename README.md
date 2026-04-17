<p align="center">
  <h1 align="center">Roil</h1>
  <p align="center"><strong>Private Treasury Management on Canton Network</strong></p>
</p>

<p align="center">
  <a href="https://github.com/Himess/roil-finance/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://www.canton.network/"><img src="https://img.shields.io/badge/Canton-Network-6366F1" alt="Canton Network"></a>
  <a href="https://docs.daml.com/"><img src="https://img.shields.io/badge/Daml-3.4.11-00D4AA" alt="Daml 3.4.11"></a>
  <a href="https://github.com/Himess/roil-finance"><img src="https://img.shields.io/badge/TypeScript-5.7-3178C6" alt="TypeScript"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB" alt="React 19"></a>
</p>

<p align="center">
  Auto-rebalance, DCA, and compound your portfolio with sub-transaction privacy on Canton Network.
</p>

<p align="center">
  <a href="https://roil.app">App</a> &middot;
  <a href="https://roil.app/home">Landing Page</a> &middot;
  <a href="https://www.youtube.com/watch?v=_MagWXLwyiw">Demo Video</a> &middot;
  <a href="https://github.com/Himess/roil-finance">GitHub</a>
</p>

---

## The Problem

On EVM chains like Ethereum and Base, every portfolio holding, trade, and strategy is fully transparent on-chain. MEV bots front-run trades, extracting value from ordinary users. Competitors can copy strategies in real time. There is no privacy in DeFi portfolio management -- and that makes sophisticated treasury management impossible for both individuals and institutions.

## What is Roil?

**Roil** is a privacy-first treasury management platform built on Canton Network. It orchestrates portfolio rebalancing, dollar-cost averaging, and yield optimization across Canton's DeFi ecosystem -- while keeping your strategy, holdings, and trade history completely private through Canton's sub-transaction privacy model.

No one sees your portfolio. No one front-runs your trades. No one copies your strategy.

**For individuals today. For institutions tomorrow.**

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Private Portfolio Rebalancing** | Automated drift-based rebalancing with configurable thresholds -- invisible to other network participants |
| **Smart Order Router** | DEX aggregator comparing Cantex AMM and Temple Orderbook CLOB to find the best execution price |
| **Dollar-Cost Averaging** | Scheduled recurring buys at hourly, daily, weekly, or monthly intervals |
| **Auto-Compound** | Three reinvestment strategies (portfolio-targets, same-asset, stablecoin-only) with simulated yields on devnet |
| **8 Pre-Built Strategy Templates** | From Conservative to All Weather -- each with battle-tested allocations |
| **9 Supported Assets** | Crypto, stablecoins, and real-world assets including tokenized gold, silver, and US treasuries |
| **Reward Tiers** | Bronze through Platinum tiers offering 0.5% to 3.0% CC fee rebates based on monthly activity |
| **Performance Tracking** | 24h, 7d, and 30d analytics with portfolio snapshots and drift monitoring |
| **Rebalance Simulation** | Dry-run mode to preview swap legs before committing to execution |
| **0.1% Platform Fee** | Transparent, configurable fee applied to executed swaps |
| **Real-time SSE Updates** | Live transaction stream from the Canton Ledger via Server-Sent Events |
| **Privacy-Preserving Leaderboard** | Compete on metrics without revealing portfolio composition |

---

## Architecture

```
Frontend (React 19 + Vite + Tailwind CSS)
  |
Backend (Express + TypeScript)
  |-- Smart Router ----------+-- Cantex (AMM DEX)
  |                          +-- Temple (Orderbook CLOB)
  |-- Rebalance Engine
  |-- DCA Engine
  |-- Compound Engine
  |-- Rewards Engine
  |-- Featured App Engine
  |-- Price Oracle (4-tier fallback)
  |-- Performance Tracker
  |-- Transaction Stream (SSE)
  +-- Scan API Client
  |
Canton Network
  |-- 10 Daml Contract Modules
  |-- CIP-0056 Token Standard
  |-- Ledger API v2
  +-- Canton dApp SDK
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Smart Contracts | **Daml 3.4.11** | Business logic, authorization, and on-ledger state management |
| Backend | **TypeScript / Express** | API server, engine orchestration, cron scheduling |
| Frontend | **React 19 / Vite / Tailwind CSS** | Responsive dashboard, charts (Recharts), real-time updates |
| DEX Integration | **Cantex DEX + Temple DEX** | AMM liquidity pools (CaviarNine) + orderbook CLOB (Temple Digital Group) |
| Token Standard | **CIP-0056** | Standardized token holding, transfer, and allocation interfaces |
| Wallet | **@canton-network/dapp-sdk** | Canton wallet connection, party management, transaction signing |
| Monitoring | **Prometheus / Grafana** | Metrics collection, dashboards, alerting |
| CI/CD | **GitHub Actions / Docker** | Automated testing, build, and deployment pipelines |
| Validation | **Zod** | Runtime input validation and schema enforcement |

---

## Supported Assets (9)

| Symbol | Name | Category | Description |
|--------|------|----------|-------------|
| **CC** | Canton Coin | Crypto | Native Canton Network token |
| **USDCx** | USDC on Canton | Stablecoin | Circle-backed stablecoin bridge |
| **CBTC** | Canton Bitcoin | Crypto | Wrapped Bitcoin on Canton |
| **ETHx** | Canton ETH | Crypto | Wrapped Ethereum on Canton |
| **SOLx** | Canton SOL | Crypto | Wrapped Solana on Canton |
| **XAUt** | Tokenized Gold | RWA | Gold-backed real-world asset token |
| **XAGt** | Tokenized Silver | RWA | Silver-backed real-world asset token |
| **USTb** | US Treasury Bond | RWA | Tokenized US Treasury bonds |
| **MMF** | Money Market Fund | RWA | Tokenized money market fund shares |

---

## Portfolio Templates (8)

| Template | Risk | Allocation | Drift Threshold |
|----------|------|------------|-----------------|
| **Conservative** | Low | USDCx 40%, USTb 30%, XAUt 20%, CC 10% | 3.0% |
| **Balanced Growth** | Medium | CBTC 25%, USDCx 25%, ETHx 20%, XAUt 15%, CC 15% | 5.0% |
| **BTC-ETH Maxi** | High | CBTC 50%, ETHx 30%, USDCx 20% | 7.0% |
| **Crypto Basket** | High | CBTC 30%, ETHx 25%, SOLx 15%, CC 15%, USDCx 15% | 5.0% |
| **Precious Metals** | Low | XAUt 60%, XAGt 40% | 3.0% |
| **Institutional Grade** | Medium | USTb 40%, XAUt 25%, USDCx 20%, CBTC 15% | 4.0% |
| **Stablecoin Yield** | Low | USDCx 70%, CC 30% | 2.0% |
| **All Weather** | Medium | USTb 30%, XAUt 20%, CBTC 20%, USDCx 15%, ETHx 15% | 5.0% |

---

## Smart Order Router

Roil includes a DEX aggregator that compares prices across multiple Canton Network exchanges and automatically routes trades to the venue offering the best execution price -- similar to 1inch on Ethereum.

**Supported DEXes:**

| DEX | Type | Operator |
|-----|------|----------|
| **Cantex** | Automated Market Maker (AMM) | CaviarNine |
| **Temple** | Central Limit Orderbook (CLOB) | Temple Digital Group (backed by YZi Labs) |

**How it works:**

1. Fetches quotes from all available DEXes simultaneously via `Promise.allSettled`
2. Sorts by output amount (highest = best price for the user)
3. Calculates savings compared to the worst quote
4. Executes the swap on the winning venue

**API Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/market/best-quote` | GET | Get the best quote across all DEXes for a given pair and amount |
| `/api/market/compare-quotes` | GET | Compare quotes from all DEXes side by side |
| `/api/market/dexes` | GET | Check which DEXes are currently available |

---

## Quick Start

### Prerequisites

- **Java 17** (with `JAVA_HOME` set)
- **Daml SDK 3.4.11**
- **Node.js 22+** (Node 20 EOL 2026-04-30)
- **Docker** (recommended for LocalNet)

### Docker (Recommended)

```bash
git clone https://github.com/Himess/roil-finance.git
cd roil-finance

# Set up environment (required for locale-sensitive systems)
source .envrc

# Start Canton LocalNet (builds Daml, starts Docker, uploads DAR)
./scripts/setup-localnet.sh

# Initialize ledger (allocate parties, create initial contracts)
cd backend && npx tsx ../scripts/init-ledger.ts && cd ..

# Start backend
cd backend && npm run dev &

# Start frontend
cd ui && npm run dev
```

Open [http://localhost:5173](http://localhost:5173) for the UI. Backend API runs on [http://localhost:3001](http://localhost:3001).

### Manual Setup

```bash
git clone https://github.com/Himess/roil-finance.git
cd roil-finance

# 1. Build Daml contracts
cd main && daml build && cd ..

# 2. Run Daml tests
cd test && daml build && daml test && cd ..

# 3. Start Canton sandbox with JSON API
cd main && daml start --json-api-port 3975 &

# 4. Install dependencies and start backend
cd backend && npm install && npm run dev &

# 5. Install dependencies and start frontend
cd ui && npm install && npm run dev
```

---

## Reward Tiers

Users earn tier status based on their monthly transaction count. Higher tiers receive larger CC fee rebates.

| Tier | Monthly Transactions | Fee Rebate | Badge |
|------|---------------------|------------|-------|
| **Bronze** | 0 -- 50 | 0.5% | Entry tier |
| **Silver** | 51 -- 200 | 1.0% | Active trader |
| **Gold** | 201 -- 500 | 2.0% | Power user |
| **Platinum** | 501+ | 3.0% | Elite status |

Tiers reset monthly. Consecutive months at the same tier are tracked for future loyalty bonuses.

---

## Security

Roil implements defense-in-depth security across every layer of the stack:

- **JWT RS256/ES256 Authentication** -- Production-grade asymmetric key signing (unsafe mode blocked outside localnet)
- **Timing-safe HMAC Verification** -- Prevents timing-based side-channel attacks
- **Circuit Breaker Pattern** -- Automatic fault isolation for DEX and external API calls
- **Exponential Backoff Retry** -- Graceful retry logic with jitter for transient failures
- **Rate Limiting** -- Redis-compatible request throttling to prevent abuse
- **Prototype Pollution Protection** -- Hardened request parsing to prevent object injection
- **Security Headers** -- HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options
- **Graceful Shutdown** -- Clean SIGTERM/SIGINT handling with in-flight request draining
- **Input Validation** -- Zod schema validation on all API inputs
- **Slippage Protection** -- On-ledger Daml assertion ensures swap output meets minimum threshold
- **Production Safety Checks** -- Environment-aware config validation prevents unsafe defaults in non-local environments

---

## Why Canton?

| Dimension | Canton Network | EVM Chains (Ethereum, Base) |
|-----------|---------------|---------------------------|
| **Privacy** | Sub-transaction privacy -- only counterparties see data | Fully public -- all balances, trades, strategies visible |
| **Front-running** | Impossible -- transactions are private by default | Rampant -- MEV bots extract billions annually |
| **Token Standard** | CIP-0056 -- unified holding, transfer, allocation | ERC-20 -- no built-in privacy, no allocation semantics |
| **Settlement** | Atomic, synchronous across participants | Probabilistic finality, multi-block confirmation |
| **Smart Contracts** | Daml -- formally verifiable, authorization-centric | Solidity -- Turing-complete, audit-dependent |
| **Regulatory Fit** | KYC-compatible, institution-ready | Pseudonymous, regulatory friction |

---

## Testing

Roil has comprehensive test coverage across all layers of the stack:

| Layer | Framework | Test Files | Description |
|-------|-----------|------------|-------------|
| **Daml Contracts** | Daml Script | 9 test modules, 146 test scripts | Full contract lifecycle, authorization, validation, edge cases |
| **Backend** | Vitest | ~10 test files | Engine logic, routes, auth, security, circuit breaker, retry |
| **Frontend Unit** | Vitest + Testing Library | 3 test files | Config validation, error boundary, hook behavior |
| **E2E** | Playwright | 1 spec file, 10 test scenarios | Navigation, templates, DCA form, rewards, settings, mobile |

```bash
# Run all backend tests
cd backend && npm test

# Run all frontend unit tests
cd ui && npm test

# Run E2E tests
cd ui && npm run test:e2e

# Run Daml contract tests
cd test && daml test
```

---

## Project Structure

```
roil-finance/
|
|-- main/                              # Daml smart contracts
|   |-- daml.yaml                      # Daml project config (SDK 3.4.11)
|   +-- daml/
|       |-- Types.daml                 # Core types: AssetId, Holding, Tier, TriggerMode
|       |-- Portfolio.daml             # Portfolio, RebalanceRequest, CompoundConfig
|       |-- DCA.daml                   # DCASchedule, DCAExecution, DCALog
|       |-- RewardTracker.daml         # RewardTracker, RewardPayout, Referral
|       |-- FeaturedApp.daml           # FeaturedAppConfig, ActivityRecord
|       |-- TokenTransfer.daml         # TransferRequest, SwapRequest, logs
|       |-- TransferPreapproval.daml   # Auto-accept transfer patterns
|       |-- Treasury.daml              # Treasury swap with oracle pricing + spread
|       |-- Whitelist.daml             # Invite code whitelist (max 1000 users)
|       +-- Governance.daml            # Freeze, pause, fee updates, audit logs
|
|-- test/                              # Daml test suite
|   +-- daml/
|       |-- TestPortfolio.daml         # 17 contract test scenarios
|       +-- TestTokenTransfer.daml     # 9 token transfer test scenarios
|
|-- backend/                           # Express API server
|   +-- src/
|       |-- index.ts                   # App entry point
|       |-- server.ts                  # Express server setup
|       |-- config.ts                  # Environment config, templates, instruments
|       |-- ledger.ts                  # Daml JSON Ledger API v2 client
|       |-- cantex.ts                  # Cantex AMM DEX integration
|       |-- cantex-client.ts           # Cantex HTTP client
|       |-- engine/
|       |   |-- rebalance.ts           # Rebalance engine (drift calc, swap planning)
|       |   |-- dca.ts                 # DCA engine (cron scheduling, execution)
|       |   |-- compound.ts            # Compound engine (yield reinvestment)
|       |   |-- rewards.ts             # Rewards engine (tier calc, payouts)
|       |   +-- featured-app.ts        # Featured App engine (GSF integration)
|       |-- services/
|       |   |-- smart-router.ts        # DEX aggregator (Cantex + Temple)
|       |   |-- temple-client.ts       # Temple Digital Group CLOB client
|       |   |-- price-oracle.ts        # 4-tier price fallback oracle
|       |   |-- performance-tracker.ts # Portfolio performance snapshots
|       |   |-- scan-client.ts         # Canton Scan API client
|       |   |-- token-transfer.ts      # CIP-0056 transfer service
|       |   +-- transaction-stream.ts  # SSE event stream from ledger
|       |-- routes/
|       |   |-- portfolio.ts           # Portfolio CRUD + rebalance endpoints
|       |   |-- dca.ts                 # DCA schedule management
|       |   |-- compound.ts            # Compound config + execution
|       |   |-- rewards.ts             # Reward tier + payout endpoints
|       |   |-- market.ts              # Smart router + DEX quotes
|       |   |-- transfers.ts           # Token transfer endpoints
|       |   +-- metrics.ts             # Prometheus metrics endpoint
|       |-- middleware/
|       |   |-- auth.ts                # JWT RS256/ES256 authentication
|       |   |-- security.ts            # Security headers, prototype pollution
|       |   |-- rate-limiter.ts        # Request rate limiting
|       |   |-- error-handler.ts       # Global error handler
|       |   +-- metrics-middleware.ts   # Request metrics collection
|       |-- monitoring/
|       |   |-- logger.ts              # Structured logging
|       |   +-- metrics.ts             # Prometheus metric definitions
|       +-- utils/
|           |-- circuit-breaker.ts     # Circuit breaker pattern
|           |-- retry.ts               # Exponential backoff retry
|           |-- daml.ts                # Daml helper utilities
|           +-- errors.ts              # Custom error types
|
|-- ui/                                # React frontend
|   +-- src/
|       |-- main.tsx                   # App entry point
|       |-- App.tsx                    # Router + layout
|       |-- config.ts                  # Asset colors, tiers, templates
|       |-- types.ts                   # TypeScript type definitions
|       |-- pages/
|       |   |-- Dashboard.tsx          # Main portfolio dashboard
|       |   |-- CreatePortfolio.tsx     # Portfolio creation wizard
|       |   |-- DCAPage.tsx            # DCA management
|       |   |-- RewardsPage.tsx        # Reward tiers + referrals
|       |   |-- SettingsPage.tsx       # User preferences
|       |   |-- TransactionDetail.tsx  # Transaction detail view
|       |   +-- Slides.tsx             # Pitch deck presentation
|       |-- components/
|       |   |-- AllocationChart.tsx    # Pie/donut allocation chart
|       |   |-- AssetRow.tsx           # Asset row with drift indicator
|       |   |-- ConfirmDialog.tsx      # Confirmation modal
|       |   |-- DCACard.tsx            # DCA schedule card
|       |   |-- DriftIndicator.tsx     # Visual drift bar
|       |   |-- ErrorBoundary.tsx      # React error boundary
|       |   |-- OnboardingWizard.tsx   # First-time user onboarding
|       |   |-- PerformanceChart.tsx   # Performance line chart
|       |   |-- PortfolioSetup.tsx     # Target allocation editor
|       |   |-- RewardTier.tsx         # Tier progress display
|       |   |-- Sidebar.tsx            # Navigation sidebar
|       |   |-- StatsCard.tsx          # KPI stat cards
|       |   |-- SwapHistory.tsx        # Swap history table
|       |   |-- TemplateSelector.tsx   # Strategy template picker
|       |   |-- Toast.tsx              # Toast notifications
|       |   |-- TokenIcon.tsx          # Token logo component
|       |   |-- TokenSelect.tsx        # Token dropdown selector
|       |   |-- WalletConnect.tsx      # Canton wallet connection
|       |   +-- WizardSummary.tsx      # Creation wizard summary
|       |-- hooks/
|       |   |-- useApi.ts             # Generic API hook
|       |   |-- useDCA.ts             # DCA state management
|       |   |-- useEventStream.ts     # SSE event stream hook
|       |   |-- useMarket.ts          # Market data hook
|       |   |-- usePortfolio.ts       # Portfolio state hook
|       |   |-- useRewards.ts         # Rewards state hook
|       |   +-- useWallet.ts          # Wallet connection hook
|       |-- context/
|       |   +-- PartyContext.tsx       # Canton party context provider
|       |-- lib/
|       |   |-- canton-sdk-wallet.ts   # Canton dApp SDK wallet adapter
|       |   |-- canton-wallet.ts       # Wallet abstraction layer
|       |   +-- tokenPrices.ts         # Client-side price utilities
|       |-- assets/
|       |   +-- TokenLogos.tsx         # SVG token logo components
|       +-- __tests__/
|           |-- config.test.ts         # Config validation tests
|           |-- ErrorBoundary.test.tsx  # Error boundary tests
|           +-- usePortfolio.test.ts   # Portfolio hook tests
|   +-- e2e/
|       +-- app.spec.ts               # Playwright E2E tests (9 scenarios)
|
|-- scripts/
|   |-- setup-localnet.sh             # Docker-based LocalNet bootstrap
|   |-- stop-localnet.sh              # Stop LocalNet services
|   |-- deploy-dar.sh                 # DAR deployment to ledger
|   |-- init-ledger.ts                # Ledger initialization script
|   |-- load-test.sh                  # Performance load testing
|   +-- load-test-config.json         # Load test configuration
|
|-- monitoring/
|   |-- docker-compose.monitoring.yml # Prometheus + Grafana stack
|   |-- prometheus.yml                # Prometheus scrape config
|   +-- grafana/
|       |-- dashboards/
|       |   +-- rebalancer.json       # Grafana dashboard definition
|       +-- provisioning/
|           |-- dashboards/
|           |   +-- dashboard.yml     # Dashboard provisioning config
|           +-- datasources/
|               +-- datasource.yml    # Prometheus datasource config
|
|-- .github/
|   +-- workflows/
|       +-- ci.yml                    # GitHub Actions CI pipeline
|
|-- docs/
|   +-- devnet-application.md         # Devnet deployment guide
|
|-- docker-compose.override.yml       # Docker Compose overrides
|-- .envrc                            # Environment setup script
|-- multi-package.yaml                # Daml multi-package config
|-- LICENSE                           # MIT License
+-- ROADMAP.md                        # Development roadmap
```

---

## Roadmap

| Phase | Status | Milestone |
|-------|--------|-----------|
| **Phase 1: Foundation** | Complete | Daml contracts, backend engines, React UI, 146 Daml tests + backend/FE suites |
| **Phase 2: DEX Aggregation** | Complete | Smart Order Router, Temple CLOB integration, price oracle |
| **Phase 3: TestNet** | Live | `api.roil.app` backend + DAR v0.3.1 on Canton TestNet, xReserve USDC, governance, Featured App markers |
| **Phase 4: MainNet** | Provisioning 2026-04-20 | Node cutover, FA + Dev Fund submissions within 2-week window |

See [ROADMAP.md](./ROADMAP.md) for the detailed development plan.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CANTON_NETWORK` | No | `localnet` | Network environment: `localnet`, `devnet`, `testnet`, `mainnet` |
| `PORT` | No | `3001` | Backend Express server port |
| `JSON_API_URL` | No | Per-network | Canton JSON Ledger API v2 base URL |
| `GRPC_API_URL` | No | `http://localhost:3901` | Canton gRPC Ledger API URL |
| `SCAN_URL` | No | Per-network | Canton Scan API URL for registry lookups |
| `CANTEX_API_URL` | No | Per-network | Cantex DEX API base URL |
| `TEMPLE_API_URL` | No | `https://app.templedigitalgroup.com/api` | Temple DEX API base URL |
| `TEMPLE_API_KEY` | Yes (prod) | -- | Temple DEX API key |
| `PLATFORM_PARTY` | Yes (prod) | `app-provider::1220placeholder` | Platform party identity |
| `LEDGER_USER_ID` | No | `app-provider` | Ledger API user ID |
| `JWT_MODE` | No | `unsafe` | Auth mode: `unsafe`, `rs256`, `es256`, `hmac256` |
| `JWT_SECRET` | Yes (prod) | Dev default | HMAC-256 secret (dev/test only) |
| `JWT_PRIVATE_KEY_PATH` | Yes (prod) | -- | RS256/ES256 private key path |
| `PLATFORM_FEE_RATE` | No | `0.001` | Platform fee rate (0.1%) |
| `DCA_CRON` | No | `0 * * * *` | DCA execution cron schedule |
| `REBALANCE_CRON` | No | `*/15 * * * *` | Rebalance check cron schedule |
| `FEATURED_APP_RIGHT_CID` | No | -- | GSF FeaturedAppRight contract ID |
| `VITE_BACKEND_URL` | No | `http://localhost:3001` | Backend URL for the frontend |

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. **Fork** the repository and create a feature branch from `main`
2. **Write tests** for any new functionality -- Daml scripts for contract changes, Vitest for backend/frontend, Playwright for E2E
3. **Run the full test suite** before submitting: `cd test && daml test && cd ../backend && npm test && cd ../ui && npm test`
4. **Follow existing code style** -- TypeScript strict mode, ESLint rules, Daml best practices
5. **Submit a pull request** with a clear description of what changed and why

For bug reports and feature requests, please [open an issue](https://github.com/Himess/roil-finance/issues).

---

## License

This project is licensed under the [MIT License](./LICENSE).

> **Note:** The frontend UI is maintained in a separate private repository ([Himess/roil-app](https://github.com/Himess/roil-app)) to protect the landing page and design assets. The `ui/` directory in this repo contains the original open-source React dashboard.

---

<p align="center">
  <strong>Roil</strong> &mdash; Private treasury management for the Canton era.
</p>

<p align="center">
  <a href="https://roil.app">App</a> &middot;
  <a href="https://roil.app/home">Landing Page</a> &middot;
  <a href="https://www.youtube.com/watch?v=_MagWXLwyiw">Demo Video</a> &middot;
  <a href="https://github.com/Himess/roil-finance">GitHub</a> &middot;
  <a href="https://www.canton.network/">Canton Network</a> &middot;
  <a href="https://www.cantex.io/">Cantex</a> &middot;
  <a href="https://www.templedigitalgroup.com/">Temple Digital Group</a>
</p>
