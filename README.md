# Canton Rebalancer

Private portfolio rebalancer on Canton Network. Auto-rebalance, DCA, and compound — all with sub-transaction privacy.

## Features

- **Portfolio Management** — Set target allocations across CC, USDCx, CBTC
- **Auto-Rebalance** — Automatic rebalancing when drift exceeds threshold
- **DCA (Dollar Cost Averaging)** — Recurring purchases at configurable intervals
- **Reward Tiers** — Bronze → Silver → Gold → Platinum based on monthly TX count
- **Privacy** — Portfolio composition, trades, and balances hidden via Canton's sub-transaction privacy

## Architecture

```
Frontend (React + Vite) → Backend (Express API) → Canton Ledger (Daml)
                                                → Cantex DEX (Swaps)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Daml 3.4.11 |
| Backend | TypeScript, Express, node-cron |
| Frontend | React 18, Vite, Tailwind CSS, Recharts |
| DEX | Cantex (CaviarNine) |
| Wallet | @canton-network/dapp-sdk |

## Quick Start

### Prerequisites
- Java 17 (JAVA_HOME set)
- Daml SDK 3.4.11
- Node.js 20+

### Setup
```bash
# Environment (required for Turkish locale systems)
source .envrc

# Build Daml contracts
cd main && daml build && cd ..
cd test && daml build && daml test && cd ..

# Backend
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd ui && npm install && npm run dev
```

### Start Canton Sandbox
```bash
cd main && daml sandbox --json-api-port 7575 --dar .daml/dist/canton-rebalancer-0.1.0.dar
```

## Project Structure

```
canton-rebalancer/
├── main/daml/              # Daml smart contracts
│   ├── Types.daml          # Core types (AssetId, Holding, Tier, etc.)
│   ├── Portfolio.daml      # Portfolio + Rebalance contracts
│   ├── DCA.daml            # DCA schedule + execution
│   └── RewardTracker.daml  # Reward tier system
├── test/daml/              # Daml tests (6 test scripts)
├── backend/src/            # Express API + engines
│   ├── engine/             # Rebalance, DCA, Rewards engines
│   ├── routes/             # API routes
│   ├── ledger.ts           # Daml JSON API client
│   └── cantex.ts           # Cantex DEX integration
├── ui/src/                 # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # Custom React hooks
│   └── pages/              # Dashboard, DCA, Rewards
└── .github/workflows/      # CI/CD
```

## Reward Tiers

| Tier | Monthly TXs | Fee Back |
|------|-------------|----------|
| Bronze | 0–50 | 0.5% |
| Silver | 51–200 | 1.0% |
| Gold | 201–500 | 2.0% |
| Platinum | 500+ | 3.0% |

## Assets

| Asset | Description |
|-------|-------------|
| CC | Canton Coin (native) |
| USDCx | USDC on Canton (Circle) |
| CBTC | Wrapped Bitcoin (BitSafe) |

## License

MIT
