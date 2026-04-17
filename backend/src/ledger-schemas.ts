// ---------------------------------------------------------------------------
// Canton JSON Ledger API v2 — response shape validation (Zod).
//
// The ledger client uses these schemas in fail-soft mode: if a response drifts
// from the expected shape we log a warning with the endpoint and the offending
// payload sample, then continue with the raw data. This catches DA breaking
// changes early without causing runtime regressions on benign additions.
// ---------------------------------------------------------------------------

import { z } from 'zod';
import { logger } from './monitoring/logger.js';

// --- Primitives -------------------------------------------------------------

export const LedgerEndSchema = z.object({
  offset: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === 'string' ? Number(v) : v,
  ),
});

const CreatedEventSchema = z.object({
  contractId: z.string(),
  templateId: z.string(),
  createArgument: z.record(z.unknown()).optional(),
  createArguments: z.record(z.unknown()).optional(),
  createdEventBlob: z.string().optional(),
});

const ExercisedEventSchema = z.object({
  contractId: z.string(),
  choice: z.string(),
  exerciseResult: z.unknown(),
});

const EventSchema = z
  .object({
    CreatedEvent: CreatedEventSchema.optional(),
    ExercisedEvent: ExercisedEventSchema.optional(),
  })
  .passthrough();

export const SubmitResultSchema = z
  .object({
    transaction: z
      .object({
        events: z.array(EventSchema),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Active-contracts entries can be wrapped in `contractEntry.JsActiveContract`
// or be the createdEvent directly — accept both.
const ActiveContractEntrySchema = z
  .object({
    contractEntry: z
      .object({
        JsActiveContract: z
          .object({
            createdEvent: CreatedEventSchema,
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    contractId: z.string().optional(),
    templateId: z.string().optional(),
    createArgument: z.record(z.unknown()).optional(),
    createArguments: z.record(z.unknown()).optional(),
    createdEventBlob: z.string().optional(),
  })
  .passthrough();

export const ActiveContractsPayloadSchema = z.union([
  z.array(ActiveContractEntrySchema),
  z
    .object({
      activeContracts: z.array(ActiveContractEntrySchema).optional(),
    })
    .passthrough(),
]);

export const PackagesListSchema = z
  .object({
    packageIds: z.array(z.string()).optional(),
  })
  .passthrough();

// --- Fail-soft validator ----------------------------------------------------

/**
 * Validate a response against a schema. Never throws — on failure we log a
 * warning with the endpoint + a truncated sample of the payload, then return
 * the original data unchanged. Callers continue to operate on the un-typed
 * data as they did before schemas were added.
 */
export function validateResponseSoft<T>(
  schema: z.ZodType<T>,
  data: unknown,
  endpoint: string,
): unknown {
  const result = schema.safeParse(data);
  if (result.success) return data;

  const sample = JSON.stringify(data, null, 0).slice(0, 400);
  logger.warn('Canton API response drift detected', {
    endpoint,
    issues: result.error.issues.slice(0, 5).map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
    sample: sample.length === 400 ? sample + '…(truncated)' : sample,
  });
  return data;
}
