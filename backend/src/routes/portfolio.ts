import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, TEMPLATES, PORTFOLIO_TEMPLATES, INSTRUMENTS } from '../config.js';
import { ledger } from '../ledger.js';
import { rebalanceEngine, type PortfolioPayload } from '../engine/rebalance.js';
import { cantex } from '../cantex.js';
import { requireParty } from '../middleware/auth.js';
import { getPerformance, getPerformanceSummary } from '../services/performance-tracker.js';
import { transactionStream } from '../services/transaction-stream.js';

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
    z.object({
      tag: z.literal('PriceCondition'),
      value: z.object({
        conditionAsset: z.string(),
        targetPrice: z.number().positive(),
        conditionAction: z.enum(['sell_above', 'buy_below']),
      }),
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

// GET /api/portfolio/templates — list available portfolio templates
portfolioRouter.get('/templates', (_req, res) => {
  res.json({ success: true, data: PORTFOLIO_TEMPLATES });
});

// POST /api/portfolio/from-template — create portfolio from a template
const FromTemplateSchema = z.object({
  user: z.string().min(1),
  templateId: z.string().min(1),
});

portfolioRouter.post('/from-template', async (req, res) => {
  try {
    const parsed = FromTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.format() });
    }
    const { user, templateId } = parsed.data;
    const template = PORTFOLIO_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return res.status(404).json({ success: false, error: `Template '${templateId}' not found` });
    }
    // Populate admin parties from INSTRUMENTS before creating
    const targets = template.targets.map(t => ({
      ...t,
      asset: { ...t.asset, admin: INSTRUMENTS[t.asset.symbol as keyof typeof INSTRUMENTS]?.admin || t.asset.admin },
    }));
    // Create portfolio proposal using template's targets and trigger mode
    const contractId = await ledger.createAs(
      TEMPLATES.PortfolioProposal,
      { platform: config.platformParty, user },
      config.platformParty,
    );
    res.status(201).json({
      success: true,
      data: { contractId, template: template.name, targets, triggerMode: template.triggerMode },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/portfolio/system/config — safe config for frontend
// Placed before /:party to avoid being shadowed by the param route
portfolioRouter.get('/system/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      network: config.network,
      supportedAssets: Object.keys(INSTRUMENTS),
      platformFeeRate: config.platformFeeRate || 0.001,
    },
  });
});

/**
 * GET /api/portfolio/:party/performance
 *
 * Get performance summary and history for a party's portfolio.
 */
