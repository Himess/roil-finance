# Architecture

## High-Level Overview

```
Canton Participant Node (Daml Ledger)
        |
        | Ledger API v2 (JSON + gRPC)
        |
Backend (Express + TypeScript)
        |
        | REST API + SSE
        |
Frontend (React 19 + Vite)         <- Separate repo: Himess/roil-app
```

Roil follows a three-tier architecture. The Canton participant node runs the Daml smart contracts and provides the ledger. The backend orchestrates all business logic and exposes a REST API. The frontend (maintained in a separate private repository) consumes that API.

## Daml Contracts (10 modules)

All contracts live in `main/daml/` and are compiled into a single DAR file.

| Module | Purpose | Key Templates |
|--------|---------|---------------|
| **Types** | Shared types used across all modules | AssetId, Holding, Tier, TriggerMode |
| **Portfolio** | Portfolio state and rebalancing | Portfolio, RebalanceRequest, CompoundConfig |
| **DCA** | Dollar-cost averaging schedules | DCASchedule, DCAExecution, DCALog |
| **RewardTracker** | Tier-based reward system | RewardTracker, RewardPayout, Referral |
| **TokenTransfer** | CIP-0056 token transfers | TransferRequest, SwapRequest, TransferLog |
| **TransferPreapproval** | Auto-accept transfer patterns | TransferPreapproval |
| **Treasury** | Treasury swap with oracle pricing | TreasuryConfig, TreasurySwap |
| **Whitelist** | Invite code gating | WhitelistConfig, WhitelistEntry |
| **Governance** | Platform parameter control | GovernanceAction, AuditLog, FreezeState |
| **FeaturedApp** | GSF Featured App rewards | FeaturedAppConfig, ActivityRecord |

Contract relationships:
- **Types** is imported by all other modules
- **Portfolio** references TokenTransfer for swap execution
- **DCA** creates SwapRequests via TokenTransfer
- **Treasury** uses Whitelist to gate access
- **Governance** can freeze/pause Portfolio, DCA, and Treasury operations

## Backend Structure

The backend is organized into four layers under `backend/src/`:

### Engines (`engine/`)
Core business logic that orchestrates Daml contract operations:
- `rebalance.ts` -- Drift calculation, swap leg planning, execution
- `dca.ts` -- Cron-based DCA scheduling and execution
- `compound.ts` -- Yield detection and reinvestment
- `rewards.ts` -- Tier calculation, monthly payout distribution
- `featured-app.ts` -- GSF activity marker submission

### Services (`services/`)
External integrations and shared capabilities:
- `smart-router.ts` -- DEX aggregator (Cantex AMM + Temple CLOB)
- `price-oracle.ts` -- 4-tier price fallback (Cantex -> Temple -> CoinGecko -> hardcoded)
- `token-transfer.ts` -- CIP-0056 transfer execution
- `transaction-stream.ts` -- SSE event stream from the ledger
- `scan-client.ts` -- Canton Scan API for network data
- `performance-tracker.ts` -- Portfolio snapshot history

### Routes (`routes/`)
Express route handlers that validate input (Zod), call engines/services, and return responses. One file per domain (portfolio, dca, compound, rewards, market, transfers, metrics).

### Middleware (`middleware/`)
Cross-cutting concerns: JWT authentication, rate limiting, security headers, error handling, metrics collection.

## Authentication Flow

```
Client -> [JWT Token] -> auth middleware -> decode & verify -> attach party to req
```

Four JWT modes controlled by `JWT_MODE`:
1. **unsafe** -- Accepts unsigned tokens (localnet only, blocked in production)
2. **rs256** -- RSA asymmetric keys (production default)
3. **es256** -- ECDSA asymmetric keys (production alternative)
4. **hmac256** -- Symmetric secret (dev/test only)

The JWT payload contains the user's Canton party ID and ledger permissions (`actAs`, `readAs`). The auth middleware extracts the party and attaches it to the request context for downstream use.

## Key Data Flows

### Rebalance
1. Frontend requests rebalance for a portfolio
2. Backend fetches current holdings from ledger (Portfolio contract)
3. Rebalance engine calculates drift per asset vs. target allocation
4. If any asset exceeds drift threshold, engine plans swap legs
5. Smart router fetches quotes from Cantex + Temple, picks best price
6. Backend submits SwapRequest to ledger via Ledger API v2
7. Daml contract validates authorization and slippage, executes atomically
8. SSE stream pushes update to frontend

### DCA Execution
1. Cron job fires on configured schedule (default: hourly)
2. DCA engine queries active DCASchedule contracts from ledger
3. For each due schedule, engine creates a SwapRequest
4. Smart router determines best execution venue
5. Swap executes on ledger; DCAExecution record created
6. DCALog updated with execution result

### Treasury Swap
1. User initiates swap via Treasury UI
2. Backend checks Whitelist contract to verify user is approved
3. Backend checks Governance state (not frozen/paused)
4. Price oracle provides current rate; spread fee applied
5. TreasurySwap contract created and executed on ledger
6. Platform fee deducted; net amount delivered to user
