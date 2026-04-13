# Changelog

## [0.2.0] - 2026-03-26

### Added
- Treasury swap system with oracle pricing and spread fees
- Whitelist system with invite codes (max 1000 users)
- Governance module (freeze, pause, fee updates, audit logs)
- TransferPreapproval contract for auto-accept patterns
- Featured App integration for GSF App Rewards
- Smart Order Router (Cantex AMM + Temple CLOB)
- Compound engine with 3 reinvestment strategies
- Circuit breaker pattern for external service calls
- Prometheus + Grafana monitoring stack
- Comprehensive security middleware (rate limiting, prototype pollution protection)

### Changed
- Upgraded from 6 to 10 Daml contract modules
- Removed contract keys for Daml-LF 3.x compatibility
- Backend restructured with engine/service/route separation

## [0.1.0] - 2026-02-15

### Added
- Initial release
- Portfolio management with drift-based rebalancing
- DCA scheduling (hourly/daily/weekly/monthly)
- Reward tier system (Bronze/Silver/Gold/Platinum)
- Token transfer (CIP-0056)
- Basic Cantex DEX integration
