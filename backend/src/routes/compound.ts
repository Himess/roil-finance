import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { compoundEngine, type CompoundConfig } from '../engine/compound.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CompoundConfigSchema = z.object({
  enabled: z.boolean(),
  minCompoundAmount: z.number().positive(),
  frequency: z.enum(['hourly', 'daily', 'weekly']),
  reinvestStrategy: z.enum(['portfolio-targets', 'same-asset', 'usdc-only']),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const compoundRouter = Router();

/**
 * GET /api/compound/:party/yields
 *
 * Get current yield summary for a party, including all yield sources,
 * total daily yield, weighted APY, and next compound time.
 */
compoundRouter.get('/:party/yields', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const summary = await compoundEngine.getYieldSummary(party!);
    res.json({ success: true, data: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/compound/:party/execute
 *
 * Trigger a manual compound for a party. Uses the party's current
 * compound configuration, or a default config if none is set.
 */
compoundRouter.post('/:party/execute', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const cfg = compoundEngine.getConfig(party!);

    // For manual execution, override enabled to true
    const manualConfig: CompoundConfig = { ...cfg, enabled: true };

    const result = await compoundEngine.executeCompound(party!, manualConfig);

    if (result) {
      res.json({ success: true, data: result });
    } else {
      res.json({
        success: true,
        data: null,
        message: 'No yield available to compound or yield below minimum threshold',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/compound/:party/history
 *
 * Get compound execution history for a party.
 */
compoundRouter.get('/:party/history', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const history = await compoundEngine.getCompoundHistory(party!);
    res.json({ success: true, data: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * PUT /api/compound/:party/config
 *
 * Update the compound configuration for a party.
 */
compoundRouter.put('/:party/config', async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const parsed = CompoundConfigSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    compoundEngine.setConfig(party!, parsed.data);

    res.json({
      success: true,
      data: {
        party: party!,
        config: parsed.data,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