portfolioRouter.get('/:party/performance', requireParty('party'), async (req, res) => {
  try {
    const { party } = req.params as Record<string, string>;
    const window = req.query.window as string | undefined;
    const summary = getPerformanceSummary(party!);
    const history = await getPerformance(party!, window as any);
    res.json({ success: true, data: { summary, history } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/portfolio/:party
 *
 * Retrieve all portfolios visible to the given party.
 */
portfolioRouter.get('/:party', requireParty('party'), async (req: Request, res: Response) => {
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

    // Authorization: verify the caller can act as the specified user
    if (config.network !== 'localnet') {
      const actAs = (req as any).actAs as string[] || [];
      if (user && !actAs.includes(user)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this party' });
      }
    }
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
    let damlTriggerMode: Record<string, unknown>;
    if (triggerMode === 'Manual') {
      damlTriggerMode = { tag: 'Manual', value: {} };
    } else if (triggerMode.tag === 'PriceCondition') {
      damlTriggerMode = { tag: 'PriceCondition', value: triggerMode.value };
    } else {
      damlTriggerMode = { tag: 'DriftThreshold', value: String(triggerMode.value) };
    }

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

    if (config.network !== 'localnet') {
      const actAs = (req as any).actAs as string[] || [];
      const portfolioUser = portfolio?.payload?.user;
      if (portfolioUser && !actAs.includes(portfolioUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this portfolio' });
      }
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
 * POST /api/portfolio/:id/simulate
 *
 * Dry-run rebalance showing planned swaps without executing.
 */
portfolioRouter.post('/:id/simulate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    // Get portfolio
    const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, config.platformParty);
    const portfolio = portfolios.find((p) => p.contractId === id);
    if (!portfolio) {
      return res.status(404).json({ success: false, error: 'Portfolio not found' });
    }

    const { holdings, targets, triggerMode } = portfolio.payload;

    // Use the rebalance engine to plan swaps without executing
    const drift = rebalanceEngine.calculateDrift(holdings, targets);
    const swapLegs = await rebalanceEngine.planSwapLegs(holdings, targets);

    const threshold = triggerMode.tag === 'DriftThreshold'
      ? parseFloat(String(triggerMode.value))
      : config.defaultDriftThreshold;

    res.json({
      success: true,
      data: {
        currentDrift: drift,
        plannedSwaps: swapLegs,
        estimatedSwapCount: swapLegs.length,
        wouldRebalance: drift.maxDrift > threshold,
      },
    });
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

    // Authorization: verify the authenticated party owns this portfolio
    if (config.network !== 'localnet') {
      const actAs = (req as any).actAs as string[] || [];
      const portfolios = await ledger.query<PortfolioPayload>(TEMPLATES.Portfolio, config.platformParty);
      const portfolio = portfolios.find((p) => p.contractId === id);
      if (portfolio && !actAs.includes(portfolio.payload.user)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this party' });
      }
    }

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

// PUT /api/portfolio/:id/trigger-mode
portfolioRouter.put('/:id/trigger-mode', async (req, res) => {
  try {
    const { id } = req.params;
    const { triggerMode } = req.body;
    if (!triggerMode) {
      return res.status(400).json({ success: false, error: 'triggerMode required' });
    }
    // Query portfolio to get the user party (controller for this choice)
    const contracts = await ledger.query(TEMPLATES.Portfolio, config.platformParty);
    const contract = contracts.find((c: any) => c.contractId === id);
    const userParty = contract?.payload?.user as string;
    if (!userParty) {
      return res.status(404).json({ success: false, error: 'Portfolio not found' });
    }
    // Auth check
    if (config.network !== 'localnet') {
      const actAs = (req as any).actAs as string[] || [];
      if (!actAs.includes(userParty)) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }
    }
    await ledger.exerciseAs(TEMPLATES.Portfolio, id!, 'UpdateTriggerMode', { newMode: triggerMode }, userParty);
    res.json({ success: true, data: { contractId: id, triggerMode } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/portfolio/:id/deactivate
portfolioRouter.post('/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    // Query portfolio to get the user party (controller for this choice)
    const contracts = await ledger.query(TEMPLATES.Portfolio, config.platformParty);
    const contract = contracts.find((c: any) => c.contractId === id);
    const userParty = contract?.payload?.user as string;
    if (!userParty) {
      return res.status(404).json({ success: false, error: 'Portfolio not found' });
    }
    await ledger.exerciseAs(TEMPLATES.Portfolio, id!, 'DeactivatePortfolio', {}, userParty);
    res.json({ success: true, data: { contractId: id, isActive: false } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/portfolio/:id/activate
portfolioRouter.post('/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    // Query portfolio to get the user party (controller for this choice)
    const contracts = await ledger.query(TEMPLATES.Portfolio, config.platformParty);
    const contract = contracts.find((c: any) => c.contractId === id);
    const userParty = contract?.payload?.user as string;
    if (!userParty) {
      return res.status(404).json({ success: false, error: 'Portfolio not found' });
    }
    await ledger.exerciseAs(TEMPLATES.Portfolio, id!, 'ActivatePortfolio', {}, userParty);
    res.json({ success: true, data: { contractId: id, isActive: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/portfolio/:id/rebalance-detail
 *
 * Get detail of a specific rebalance by contract ID.
 */
portfolioRouter.get('/:id/rebalance-detail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    // Query RebalanceLog contracts to find matching one
    const logs = await ledger.query(TEMPLATES.RebalanceLog, config.platformParty);
    const log = logs.find((l: any) => l.contractId === id);

    if (!log) {
      // Try to find a pending/executing RebalanceRequest
      const requests = await ledger.query(TEMPLATES.RebalanceRequest, config.platformParty);
      const request = requests.find((r: any) => r.contractId === id);
      if (request) {
        return res.json({
          success: true,
          data: {
            id: request.contractId,
            type: 'Rebalance',
            status: typeof request.payload.status === 'string'
              ? request.payload.status
              : (request.payload.status as { tag?: string })?.tag || 'Unknown',
            timestamp: request.payload.requestedAt || '',
            swapLegs: request.payload.swapLegs || [],
            driftBefore: 0,
            driftAfter: 0,
            currentHoldings: request.payload.currentHoldings || [],
            targetAllocations: request.payload.targetAllocations || [],
          },
        });
      }
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    res.json({
      success: true,
      data: {
        id: log.contractId,
        type: 'Rebalance',
        status: 'Completed',
        timestamp: log.payload.timestamp || '',
        swapLegs: log.payload.swapLegs || [],
        driftBefore: parseFloat(String(log.payload.driftBefore)) || 0,
        driftAfter: 0,
        user: log.payload.user,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/portfolio/:id/estimate-cost
 *
 * Estimate rebalance transaction cost.
 */
portfolioRouter.post('/:id/estimate-cost', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const cost = await ledger.estimateCost(
      [{
        ExerciseCommand: {
          templateId: TEMPLATES.RebalanceRequest,
          contractId: id!,
          choice: 'SetSwapLegs',
          choiceArgument: req.body,
        },
      }],
      [config.platformParty],
    );
    res.json({ success: true, data: { estimatedCost: cost } });
  } catch (err: any) {
    // Cost estimation may not be available - return graceful fallback
    res.json({ success: true, data: { estimatedCost: null, note: 'Cost estimation not available' } });
  }
});

// DELETE /api/portfolio/:id — archive/delete portfolio
portfolioRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const contracts = await ledger.query(TEMPLATES.Portfolio, config.platformParty);
    const contract = contracts.find((c: any) => c.contractId === id);
    const userParty = contract?.payload?.user as string;
    if (!userParty) return res.status(404).json({ success: false, error: 'Portfolio not found' });
    // Deactivate instead of delete (Daml doesn't support arbitrary archive)
    await ledger.exerciseAs(TEMPLATES.Portfolio, id!, 'DeactivatePortfolio', {}, userParty);
    res.json({ success: true, data: { archived: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Note: /system/config route moved before /:party to avoid route shadowing

// GET /api/portfolio/:party/events — Server-Sent Events stream
portfolioRouter.get('/:party/events', requireParty('party'), (req, res) => {
  const { party } = req.params as Record<string, string>;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', party })}\n\n`);

  // Listen for transaction stream events
  const onRebalance = (data: any) => {
    if (data.payload?.user === party || !data.payload?.user) {
      res.write(`event: rebalance\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const onDCA = (data: any) => {
    if (data.payload?.user === party || !data.payload?.user) {
      res.write(`event: dca\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };
  const onPortfolio = (data: any) => {
    res.write(`event: portfolio\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to transaction stream events
  transactionStream.on('rebalance-completed', onRebalance);
  transactionStream.on('dca-executed', onDCA);
  transactionStream.on('portfolio-updated', onPortfolio);

  // Keep-alive ping every 30 seconds
  const pingInterval = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    transactionStream.removeListener('rebalance-completed', onRebalance);
    transactionStream.removeListener('dca-executed', onDCA);
    transactionStream.removeListener('portfolio-updated', onPortfolio);
  });
});
