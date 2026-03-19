// ---------------------------------------------------------------------------
// Daml variant encoding helpers for Canton JSON API
// ---------------------------------------------------------------------------

/**
 * Encode a Daml sum type (variant) for the Canton JSON API v2.
 *
 * The Canton JSON API represents Daml variants as `{ tag: "ConstructorName", value: {} }`.
 * Nullary constructors (e.g., `Bronze`, `Pending`) use an empty object for `value`.
 *
 * @example
 *   damlVariant('Bronze')        // { tag: 'Bronze', value: {} }
 *   damlVariant('DriftThreshold', { threshold: '5.0' })
 */
export function damlVariant(
  tag: string,
  value: Record<string, unknown> = {},
): { tag: string; value: Record<string, unknown> } {
  return { tag, value };
}
