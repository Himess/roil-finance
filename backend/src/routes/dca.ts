import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config, TEMPLATES } from '../config.js';
import { ledger } from '../ledger.js';
import { dcaEngine, type DCASchedulePayload } from '../engine/dca.js';
import { requireParty } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const AssetIdSchema = z.object({
  symbol: z.string().min(1),
  admin: z.string().min(1),
});

const CreateDCASchema = z.object({
  user: z.string().min(1),
  sourceAsset: AssetIdSchema,
  targetAsset: AssetIdSchema,
  amountPerBuy: z.number().positive().finite(),
  frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
});

const UpdateAmountSchema = z.object({
  newAmount: z.number().positive(),
});

const UpdateFrequencySchema = z.object({
  newFrequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const dcaRouter = Router();

/**
 * GET /api/dca/:party
 *
 * List all DCA schedules for a given party.
 */
dcaRouter.get('/:party', requireParty('party'), async (req: Request, res: Response) => {
  try {
    const { party } = req.params as Record<string, string>;
    const schedules = await dcaEngine.listSchedules(party!);
    res.json({ success: true, data: schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/dca
 *
 * Create a new DCA schedule.
 */
dcaRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = CreateDCASchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const { user, sourceAsset, targetAsset, amountPerBuy, frequency } = parsed.data;

    // Authorization: verify the caller can act as the specified user
    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      if (user && !actAs.includes(user)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this party' });
      }
    }

    const platform = config.platformParty;

    if (sourceAsset.symbol === targetAsset.symbol) {
      res.status(400).json({ success: false, error: 'Source and target assets must be different' });
      return;
    }

    const result = await ledger.createAs(
      TEMPLATES.DCASchedule,
      {
        platform,
        user,
        sourceAsset,
        targetAsset,
        amountPerBuy: String(amountPerBuy),
        frequency: { tag: frequency, value: {} },
        totalExecutions: 0,
        isActive: true,
        createdAt: new Date().toISOString(),
      },
      platform,
    );

    res.status(201).json({
      success: true,
      data: {
        contractId: result,
        user,
        sourceAsset: sourceAsset.symbol,
        targetAsset: targetAsset.symbol,
        amountPerBuy,
        frequency,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * PUT /api/dca/:id/amount
 *
 * Update the buy amount for an existing DCA schedule.
 */
dcaRouter.put('/:id/amount', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const parsed = UpdateAmountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    // Find the schedule to get the user party
    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      const scheduleUser = schedule?.payload?.user;
      if (scheduleUser && !actAs.includes(scheduleUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this DCA schedule' });
      }
    }

    const result = await ledger.exerciseAs(
      TEMPLATES.DCASchedule,
      id!,
      'UpdateDCAAmount',
      { newAmount: String(parsed.data.newAmount) },
      schedule.payload.user,
    );

    res.json({ success: true, data: { contractId: result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * PUT /api/dca/:id/frequency
 *
 * Update the frequency of a DCA schedule.
 */
dcaRouter.put('/:id/frequency', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;
    const parsed = UpdateFrequencySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.format() });
      return;
    }

    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      const scheduleUser = schedule?.payload?.user;
      if (scheduleUser && !actAs.includes(scheduleUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this DCA schedule' });
      }
    }

    const result = await ledger.exerciseAs(
      TEMPLATES.DCASchedule,
      id!,
      'UpdateDCAFrequency',
      { newFrequency: parsed.data.newFrequency },
      schedule.payload.user,
    );

    res.json({ success: true, data: { contractId: result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/dca/:id/pause
 *
 * Pause a DCA schedule.
 */
dcaRouter.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      const scheduleUser = schedule?.payload?.user;
      if (scheduleUser && !actAs.includes(scheduleUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this DCA schedule' });
      }
    }

    if (!schedule.payload.isActive) {
      res.status(400).json({ success: false, error: 'Schedule is already paused' });
      return;
    }

    const result = await ledger.exerciseAs(
      TEMPLATES.DCASchedule,
      id!,
      'PauseDCA',
      {},
      schedule.payload.user,
    );

    res.json({ success: true, data: { contractId: result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/dca/:id/resume
 *
 * Resume a paused DCA schedule.
 */
dcaRouter.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      const scheduleUser = schedule?.payload?.user;
      if (scheduleUser && !actAs.includes(scheduleUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this DCA schedule' });
      }
    }

    if (schedule.payload.isActive) {
      res.status(400).json({ success: false, error: 'Schedule is already active' });
      return;
    }

    const result = await ledger.exerciseAs(
      TEMPLATES.DCASchedule,
      id!,
      'ResumeDCA',
      {},
      schedule.payload.user,
    );

    res.json({ success: true, data: { contractId: result } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * DELETE /api/dca/:id
 *
 * Cancel (archive) a DCA schedule permanently.
 */
dcaRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    if (config.network !== 'localnet') {
      const actAs = req.actAs || [];
      const scheduleUser = schedule?.payload?.user;
      if (scheduleUser && !actAs.includes(scheduleUser)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this DCA schedule' });
      }
    }

    await ledger.exerciseAs(
      TEMPLATES.DCASchedule,
      id!,
      'CancelDCA',
      {},
      schedule.payload.user,
    );

    res.json({ success: true, data: { cancelled: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/dca/:id/history
 *
 * Get DCA execution history for a specific schedule.
 */
dcaRouter.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as Record<string, string>;

    // Find the schedule to get the user
    const schedules = await ledger.query<DCASchedulePayload>(
      TEMPLATES.DCASchedule,
      config.platformParty,
    );
    const schedule = schedules.find((s) => s.contractId === id);
    if (!schedule) {
      res.status(404).json({ success: false, error: 'DCA schedule not found' });
      return;
    }

    const history = await dcaEngine.getExecutionHistory(schedule.payload.user);

    // Filter to only this schedule's asset pair
    const filtered = history.filter(
      (h) =>
        h.sourceAsset.symbol === schedule.payload.sourceAsset.symbol &&
        h.targetAsset.symbol === schedule.payload.targetAsset.symbol,
    );

    res.json({ success: true, data: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
});
