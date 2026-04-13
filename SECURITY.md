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
4. **Whitelist is permissioned** -- Only the platform party can add/remove whitelist entries. There is no on-chain governance vote for whitelist changes yet (planned for future governance upgrades).
5. **No audit of frontend** -- The open-source `ui/` directory has basic security. The production frontend (Himess/roil-app) is private and should undergo separate security review.
