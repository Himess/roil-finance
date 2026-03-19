import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: { platformParty: 'test-platform', network: 'localnet' },
  TEMPLATES: {
    FeaturedAppConfig: '#test:FeaturedApp:FeaturedAppConfig',
    ActivityRecord: '#test:FeaturedApp:ActivityRecord',
  },
}));

const mockLedger = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ transaction: { events: [] } }),
  exercise: vi.fn().mockResolvedValue({ transaction: { events: [] } }),
  createAs: vi.fn().mockResolvedValue('mock-config-cid'),
  exerciseAs: vi.fn().mockResolvedValue('mock-result'),
}));

vi.mock('../src/ledger.js', () => ({
  ledger: mockLedger,
  extractCreatedContractId: vi.fn().mockReturnValue('mock-cid'),
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { FeaturedAppEngine } from '../src/engine/featured-app.js';

describe('FeaturedAppEngine', () => {
  let engine: FeaturedAppEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new FeaturedAppEngine();
  });

  it('initializes by creating config if none exists', async () => {
    mockLedger.query.mockResolvedValueOnce([]);
    mockLedger.create.mockResolvedValueOnce({ transaction: { events: [] } });

    await engine.initialize();

    expect(mockLedger.create).toHaveBeenCalled();
  });

  it('initializes with existing config', async () => {
    mockLedger.query.mockResolvedValueOnce([{
      contractId: 'existing-cid',
      payload: { appName: 'Canton Rebalancer', isRegistered: false, totalActivities: 5 },
    }]);

    await engine.initialize();

    expect(mockLedger.create).not.toHaveBeenCalled();
  });

  it('records activity on existing config', async () => {
    // First call to initialize (query returns existing config)
    mockLedger.query.mockResolvedValueOnce([{
      contractId: 'existing-cid',
      payload: { appName: 'Canton Rebalancer', isRegistered: false, totalActivities: 5 },
    }]);

    mockLedger.exercise.mockResolvedValueOnce({
      transaction: {
        events: [{
          CreatedEvent: {
            templateId: 'FeaturedAppConfig',
            contractId: 'new-cid',
          },
        }],
      },
    });

    await engine.recordActivity('user1', 'DCAExecution', 'DCA executed');

    expect(mockLedger.exercise).toHaveBeenCalledWith(
      expect.any(String),
      'existing-cid',
      'RecordActivity',
      expect.objectContaining({
        user: 'user1',
        activityType: 'DCAExecution',
        description: 'DCA executed',
      }),
      expect.any(Array),
    );
  });

  it('gets activity summary', async () => {
    mockLedger.query
      .mockResolvedValueOnce([{
        contractId: 'cfg-cid',
        payload: { appName: 'Canton Rebalancer', isRegistered: true, totalActivities: 10, featuredAppRightCid: 'right-1' },
      }])
      .mockResolvedValueOnce([{
        payload: { user: 'user1', activityType: 'Rebalance', description: 'test', timestamp: '2026-03-17T00:00:00Z' },
      }]);

    const summary = await engine.getActivitySummary();

    expect(summary).not.toBeNull();
    expect(summary!.totalActivities).toBe(10);
    expect(summary!.isRegistered).toBe(true);
    expect(summary!.recentActivities.length).toBe(1);
  });

  it('returns null summary when no config exists', async () => {
    mockLedger.query.mockResolvedValueOnce([]);

    const summary = await engine.getActivitySummary();

    expect(summary).toBeNull();
  });
});
