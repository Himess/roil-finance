import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, TEMPLATES } from '../config.js';
import { ledger } from '../ledger.js';
import { rebalanceEngine, type PortfolioPayload } from '../engine/rebalance.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const AssetIdSchema = z.object({
  symbol: z.string().min(1),
  admin: z.string().min(1),
});

const TargetAllocationSchema = z.object({
  asset: AssetIdSchema,
  targetPct: z.number().min(0).max(100),
});

const CreatePortfolioSchema = z.object({
  user: z.string().min(1),
  targets: z.array(TargetAllocationSchema).min(2),
  triggerMode: z.union([
    z.literal('Manual'),
    z.object({
      tag: z.literal('DriftThreshold'),
      value: z.number().min(0.1).max(100),
    }),
  ]),
});

const UpdateTargetsSchema = z.object({
  newTargets: z.array(TargetAllocationSchema).min(2),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const portfolioRouter = Router();

/**
 * GET /api/portfolio/:party
 *
 * Retrieve all portfolios visible to the given party.
 */
portfolioRouter.get('/:party', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, party!);

    const result = portfolios.map((p) => ({
      contractId: p.contractId,
      ...p.payload,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/portfolio
 *
 * Create a new portfolio.
 * The platform creates a PortfolioProposal, then immediately accepts it
 * (acting as the user) to create the Portfolio contract.
 */
portfolioRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = CreatePortfolioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const { user, targets, triggerMode } = parsed.data;
    const platform = config.platformParty;

    // Validate targets sum to ~100%
    const totalPct = targets.reduce((sum, t) => sum + t.targetPct, 0);
    if (totalPct < 99.9 || totalPct > 100.1) {
      res.status(400).json({ success: false, error: 'Target allocations must sum to 100%' });
      return;
    }

    // 1. Create the proposal (signed by platform)
    const proposal = await ledger.createAs(
      TEMPLATES.PortfolioProposal,
      { platform, user },
      platform,
    );

    // 2. Accept the proposal (signed by user)
    const damlTriggerMode =
      triggerMode === 'Manual'
        ? { tag: 'Manual', value: {} }
        : { tag: 'DriftThreshold', value: String(triggerMode.value) };

    const damlTargets = targets.map((t) => ({
      asset: t.asset,
      targetPct: String(t.targetPct),
    }));

    const acceptResult = await ledger.exerciseAs(
      TEMPLATES.PortfolioProposal,
      proposal,
      'AcceptProposal',
      { targets: damlTargets, triggerMode: damlTriggerMode },
      user,
    );

    res.status(201).json({
      success: true,
      data: {
        contractId: acceptResult,
        user,
        targets,
        triggerMode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * PUT /api/portfolio/:id/targets
 *
 * Update target allocations for a portfolio.
 */
portfolioRouter.put('/:id/targets', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const parsed = UpdateTargetsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const { newTargets } = parsed.data;

    // Validate sum
    const totalPct = newTargets.reduce((sum, t) => sum + t.targetPct, 0);
    if (totalPct < 99.9 || totalPct > 100.1) {
      res.status(400).json({ success: false, error: 'Target allocations must sum to 100%' });
      return;
    }

    const damlTargets = newTargets.map((t) => ({
      asset: t.asset,
      targetPct: String(t.targetPct),
    }));

    // Find the portfolio to get the user party
    const portfolios = await ledger.query<PortfolioPayload>(
      TEMPLATES.Portfolio,
      config.platformParty,
    );
    const portfolio = portfolios.find((p) => p.contractId === id);
    if (!portfolio) {
      res.status(404).json({ success: false, error: 'Portfolio not found' });
      return;
    }

    const result = await ledger.exerciseAs(
      TEMPLATES.Portfolio,
      id!,
      'UpdateTargets',
      { newTargets: damlTargets },
      portfolio.payload.user,
    );

    res.json({ success: true, data: { contractId: result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/portfolio/:id/rebalance
 *
 * Trigger a manual rebalance for a portfolio.
 */
portfolioRouter.post('/:id/rebalance', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const result = await rebalanceEngine.executeRebalance(id!);

    if (result.success) {
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, error: result.error, data: result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/portfolio/:id/drift
 *
 * Check the current drift of a portfolio from its targets.
 */
portfolioRouter.get('/:id/drift', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const portfolios = await ledger.query<PortfolioPayload>(
      TEMPLATES.Portfolio,
      config.platformParty,
    );
    const portfolio = portfolios.find((p) => p.contractId === id);

    if (!portfolio) {
      res.status(404).json({ success: false, error: 'Portfolio not found' });
      return;
    }

    const { holdings, targets } = portfolio.payload;
    const drift = rebalanceEngine.calculateDrift(holdings, targets);

    const driftsObj: Record<string, number> = {};
    for (const [key, value] of drift.drifts) {
      driftsObj[key] = value;
    }

    res.json({
      success: true,
      data: {
        maxDrift: drift.maxDrift,
        drifts: driftsObj,
        needsRebalance: drift.maxDrift >= config.defaultDriftThreshold,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/portfolio/:id/history
 *
 * Get rebalance history (logs) for a portfolio's user.
 */
portfolioRouter.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    // Find portfolio to get the user
    const portfolios = await ledger.query<PortfolioPayload>(
      TEMPLATES.Portfolio,
      config.platformParty,
    );
    const portfolio = portfolios.find((p) => p.contractId === id);
    if (!portfolio) {
      res.status(404).json({ success: false, error: 'Portfolio not found' });
      return;
    }

    interface RebalanceLogPayload {
      platform: string;
      user: string;
      swapLegs: Array<{
        fromAsset: { symbol: string; admin: string };
        toAsset: { symbol: string; admin: string };
        fromAmount: string;
        toAmount: string;
      }>;
      driftBefore: string;
      timestamp: string;
    }

    const logs = await ledger.query<RebalanceLogPayload>(
      TEMPLATES.RebalanceLog,
      config.platformParty,
    );
    const userLogs = logs
      .filter((l) => l.payload.user === portfolio.payload.user)
      .map((l) => l.payload)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ success: true, data: userLogs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
