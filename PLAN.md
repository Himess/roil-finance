# Canton Rebalancer — Implementation Plan

## Done
- [x] Daml contracts (Types, Portfolio, DCA, RewardTracker)
- [x] Daml tests (6/6 passing)
- [x] SDK + JDK installed

## Architecture

```
┌─────────────────────────────────┐
│     Frontend (React + Vite)     │
│  @daml/ledger + dapp-sdk       │
├─────────────────────────────────┤
│     Backend (Express + TS)      │
│  Rebalance Engine + DCA Cron    │
│  Cantex Python bridge           │
├─────────────────────────────────┤
│     Canton Ledger (Daml)        │
│  Portfolio, DCA, Rewards        │
├─────────────────────────────────┤
│     Cantex DEX (Swaps)          │
└─────────────────────────────────┘
```

## Build Order (Parallel Tracks)

### Track A: Backend
1. backend/package.json + tsconfig
2. backend/src/config.ts — env vars, constants
3. backend/src/ledger.ts — Daml ledger client (@daml/ledger)
4. backend/src/cantex.ts — Cantex swap bridge (Python subprocess or REST)
5. backend/src/engine/rebalance.ts — drift calc, swap leg planning
6. backend/src/engine/dca.ts — DCA execution scheduler
7. backend/src/engine/rewards.ts — TX recording, tier calc
8. backend/src/server.ts — Express API routes
9. backend/src/index.ts — entry point

### Track B: Frontend
1. ui/package.json + vite.config.ts + tsconfig
2. ui/src/config.ts — ledger URL, party config
3. ui/src/hooks/useLedger.ts — Daml ledger connection
4. ui/src/hooks/usePortfolio.ts — portfolio CRUD
5. ui/src/hooks/useDCA.ts — DCA management
6. ui/src/hooks/useRewards.ts — reward stats
7. ui/src/components/AllocationChart.tsx — pie chart (target vs actual)
8. ui/src/components/AssetRow.tsx — single asset with slider
9. ui/src/components/DriftIndicator.tsx — drift bar
10. ui/src/components/DCACard.tsx — DCA schedule card
11. ui/src/components/RewardTier.tsx — tier badge + progress
12. ui/src/components/SwapHistory.tsx — rebalance/DCA log table
13. ui/src/pages/Dashboard.tsx — main page
14. ui/src/pages/DCAPage.tsx — DCA config
15. ui/src/pages/RewardsPage.tsx — rewards view
16. ui/src/App.tsx + main.tsx + index.html

### Track C: Integration + DevOps
1. Daml codegen → ui/src/daml.js/
2. .github/workflows/ci.yml
3. README.md
