import 'dotenv/config';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export type NetworkEnv = 'localnet' | 'devnet' | 'testnet' | 'mainnet';

const network = (process.env.CANTON_NETWORK || 'localnet') as NetworkEnv;

// ---------------------------------------------------------------------------
// Per-network defaults
// ---------------------------------------------------------------------------

const NETWORK_DEFAULTS: Record<NetworkEnv, { jsonApiUrl: string; cantexApiUrl: string; scanUrl: string }> = {
  localnet: {
    jsonApiUrl: 'http://localhost:3975',       // cn-quickstart app-provider
    cantexApiUrl: 'http://localhost:6100',      // local cantex mock
    scanUrl: 'http://scan.localhost:4000',
  },
  devnet: {
    jsonApiUrl: 'http://json-ledger-api.localhost:80',
    cantexApiUrl: 'https://api.devnet.cantex.io',
    scanUrl: 'https://scan.sv-1.devnet.sync.global',
  },
  testnet: {
    jsonApiUrl: 'http://json-ledger-api.localhost:80',
    cantexApiUrl: 'https://api.testnet.cantex.io',
    scanUrl: 'https://scan.sv-1.testnet.sync.global',
  },
  mainnet: {
    jsonApiUrl: 'http://json-ledger-api.localhost:80',
    cantexApiUrl: 'https://api.cantex.io',
    scanUrl: 'https://scan.sv-1.sync.global',
  },
};

const defaults = NETWORK_DEFAULTS[network];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const config = {
  /** Current network environment */
  network,

  /** Express server port */
  port: Number(process.env.PORT) || 3001,

  /** Canton JSON Ledger API v2 base URL */
  jsonApiUrl: process.env.JSON_API_URL || defaults.jsonApiUrl,

  /** Canton gRPC Ledger API (for advanced use) */
  grpcApiUrl: process.env.GRPC_API_URL || 'http://localhost:3901',

  /** Canton Scan API URL (for registry lookups) */
  scanUrl: process.env.SCAN_URL || defaults.scanUrl,

  /** Cantex DEX API base URL */
  cantexApiUrl: process.env.CANTEX_API_URL || defaults.cantexApiUrl,

  /** Platform party identity (full party ID with fingerprint) */
  platformParty: process.env.PLATFORM_PARTY || 'app-provider::1220placeholder',

  /** Ledger API user ID */
  ledgerUserId: process.env.LEDGER_USER_ID || 'app-provider',

  /** Ledger API application ID */
  applicationId: process.env.APPLICATION_ID || 'canton-rebalancer',

  // --- Auth ---

  /** JWT signing mode: 'unsafe' for local dev, 'rs256' / 'es256' for production */
  jwtMode: (process.env.JWT_MODE || 'unsafe') as 'unsafe' | 'rs256' | 'es256' | 'hmac256',

  /** HMAC-256 secret (dev/test only) */
  jwtSecret: process.env.JWT_SECRET || 'canton-rebalancer-dev-secret',

  /** RS256/ES256 private key path (production) */
  jwtPrivateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || '',

  /** JWT audience */
  jwtAudience: process.env.JWT_AUDIENCE || 'https://daml.com/jwt/aud/participant/sandbox',

  // --- Cantex ---

  /** Cantex operator key (Ed25519 hex) */
  cantexOperatorKey: process.env.CANTEX_OPERATOR_KEY || '',

  /** Cantex trading key (secp256k1 hex) */
  cantexTradingKey: process.env.CANTEX_TRADING_KEY || '',

  // --- Rebalance settings ---
  defaultDriftThreshold: 5.0,
  minTxValue: 10.0,

  // --- Cron ---
  dcaCronSchedule: process.env.DCA_CRON || '0 * * * *',
  rebalanceCronSchedule: process.env.REBALANCE_CRON || '*/15 * * * *', // every 15 min

  // --- Daml package reference ---
  /** Package name as uploaded to the ledger */
  damlPackageName: process.env.DAML_PACKAGE_NAME || 'canton-rebalancer',
} as const;

// ---------------------------------------------------------------------------
// Daml template IDs — format: #package-name:Module:Template
// ---------------------------------------------------------------------------

const pkg = config.damlPackageName;

export const TEMPLATES = {
  PortfolioProposal: `#${pkg}:Portfolio:PortfolioProposal`,
  Portfolio: `#${pkg}:Portfolio:Portfolio`,
  RebalanceRequest: `#${pkg}:Portfolio:RebalanceRequest`,
  RebalanceLog: `#${pkg}:Portfolio:RebalanceLog`,
  DCASchedule: `#${pkg}:DCA:DCASchedule`,
  DCAExecution: `#${pkg}:DCA:DCAExecution`,
  DCALog: `#${pkg}:DCA:DCALog`,
  RewardTracker: `#${pkg}:RewardTracker:RewardTracker`,
  RewardPayout: `#${pkg}:RewardTracker:RewardPayout`,
  Referral: `#${pkg}:RewardTracker:Referral`,
  ReferralCredit: `#${pkg}:RewardTracker:ReferralCredit`,
  FeaturedAppConfig: `#${pkg}:FeaturedApp:FeaturedAppConfig`,
  ActivityRecord: `#${pkg}:FeaturedApp:ActivityRecord`,
} as const;

// ---------------------------------------------------------------------------
// CIP-0056 Token Standard interfaces
// ---------------------------------------------------------------------------

export const TOKEN_STANDARD = {
  Holding: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
  TransferInstruction: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
  TransferFactory: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
  AllocationFactory: '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:AllocationFactory',
} as const;

// ---------------------------------------------------------------------------
// Asset instrument IDs (Canton Network tokens)
// ---------------------------------------------------------------------------

export const INSTRUMENTS = {
  CC: { id: 'CC', admin: process.env.CC_ADMIN_PARTY || '' },
  USDCx: { id: 'USDCx', admin: process.env.USDCX_ADMIN_PARTY || '' },
  CBTC: { id: 'CBTC', admin: process.env.CBTC_ADMIN_PARTY || '' },
} as const;
