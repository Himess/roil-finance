# Roil Treasury Swap System

## Overview

Roil operates its own internal swap engine backed by a platform-managed treasury. The platform acts as market maker using oracle-based pricing with a fixed spread fee.

No external DEX dependency. No liquidity pool from users. Platform treasury handles all swaps.

---

## Current Configuration

| Parameter | Value | Env Variable |
|-----------|-------|-------------|
| **Max Users** | 1,000 (whitelist) | `MAX_WHITELIST_USERS` |
| **Daily Swap Limit** | $50 / user / day | `DAILY_LIMIT_USD` |
| **Max Trade Size** | $25 / trade | `MAX_TRADE_USD` |
| **Spread Fee** | 0.5% | `TREASURY_SPREAD` |
| **Max Exposure** | 50% (single token) | Config |
| **Oracle Pause** | 5% price move → pause 10 min | Config |

---

## Treasury Balances (Initial $10K)

| Token | Amount | ~USD Value | Allocation |
|-------|--------|-----------|------------|
| CC | 3,000 | $450 | 4.5% |
| USDCx | 4,000 | $4,000 | 40% |
| CBTC | 0.08 | $3,360 | 33.6% |
| ETHx | 0.7 | $2,170 | 21.7% |
| **Total** | | **~$9,980** | **100%** |

---

## Supported Pairs

Treasury inventory currently covers the 4 liquid assets above. The wider
Roil asset universe (9 instruments: CC, USDCx, CBTC, ETHx, SOLx, XAUt,
XAGt, USTb, MMF) is supported for portfolio targets and DEX-routed swaps
via Cantex + Temple; treasury pool-backed swaps are limited to the 4 assets
where the Roil treasury actually holds inventory.

| From → To | CC | USDCx | CBTC | ETHx |
|-----------|-----|-------|------|------|
| **CC** | - | ✅ | ✅ | ✅ |
| **USDCx** | ✅ | - | ✅ | ✅ |
| **CBTC** | ✅ | ✅ | - | ✅ |
| **ETHx** | ✅ | ✅ | ✅ | - |

Total: 12 directional pairs (treasury-pool backed). DEX-routed pairs scale
with whatever Cantex / Temple have liquidity for.

---

## How Swaps Work

```
1. User requests swap: "50 USDCx → CBTC"
2. System checks:
   - Is user whitelisted? ✅
   - Is daily limit OK? ($25 used + $50 = $75 > $50 limit) ❌ → reject
   - Is trade size OK? ($50 > $25 max) ❌ → reject
   - Adjusted: "25 USDCx → CBTC" ✅
3. Oracle price fetched: 1 CBTC = 42,000 USDCx
4. Raw output: 25 / 42,000 = 0.000595 CBTC
5. Spread deducted: 0.000595 × (1 - 0.005) = 0.000592 CBTC
6. Spread earned: 0.000003 CBTC (~$0.125)
7. Treasury updated:
   - USDCx: 4,000 + 25 = 4,025
   - CBTC: 0.08 - 0.000592 = 0.079408
8. User receives: 0.000592 CBTC
```

---

## Safety Mechanisms

### 1. Daily Volume Cap
- Each user: max $50/day in swap volume
- Resets at UTC midnight
- Prevents single user from draining treasury

### 2. Trade Size Cap
- Max $25 per single trade
- Prevents large single-direction moves

### 3. Exposure Limit
- No single token can exceed 50% of total treasury value
- If CBTC reaches 50%, swaps TO CBTC are blocked (FROM CBTC still allowed)
- Prevents concentration risk

### 4. Oracle Circuit Breaker
- If any token price moves >5% in 10 minutes → all swaps paused for 10 min
- Prevents trading on stale/manipulated prices
- Auto-resumes after cool-down

### 5. Whitelist Gate
- Only whitelisted users can swap
- Max 1,000 users
- Invite code system (3 codes per user)

---

## Revenue Model

| Metric | Value |
|--------|-------|
| Spread per trade | 0.5% |
| Avg trade size | ~$20 |
| Avg revenue per trade | $0.10 |
| Daily active users (10%) | 100 |
| Avg trades per active user | 2 |
| Daily trades | 200 |
| **Daily revenue** | **~$20** |
| **Monthly revenue** | **~$600** |

Revenue goes back to treasury → treasury grows → higher limits possible.

---

## Scaling Plan

| Phase | Users | Daily Limit | Trade Max | Treasury |
|-------|-------|-------------|-----------|----------|
| **Beta** | 1,000 | $50 | $25 | $10K |
| **Growth** | 5,000 | $200 | $100 | $50K |
| **Scale** | 25,000 | $1,000 | $500 | $250K |
| **Mature** | Unlimited | $10,000 | $5,000 | $1M+ |

All parameters adjustable via admin panel or environment variables.

---

## Admin Controls

All parameters can be adjusted at runtime:

- `PUT /api/admin/treasury/limits` — Update daily limit, trade max
- `PUT /api/admin/treasury/max-users` — Update whitelist capacity
- `PUT /api/admin/treasury/spread` — Update spread rate
- `POST /api/admin/treasury/pause` — Emergency pause all swaps
- `POST /api/admin/treasury/resume` — Resume swaps
- `GET /api/admin/treasury/health` — Treasury balances + exposure
- `GET /api/admin/treasury/history` — All swap history

---

## Daml Contracts

| Contract | Purpose |
|----------|---------|
| `TreasuryPool` | On-chain treasury state, swap execution, pause/resume |
| `TreasurySwapLog` | Immutable record of every swap |
| `WhitelistConfig` | Max users, limits, open/closed state |
| `WhitelistMember` | Individual user membership + invite codes |
| `InviteCode` | Invite code creation and redemption |

---

## Risk Assessment

### Worst Case: All 1000 users max out daily ($50K volume)
- Treasury: $10K
- Net directional flow (est. 20-30%): $10K-15K
- **Mitigation:** Exposure limits block before treasury depletes

### Realistic Case: 100 active users, mixed directions
- Volume: ~$5K/day
- Net flow: ~$1K-1.5K
- Treasury easily handles this

### Black Swan: Oracle manipulation
- **Mitigation:** 5% circuit breaker pauses trading
- **Mitigation:** Max trade $25 limits damage per trade

---

## v0.3.2+ on-chain hardening

The `UpdateBalances` choice on `TreasuryPool` now enforces **optimistic
concurrency**: callers pass the `expectedLastUpdatedAt` timestamp they
observed on the pool when they prepared the update. If two backend workers
race with stale snapshots, exactly one succeeds and the other fails with
an assertion error — no silent balance regression. The parameter is
`Optional Time` for upgrade compatibility with v0.3.0 callers; passing
`None` bypasses the check (deprecated path, retained only for backward
compatibility).

---

*Last updated: 2026-04-17 (v0.3.3)*
*Config changes require admin access or env var restart*
