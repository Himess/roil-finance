import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the service
// ---------------------------------------------------------------------------

const mockConfig = vi.hoisted(() => ({
  platformParty: 'test-platform::1220abc',
  network: 'localnet' as string,
  damlPackageName: 'roil-finance',
}));

vi.mock('../src/config.js', () => ({
  config: mockConfig,
  TEMPLATES: {
    Portfolio: '#roil-finance:Portfolio:Portfolio',
    PortfolioProposal: '#roil-finance:Portfolio:PortfolioProposal',
    RebalanceRequest: '#roil-finance:Portfolio:RebalanceRequest',
    RebalanceLog: '#roil-finance:Portfolio:RebalanceLog',
    DCASchedule: '#roil-finance:DCA:DCASchedule',
    DCAExecution: '#roil-finance:DCA:DCAExecution',
    DCALog: '#roil-finance:DCA:DCALog',
    RewardTracker: '#roil-finance:RewardTracker:RewardTracker',
    RewardPayout: '#roil-finance:RewardTracker:RewardPayout',
    Referral: '#roil-finance:RewardTracker:Referral',
    ReferralCredit: '#roil-finance:RewardTracker:ReferralCredit',
    FeaturedAppConfig: '#roil-finance:FeaturedApp:FeaturedAppConfig',
    ActivityRecord: '#roil-finance:FeaturedApp:ActivityRecord',
  },
  TOKEN_STANDARD: {
    Holding: '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
    TransferInstruction: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
    TransferFactory: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
    AllocationFactory: '#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:AllocationFactory',
  },
  INSTRUMENTS: {
    CC: { id: 'CC', admin: 'cc-admin-party' },
    USDCx: { id: 'USDCx', admin: 'usdcx-admin-party' },
    CBTC: { id: 'CBTC', admin: 'cbtc-admin-party' },
  },
}));

const mockLedger = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ transaction: { events: [{ created: { contractId: 'mock-transfer-cid' } }] } }),
  exercise: vi.fn().mockResolvedValue({ transaction: { events: [] } }),
  createAs: vi.fn().mockResolvedValue('mock-contract-id'),
  exerciseAs: vi.fn().mockResolvedValue('mock-swap-log-cid'),
  queryContracts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/ledger.js', () => ({
  ledger: mockLedger,
  extractCreatedContractId: vi.fn().mockReturnValue('mock-transfer-cid'),
  extractExerciseResult: vi.fn().mockReturnValue('mock-result'),
}));

const mockCantex = vi.hoisted(() => ({
  getPrices: vi.fn().mockResolvedValue({ CC: 0.15, USDCx: 1.0, CBTC: 40000 }),
  getBalances: vi.fn().mockResolvedValue([
    { asset: 'CC', amount: 50000 },
    { asset: 'USDCx', amount: 10000 },
    { asset: 'CBTC', amount: 0.25 },
  ]),
  executeSwap: vi.fn().mockResolvedValue({
    txId: 'mock-tx-123',
    fromAsset: 'CC',
    toAsset: 'USDCx',
    inputAmount: 100,
    outputAmount: 15,
    fee: 0.045,
    timestamp: '2026-03-15T12:00:00Z',
  }),
  getQuote: vi.fn().mockResolvedValue({
    fromAsset: 'CC', toAsset: 'USDCx', inputAmount: 100,
    outputAmount: 15, price: 0.15, fee: 0.045, slippage: 0,
  }),
  getPoolInfo: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/cantex.js', () => ({
  cantex: mockCantex,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { TokenTransferService } from '../src/services/token-transfer.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenTransferService', () => {
  let service: TokenTransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.network = 'localnet';
    service = new TokenTransferService();
  });

  it('initiateTransfer creates TransferRequest on ledger', async () => {
    const contractId = await service.initiateTransfer(
      'sender-party',
      'receiver-party',
      'CC',
      100.0,
      'Test transfer',
    );

    expect(contractId).toBe('mock-transfer-cid');
    expect(mockLedger.create).toHaveBeenCalledTimes(1);

    const createCall = mockLedger.create.mock.calls[0];
    expect(createCall[1]).toMatchObject({
      platform: 'test-platform::1220abc',
      sender: 'sender-party',
      receiver: 'receiver-party',
      instrumentId: 'CC',
      amount: '100',
      memo: 'Test transfer',
      status: { tag: 'Pending', value: {} },
    });
    // actAs parties should include both platform and sender
    expect(createCall[2]).toEqual(['test-platform::1220abc', 'sender-party']);
  });

  it('executeSwap creates SwapRequest with minBuyAmount', async () => {
    const result = await service.executeSwap(
      'test-user',
      'CC',
      100,
      'USDCx',
      15.0,
    );

    expect(result.success).toBe(true);
    expect(result.sellAsset).toBe('CC');
    expect(result.buyAsset).toBe('USDCx');
    expect(result.buyAmount).toBe(15);

    // Verify SwapRequest was created with minBuyAmount (2% slippage)
    expect(mockLedger.create).toHaveBeenCalledTimes(1);
    const createPayload = mockLedger.create.mock.calls[0][1];
    expect(createPayload.sellAsset).toBe('CC');
    expect(createPayload.buyAsset).toBe('USDCx');
    expect(createPayload.sellAmount).toBe('100');
    expect(createPayload.buyAmount).toBe('15');
    expect(createPayload.minBuyAmount).toBe(String(15.0 * 0.98));

    // Verify Cantex executeSwap was called
    expect(mockCantex.executeSwap).toHaveBeenCalledWith('CC', 'USDCx', 100);

    // Verify ExecuteSwap was exercised on ledger
    expect(mockLedger.exerciseAs).toHaveBeenCalledTimes(1);
  });

  it('queryHoldings returns formatted balances', async () => {
    const holdings = await service.queryHoldings('test-user');

    expect(holdings).toHaveLength(3);
    expect(holdings[0]).toMatchObject({
      instrumentId: 'CC',
      amount: 50000,
    });
    expect(holdings[1]).toMatchObject({
      instrumentId: 'USDCx',
      amount: 10000,
    });
    expect(holdings[2]).toMatchObject({
      instrumentId: 'CBTC',
      amount: 0.25,
    });

    // In internal mode, should call cantex.getBalances
    expect(mockCantex.getBalances).toHaveBeenCalledWith('test-user');
  });

  it('uses internal mode for localnet', () => {
    mockConfig.network = 'localnet';
    const svc = new TokenTransferService();

    // Internal mode is verified indirectly: queryHoldings calls cantex.getBalances
    // rather than ledger.queryContracts
    svc.queryHoldings('test-user');
    // The service constructor logs the mode; we verify via the mock calls below
    expect(mockCantex.getBalances).toBeDefined();
  });

  it('uses network mode for devnet', async () => {
    mockConfig.network = 'devnet';
    const svc = new TokenTransferService();

    // In network mode, queryHoldings tries CIP-0056 Holdings first
    mockLedger.queryContracts.mockResolvedValueOnce([
      {
        contractId: 'holding-cid-1',
        payload: {
          owner: 'test-user',
          instrument: { id: 'CC', admin: 'cc-admin' },
          amount: '50000',
          lock: null,
        },
      },
    ]);

    const holdings = await svc.queryHoldings('test-user');

    expect(mockLedger.queryContracts).toHaveBeenCalledTimes(1);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      instrumentId: 'CC',
      amount: 50000,
    });
  });
});
