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
  grpcApiUrl: process.env.GRPC_API_URL || 'http://localhost:3901', // Override for devnet/mainnet

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

  // --- Platform fee ---
  platformFeeRate: parseFloat(process.env.PLATFORM_FEE_RATE || '0.001'),

  // --- Cron ---
  dcaCronSchedule: process.env.DCA_CRON || '0 * * * *',
  rebalanceCronSchedule: process.env.REBALANCE_CRON || '*/15 * * * *', // every 15 min

  // --- Featured App ---
  /** FeaturedAppRight contract ID from GSF registration */
  featuredAppRightCid: process.env.FEATURED_APP_RIGHT_CID || '',

  // --- Temple DEX ---
  templeApiUrl: process.env.TEMPLE_API_URL || 'https://app.templedigitalgroup.com/api',
  templeApiKey: process.env.TEMPLE_API_KEY || '',

  // --- Daml package reference ---
  /** Package name as uploaded to the ledger */
  damlPackageName: process.env.DAML_PACKAGE_NAME || 'canton-rebalancer',
} as const;

// ---------------------------------------------------------------------------
// Production safety checks
// ---------------------------------------------------------------------------

if (config.network !== 'localnet' && config.jwtMode === 'unsafe') {
  throw new Error('JWT_MODE=unsafe is not allowed in non-localnet environments');
}
if (config.network !== 'localnet' && config.jwtSecret === 'canton-rebalancer-dev-secret') {
  throw new Error('Default JWT_SECRET must be changed in non-localnet environments');
}

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
  CompoundConfig: `#${pkg}:Portfolio:CompoundConfig`,
  UserPreferences: `#${pkg}:Portfolio:UserPreferences`,
  PortfolioAuditLog: `#${pkg}:Portfolio:PortfolioAuditLog`,
  CompoundLog: `#${pkg}:Portfolio:CompoundLog`,
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
  ETHx: { id: 'ETHx', admin: process.env.ETHX_ADMIN_PARTY || '' },
  SOLx: { id: 'SOLx', admin: process.env.SOLX_ADMIN_PARTY || '' },
  XAUt: { id: 'XAUt', admin: process.env.XAUT_ADMIN_PARTY || '' },  // Tokenized Gold
  XAGt: { id: 'XAGt', admin: process.env.XAGT_ADMIN_PARTY || '' },  // Tokenized Silver
  USTb: { id: 'USTb', admin: process.env.USTB_ADMIN_PARTY || '' },  // US Treasury Bonds
  MMF: { id: 'MMF', admin: process.env.MMF_ADMIN_PARTY || '' },    // Money Market Fund
} as const;

// ---------------------------------------------------------------------------
// Portfolio templates — pre-built strategies
// ---------------------------------------------------------------------------

