import 'dotenv/config';

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export type NetworkEnv = 'localnet' | 'devnet' | 'testnet' | 'mainnet';

const network = (process.env.CANTON_NETWORK || 'localnet') as NetworkEnv;

// ---------------------------------------------------------------------------
// Per-network defaults
// ---------------------------------------------------------------------------

const NETWORK_DEFAULTS: Record<NetworkEnv, {
  jsonApiUrl: string;
  grpcApiUrl: string;
  cantexApiUrl: string;
  scanUrl: string;
}> = {
  localnet: {
    jsonApiUrl: 'http://localhost:3975',                           // cn-quickstart app-provider
    grpcApiUrl: 'http://localhost:3901',
    cantexApiUrl: 'http://localhost:6100',                         // local cantex mock
    scanUrl: 'http://scan.localhost:4000',
  },
  devnet: {
    jsonApiUrl: 'http://159.195.71.102:5003',                     // Roil DevNet validator
    grpcApiUrl: 'http://159.195.71.102:5002',
    cantexApiUrl: 'https://api.devnet.cantex.io',
    scanUrl: 'https://scan.sv-1.dev.global.canton.network.sync.global',
  },
  testnet: {
    jsonApiUrl: 'http://159.195.78.106:5003',                     // Roil TestNet validator
    grpcApiUrl: 'http://159.195.78.106:5002',
    cantexApiUrl: 'https://api.testnet.cantex.io',
    scanUrl: 'https://scan.sv-1.test.global.canton.network.sync.global',
  },
  mainnet: {
    jsonApiUrl: 'https://json-api.sv-1.sync.global',              // MainNet JSON API
    grpcApiUrl: 'https://grpc-api.sv-1.sync.global',
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
  grpcApiUrl: process.env.GRPC_API_URL || defaults.grpcApiUrl,

  /** Canton Scan API URL (for registry lookups) */
  scanUrl: process.env.SCAN_URL || defaults.scanUrl,

  /** Cantex DEX API base URL */
  cantexApiUrl: process.env.CANTEX_API_URL || defaults.cantexApiUrl,

  /** Platform party identity (full party ID with fingerprint) */
  platformParty: process.env.PLATFORM_PARTY || 'app-provider::1220placeholder',

  /** Ledger API user ID */
  ledgerUserId: process.env.LEDGER_USER_ID || 'app-provider',

  /** Ledger API application ID */
  applicationId: process.env.APPLICATION_ID || 'roil-finance',

  // --- Auth ---

  /** JWT signing mode: 'unsafe' for local dev, 'rs256' / 'es256' for production */
  jwtMode: (process.env.JWT_MODE || 'unsafe') as 'unsafe' | 'rs256' | 'es256' | 'hmac256',

  /** HMAC-256 secret (dev/test only) */
  jwtSecret: process.env.JWT_SECRET || 'roil-finance-dev-secret',

  /** RS256/ES256 private key path (production) */
  jwtPrivateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || '',

  /** JWT audience */
  jwtAudience: process.env.JWT_AUDIENCE || 'https://daml.com/jwt/aud/participant/sandbox',

  /** Allowed CORS origins (comma-separated). Used in non-localnet environments. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),

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

  /** Validator party identity (for beneficiary weight split) */
  validatorParty: process.env.VALIDATOR_PARTY || '',

  /** App reward split: percentage to app party (rest to validator) */
  appRewardSplitPct: parseFloat(process.env.APP_REWARD_SPLIT_PCT || '0.8'),

  // --- Traffic Fee Subsidization ---
  /** Enable paying traffic fees on behalf of users */
  subsidizeTrafficFees: process.env.SUBSIDIZE_TRAFFIC === 'true',

  /** Target traffic throughput in bytes/sec for auto-top-up */
  trafficTargetThroughput: Number(process.env.TRAFFIC_TARGET_THROUGHPUT || '1000'),

  /** Minimum top-up interval in seconds */
  trafficMinTopupInterval: Number(process.env.TRAFFIC_MIN_TOPUP_INTERVAL || '600'),

  // --- Temple DEX ---
  templeApiUrl: process.env.TEMPLE_API_URL || 'https://app.templedigitalgroup.com/api',
  templeApiKey: process.env.TEMPLE_API_KEY || '',

  // --- Database ---
  /** PostgreSQL connection string. If not set, in-memory fallback is used. */
  databaseUrl: process.env.DATABASE_URL || '',

  // --- Daml package reference ---
  /** Package name as uploaded to the ledger */
  damlPackageName: process.env.DAML_PACKAGE_NAME || 'roil-finance',

  // --- Treasury swap engine ---
  treasury: {
    initialBalances: {
      CC: process.env.TREASURY_CC || '3000',
      USDCx: process.env.TREASURY_USDCX || '4000',
      CBTC: process.env.TREASURY_CBTC || '0.08',
      ETHx: process.env.TREASURY_ETHX || '0.7',
    },
    spreadRate: process.env.TREASURY_SPREAD || '0.005',
    maxTradeUsd: process.env.MAX_TRADE_USD || '25',
    dailyLimitUsd: process.env.DAILY_LIMIT_USD || '50',
    maxUsers: Number(process.env.MAX_WHITELIST_USERS || '1000'),
    maxExposurePct: 0.5,            // 50% max in single token
    oraclePauseThreshold: 0.05,     // 5% price move = pause
  },
} as const;

// ---------------------------------------------------------------------------
// Production safety checks
// ---------------------------------------------------------------------------

if (config.network !== 'localnet' && config.jwtMode === 'unsafe') {
  throw new Error('JWT_MODE=unsafe is not allowed in non-localnet environments');
}
if (config.network !== 'localnet' && config.jwtSecret === 'roil-finance-dev-secret') {
  throw new Error('FATAL: Cannot use default JWT secret in non-localnet environments. Set JWT_SECRET env variable.');
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
// Dynamic template ID resolution
// ---------------------------------------------------------------------------
//
// On localnet, #package-name:Module:Template works because the sandbox
// resolves the package name automatically. On devnet/testnet/mainnet the
// JSON Ledger API requires the full package hash. resolveTemplateIds()
// queries /v2/packages to find the roil-finance package hash and rewrites
// every template ID to use the qualified form: #<hash>:Module:Template.
// ---------------------------------------------------------------------------

let _resolvedPackageHash: string | null = null;

/**
 * Query the Ledger API for the roil-finance package hash.
 * The result is cached after first successful resolution.
 */
export async function resolvePackageHash(jsonApiUrl?: string): Promise<string | null> {
  if (_resolvedPackageHash) return _resolvedPackageHash;

  // On localnet, package-name references work — no resolution needed.
  if (config.network === 'localnet') return null;

  const baseUrl = jsonApiUrl ?? config.jsonApiUrl;

  // Auth token — production participants require a JWT even for /v2/packages.
  // We lazy-import buildJwt to avoid a config ↔ ledger module-load cycle.
  const { buildJwt } = await import('./ledger.js');
  const authHeader = `Bearer ${buildJwt([config.platformParty], [config.platformParty])}`;

  try {
    const res = await fetch(`${baseUrl}/v2/packages`, {
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { packageIds?: string[] };
    const packageIds = data.packageIds ?? [];

    // The package list alone does not map names to IDs. We iterate
    // through the returned IDs and query each one's metadata to match
    // by name. Canton's /v2/packages/<id> returns { name, version }.
    for (const pid of packageIds) {
      try {
        const metaRes = await fetch(`${baseUrl}/v2/packages/${pid}`, {
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        });
        if (!metaRes.ok) continue;

        const meta = (await metaRes.json()) as { name?: string; packageName?: string };
        if (
          meta.name === config.damlPackageName ||
          meta.packageName === config.damlPackageName
        ) {
          _resolvedPackageHash = pid;
          return pid;
        }
      } catch {
        // Skip this package and try the next
      }
    }

    // If name-based lookup did not work but there is only one non-system
    // package, assume it is ours (common during early dev).
    if (packageIds.length === 1) {
      _resolvedPackageHash = packageIds[0];
      return packageIds[0];
    }
  } catch {
    // Network error — fall back to name-based IDs
  }

  return null;
}

/**
 * Rewrite all TEMPLATES entries to use the resolved package hash.
 * Safe to call multiple times (idempotent after first resolution).
 * Returns the resolved hash or null if resolution was not needed/available.
 */
export async function resolveTemplateIds(): Promise<string | null> {
  const hash = await resolvePackageHash();

  if (!hash) return null;

  // Rewrite each template ID from #<name>:Module:Template
  // to #<hash>:Module:Template
  const templates = TEMPLATES as Record<string, string>;
  for (const key of Object.keys(templates)) {
    const current = templates[key];
    // Replace the package portion (between # and first :)
    templates[key] = current.replace(
      /^#[^:]+:/,
      `#${hash}:`,
    );
  }

  return hash;
}

/**
 * Clear cached package hash.
 * @internal Test-only — not intended for production use.
 */
export function _resetPackageHash(): void {
  _resolvedPackageHash = null;
}

// ---------------------------------------------------------------------------
// Fallback prices — used by PriceOracle when Cantex is unreachable
// ---------------------------------------------------------------------------

/**
 * Emergency fallback prices (in USDCx/USD) used when Cantex is completely
 * unreachable and no cached prices exist. These are approximate values and
 * should only be used as a last resort.
 */
export const FALLBACK_PRICES: Record<string, number> = {
  CC: 0.15,
  USDCx: 1.0,
  CBTC: 40_000.0,
  ETHx: 2_500.0,
  SOLx: 150.0,
  XAUt: 2_300.0,
  XAGt: 28.0,
  USTb: 1.0,
  MMF: 1.0,
};

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
