# Security

## Authentication

Roil uses JWT-based authentication with four configurable modes via the `JWT_MODE` environment variable:

| Mode | Algorithm | Use Case |
|------|-----------|----------|
| `unsafe` | None (unsigned) | LocalNet development only |
| `rs256` | RSA-SHA256 | Production (default) |
| `es256` | ECDSA-SHA256 | Production (alternative) |
| `hmac256` | HMAC-SHA256 | Dev/test environments |

**Production safety:** The `unsafe` mode is explicitly blocked when `CANTON_NETWORK` is set to `devnet`, `testnet`, or `mainnet`. The server will refuse to start if an unsafe JWT mode is detected in a non-local environment.

JWT tokens carry the user's Canton party ID and ledger permissions (`actAs`, `readAs`), which are verified on every request.

## Authorization

Roil enforces a two-level authorization model:

- **Platform party** -- The application operator. Can create initial contracts, manage governance parameters, distribute rewards, and administer the whitelist.
- **User party** -- Individual users authenticated via Canton wallet. Can only read/write their own contracts. Daml's authorization model ensures a user cannot exercise choices on another user's contracts without explicit consent.

All Daml contract choices enforce `signatory` and `observer` constraints at the ledger level, providing cryptographic authorization guarantees beyond what the backend alone can enforce.

## Rate Limiting

Request rate limiting is applied via Redis-compatible middleware:

- Configurable window size and max requests per window
- Applied per-IP in development, per-party in production
- Returns HTTP 429 with `Retry-After` header when exceeded

## Input Validation

All API inputs are validated using Zod schemas before processing:

- Request body, query parameters, and path parameters are validated
- Invalid inputs return HTTP 400 with structured error details
- No raw user input reaches the Daml ledger without validation

## Security Headers

The following headers are set on all responses:

- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection`

Prototype pollution protection is enabled on request body parsing to prevent object injection attacks.

## Oracle Trust Assumptions

The price oracle uses a 4-tier fallback chain:

1. **Cantex DEX** -- On-chain AMM price (most trusted)
2. **Temple DEX** -- On-chain orderbook mid-price
3. **CoinGecko API** -- Off-chain market price (external dependency)
4. **Hardcoded defaults** -- Last-resort fallback for localnet/devnet

**Trust model:** In production, the oracle should primarily use on-chain prices from Cantex and Temple. The CoinGecko fallback introduces an off-chain dependency. The hardcoded defaults are only acceptable for development and testing.

Swap execution includes on-ledger slippage protection: the Daml contract asserts that the output amount meets a minimum threshold specified at submission time.

## Circuit Breaker

External service calls (DEX APIs, Scan API) are wrapped in a circuit breaker pattern:

- **Closed** -- Requests pass through normally
- **Open** -- After N consecutive failures, all requests are immediately rejected for a cooldown period
- **Half-open** -- After cooldown, a single probe request is allowed; success resets the breaker

This prevents cascading failures when external services are unavailable.

## Known Limitations

1. **Single backend instance** -- No distributed consensus on engine state. Running multiple backend instances could cause duplicate DCA executions. Use a single instance or add distributed locking before scaling horizontally.
2. **Oracle centralization** -- The backend is the sole price oracle for treasury swaps. A compromised backend could manipulate prices. Future versions should use multi-source oracle aggregation with on-chain verification.
3. **JWT key management** -- Private keys for RS256/ES256 are stored on disk. In production, use a hardware security module (HSM) or cloud KMS.
4. **Governance exists, but whitelist is permissioned** -- `Governance.daml` ships with platform-controlled freeze, pause, fee update, and audit-log flows. Whitelist entry addition/removal is still platform-only and has no on-chain vote yet; moving it under `Governance` is on the roadmap.
5. **No audit of frontend** -- The production frontend (Himess/roil-app) is private and undergoes its own review process; the open-source `ui/` directory is a reference build only.

### Backend-trusted contract patterns (planned on-chain hardening)

Several Daml templates historically leaned on the backend as a trusted component. Each item below lists its status in the current v0.3.2 DAR plus the planned direction for the v0.4 cycle after Featured App approval.

- **`TransferPreapproval.daml`** -- **Hardened in v0.3.2.** The reward provider is now a full signatory rather than an observer, so every preapproval creation, every transfer execution, and every log entry has on-chain authorization from the app provider. Backend-only enforcement of reward attribution is no longer required.
- **`Treasury.daml` — `UpdateBalances`** -- **Hardened in v0.3.2.** The choice now requires an `expectedLastUpdatedAt` parameter matching the pool's current timestamp. Two concurrent backend workers with stale snapshots cannot both succeed; exactly one wins and the other fails with an assertion error. Follow-up: also require a signed proof contract from the custody party before accepting a balance update.
- **`FeaturedApp.daml` — `RecordActivity`** -- **Hardened in v0.3.2.** Marker creation is idempotent on `activityId` via a bounded in-contract dedup list (`recentActivityIds`, capped at 1,000 most-recent entries). This defends against backend retries without using contract keys (which are unavailable on Daml-LF 3.x). A Canton-level command-dedup window is an additional layer. Follow-up: replace the list with a Splice-native dedup extension if one becomes available.
- **`Portfolio.daml` — `PriceCondition`** -- *Still backend-trusted.* Price bounds for conditional rebalance are accepted from the backend rather than re-checked on-chain against an oracle contract. Follow-up: wire in an on-chain `PriceOracle` template once a Canton oracle standard lands (tracking CIP discussions).
- **`Governance.daml` — `CanRebalance`** -- *Still a snapshot check.* The `nonconsuming` choice is a read-only view and there is a (small) race window between the check and a subsequent `Rebalance` exercise. In production the two commands are submitted back-to-back within a single backend handler, so the window is milliseconds and governance transitions are rare admin actions. Follow-up: convert to a consuming choice that returns a short-lived token consumed by the next action.

Every item above is an explicit trust-in-backend choice rather than an oversight. They are listed here so reviewers (and future contributors) can reason about the trust boundaries of the current v0.3.x DAR.
