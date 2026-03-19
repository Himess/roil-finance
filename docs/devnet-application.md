# DevNet Application — Roil

## Email Draft (to: operations@sync.global)

**Subject:** DevNet Validator Sponsorship Request — Roil (Portfolio Management dApp)

---

Hi GSF Operations Team,

We are building **Roil**, a privacy-preserving portfolio management platform on Canton Network. We would like to request DevNet access to test our application with real Canton infrastructure.

### About the Application

**Roil** is a Glider-style portfolio rebalancer that leverages Canton's sub-transaction privacy to offer:

- **Smart Order Router** — Automatically selects the best price across Cantex AMM and Temple Digital Group Orderbook (CLOB) for every swap
- **Private Portfolio Rebalancing** — Users set target allocations across 9 supported assets (CC, USDCx, CBTC, ETHx, SOLx, XAUt, XAGt, USTb, MMF), system auto-rebalances when drift exceeds threshold
- **Dollar Cost Averaging (DCA)** — Recurring purchases at configurable intervals (hourly/daily/weekly/monthly)
- **Auto-Compounding** — Automatic yield reinvestment from staking/lending/LP positions
- **Reward Tiers** — TX-based loyalty system (Bronze→Platinum) with fee rebates

### Technical Stack

- **Smart Contracts:** Daml 3.4.11 (6 Daml contract modules, 240+ tests across backend/Daml/frontend, 9 supported assets including RWA tokens (gold, silver, treasury bonds))
- **Backend:** TypeScript/Express with Canton JSON Ledger API v2
- **Frontend:** React 19 + Vite + Tailwind CSS
- **DEX Integration:** Smart Order Router across Cantex AMM (Ed25519 auth + secp256k1 swap signing) and Temple Digital Group Orderbook (CLOB with limit orders)
- **Token Standard:** CIP-0056 compliant token transfers
- **Featured App:** Activity marker integration ready (splice-api-featured-app-v1)

### Live Demo

https://roil-finance.vercel.app

### GitHub Repository

https://github.com/Himess/roil-finance (public repository)

### Why Canton?

Portfolio composition and trading activity are sensitive data. Canton's sub-transaction privacy ensures that:
- No one sees a user's portfolio allocation
- Trade timing and sizes remain private
- Rebalancing strategies are confidential

This is impossible on transparent chains like Ethereum.

### Transaction Volume Potential

Each user generates multiple TXs per operation:
- Rebalance: 3-5 swap TXs + ledger updates
- DCA: 1-2 TXs per execution (hourly/daily)
- Compound: 2-3 TXs per compound cycle
- Rewards: 1 TX per recording + monthly distribution

Conservative estimate: 500+ TXs/day per 100 active users.

### Validator Node Requirements

- Docker-capable VPS/cloud instance with static egress IP
- Minimum 4 vCPU, 8 GB RAM, 100 GB SSD recommended
- Port 443 open for Canton gRPC + JSON API TLS endpoints

### Request

- **DevNet validator sponsorship** (we can use GSF as sponsor)
- **Static egress IP:** [will provide after VPS setup]
- **Timeline:** Ready to deploy immediately after IP allowlisting

### Contact

[Your Name]
[Your Email]
GitHub: @Himess

Thank you for considering our application.

---

## Checklist Before Sending

- [ ] Set up VPS/cloud instance with static IP for validator node
- [ ] Ensure Docker is running on the VPS
- [ ] Prepare DAR file for deployment
- [ ] Test full flow on LocalNet first
- [ ] Make GitHub repo accessible to GSF team (or make public temporarily)

## After Approval

1. Receive sponsor URL from GSF
2. Generate onboarding secret: `curl -X POST SPONSOR_URL/api/sv/v0/devnet/onboard/validator/prepare`
3. Deploy validator: `./start.sh -s "SPONSOR_URL" -o "SECRET" -p "roil-1" -w`
4. Upload DAR to participant
5. Configure Cantex SDK with DevNet keys
6. Update .env with DevNet config
7. Test full flow with real tokens
