# Canton Rebalancer

Private portfolio rebalancer on Canton Network. Auto-rebalance, DCA, and compound — all with sub-transaction privacy.

## Features

- **Portfolio Management** — Set target allocations across 9 supported assets with 8 pre-built strategy templates
- **Auto-Rebalance** — Automatic rebalancing when drift exceeds threshold or price conditions are met
- **DCA (Dollar Cost Averaging)** — Recurring purchases at configurable intervals
- **Auto-Compounding** — Auto-compounding (simulated yield sources) with 3 reinvestment strategies
- **Performance Tracking** — 24h/7d/30d portfolio analytics and snapshots
- **Portfolio Templates** — 8 pre-built strategy templates (Conservative, Balanced Growth, BTC-ETH Maxi, etc.)
- **Create Wizard** — Step-by-step portfolio creation with equal or custom weight modes
- **Reward Tiers** — Bronze → Silver → Gold → Platinum based on monthly TX count
- **RWA Tokens** — Tokenized gold (XAUt), silver (XAGt), treasury bonds (USTb), money market fund (MMF)
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
| Frontend | React 19, Vite, Tailwind CSS, Recharts |
| DEX | Cantex (CaviarNine) |
| Wallet | @canton-network/dapp-sdk |

## Quick Start

### Prerequisites
- Java 17 (JAVA_HOME set)
- Daml SDK 3.4.11
- Node.js 20+

### Setup (Recommended — LocalNet via Docker)
```bash
# Environment (required for Turkish locale systems)
source .envrc

# Start Canton LocalNet (builds contracts, starts Docker services, uploads DAR)
./scripts/setup-localnet.sh

# Initialize ledger (allocate parties, create initial contracts)
cd backend && npx tsx ../scripts/init-ledger.ts

# Start backend
cd backend && npm run dev

# Start frontend (separate terminal)
cd ui && npm run dev
```

Open http://localhost:5173 to access the UI, backend API runs on http://localhost:3001.

### Alternative — Manual Canton Sandbox
```bash
# Build Daml contracts
cd main && daml build && cd ..
cd test && daml build && daml test && cd ..

# Start sandbox with JSON API (Daml 3.x syntax)
cd main && daml start --json-api-port 3975

# Backend (separate terminal)
cd backend && npm install && npm run dev

# Frontend (separate terminal)
cd ui && npm install && npm run dev
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

| Asset | Description | Category |
|-------|-------------|----------|
| CC | Canton Coin (native) | Crypto |
| USDCx | USDC on Canton (Circle) | Stablecoin |
| CBTC | Wrapped Bitcoin (BitSafe) | Crypto |
| ETHx | Canton ETH | Crypto |
| SOLx | Canton SOL | Crypto |
| XAUt | Tokenized Gold | RWA |
| XAGt | Tokenized Silver | RWA |
| USTb | US Treasury Bond | RWA |
| MMF | Money Market Fund | RWA |

## Testing

~240 automated tests (204 backend + 26 Daml + 9 frontend).

## License

MIT