export const PORTFOLIO_TEMPLATES = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Heavy stablecoin allocation with bond exposure for stability',
    targets: [
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 40 },
      { asset: { symbol: 'USTb', admin: '' }, targetPct: 30 },
      { asset: { symbol: 'XAUt', admin: '' }, targetPct: 20 },
      { asset: { symbol: 'CC', admin: '' }, targetPct: 10 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '3.0' },
    riskLevel: 'low',
    tags: ['stablecoin', 'low-risk', 'bonds'],
  },
  {
    id: 'balanced',
    name: 'Balanced Growth',
    description: 'Mix of crypto, stablecoins, and real-world assets',
    targets: [
      { asset: { symbol: 'CBTC', admin: '' }, targetPct: 25 },
      { asset: { symbol: 'ETHx', admin: '' }, targetPct: 20 },
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 25 },
      { asset: { symbol: 'XAUt', admin: '' }, targetPct: 15 },
      { asset: { symbol: 'CC', admin: '' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '5.0' },
    riskLevel: 'medium',
    tags: ['balanced', 'growth'],
  },
  {
    id: 'btc-eth-maxi',
    name: 'BTC-ETH Maxi',
    description: 'Heavy crypto allocation focused on Bitcoin and Ethereum',
    targets: [
      { asset: { symbol: 'CBTC', admin: '' }, targetPct: 50 },
      { asset: { symbol: 'ETHx', admin: '' }, targetPct: 30 },
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 20 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '7.0' },
    riskLevel: 'high',
    tags: ['bitcoin', 'ethereum', 'crypto-heavy'],
  },
  {
    id: 'crypto-basket',
    name: 'Crypto Basket',
    description: 'Diversified across all major crypto assets with stablecoin base',
    targets: [
      { asset: { symbol: 'CBTC', admin: '' }, targetPct: 30 },
      { asset: { symbol: 'ETHx', admin: '' }, targetPct: 25 },
      { asset: { symbol: 'SOLx', admin: '' }, targetPct: 15 },
      { asset: { symbol: 'CC', admin: '' }, targetPct: 15 },
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '5.0' },
    riskLevel: 'high',
    tags: ['diversified', 'crypto', 'multi-asset'],
  },
  {
    id: 'precious-metals',
    name: 'Precious Metals',
    description: 'Pure gold and silver allocation — classic safe haven',
    targets: [
      { asset: { symbol: 'XAUt', admin: '' }, targetPct: 60 },
      { asset: { symbol: 'XAGt', admin: '' }, targetPct: 40 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '3.0' },
    riskLevel: 'low',
    tags: ['rwa', 'precious-metals', 'gold', 'silver'],
  },
  {
    id: 'institutional',
    name: 'Institutional Grade',
    description: 'Treasury bonds core with gold hedge and crypto satellite',
    targets: [
      { asset: { symbol: 'USTb', admin: '' }, targetPct: 40 },
      { asset: { symbol: 'XAUt', admin: '' }, targetPct: 25 },
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 20 },
      { asset: { symbol: 'CBTC', admin: '' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '4.0' },
    riskLevel: 'medium',
    tags: ['institutional', 'bonds', 'treasury', 'rwa'],
  },
  {
    id: 'stablecoin-yield',
    name: 'Stablecoin Yield',
    description: 'Capital preservation with CC exposure for platform rewards',
    targets: [
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 70 },
      { asset: { symbol: 'CC', admin: '' }, targetPct: 30 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '2.0' },
    riskLevel: 'low',
    tags: ['stablecoin', 'yield', 'safe'],
  },
  {
    id: 'all-weather',
    name: 'All Weather',
    description: 'Ray Dalio inspired — performs in any market condition',
    targets: [
      { asset: { symbol: 'USTb', admin: '' }, targetPct: 30 },
      { asset: { symbol: 'XAUt', admin: '' }, targetPct: 20 },
      { asset: { symbol: 'CBTC', admin: '' }, targetPct: 20 },
      { asset: { symbol: 'USDCx', admin: '' }, targetPct: 15 },
      { asset: { symbol: 'ETHx', admin: '' }, targetPct: 15 },
    ],
    triggerMode: { tag: 'DriftThreshold', value: '5.0' },
    riskLevel: 'medium',
    tags: ['all-weather', 'balanced', 'multi-asset'],
  },
] as const;

// ---------------------------------------------------------------------------
// Admin party validation (non-localnet)
// ---------------------------------------------------------------------------

if (config.network !== 'localnet') {
  const missingAdmins = Object.entries(INSTRUMENTS)
    .filter(([_, inst]) => !inst.admin)
    .map(([key]) => key);
  if (missingAdmins.length > 0) {
    throw new Error(`Missing admin party for instruments: ${missingAdmins.join(', ')}. Set CC_ADMIN_PARTY, USDCX_ADMIN_PARTY, CBTC_ADMIN_PARTY, ETHX_ADMIN_PARTY, SOLX_ADMIN_PARTY, XAUT_ADMIN_PARTY, XAGT_ADMIN_PARTY, USTB_ADMIN_PARTY, MMF_ADMIN_PARTY env vars.`);
  }
}
