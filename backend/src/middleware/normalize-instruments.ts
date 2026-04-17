/**
 * Normalize instrument admin-party references in request bodies.
 *
 * The frontend historically hardcoded `admin: 'Canton::Admin'` as a sentinel
 * placeholder on AssetId payloads (9 asset types × ~many call sites). This
 * middleware walks the request body recursively and replaces that sentinel
 * (or any known-stale admin value that matches a supported symbol) with the
 * real admin party from `config.INSTRUMENTS`.
 *
 * Semantics:
 *   { asset: { symbol: 'CC', admin: 'Canton::Admin' } }
 *     → { asset: { symbol: 'CC', admin: '<DSO-party-id>' } }
 *
 * Safe to run on every request because:
 *   - It only mutates keys that match the exact {symbol, admin} shape
 *   - It only rewrites when symbol is in INSTRUMENTS and admin is a known
 *     sentinel string (Canton::Admin, Loading::Admin, or empty string)
 *   - Real admin party IDs contain `::` + fingerprint and are never rewritten
 *
 * This lets us roll out InstrumentsContext on the frontend without hunting
 * every hardcoded `Canton::Admin` string — the backend is authoritative.
 */

import { type Request, type Response, type NextFunction } from 'express';
import { INSTRUMENTS } from '../config.js';

const SENTINEL_ADMINS = new Set(['Canton::Admin', 'Loading::Admin', '']);

function resolveAdmin(symbol: string, currentAdmin: string): string {
  // Only rewrite if the current admin is a known sentinel.
  if (!SENTINEL_ADMINS.has(currentAdmin)) return currentAdmin;
  const hit = (INSTRUMENTS as Record<string, { admin: string }>)[symbol];
  return hit?.admin ?? currentAdmin;
}

function normalizeValue(value: unknown, depth = 0): unknown {
  // Prevent pathological deep recursion on hostile payloads.
  if (depth > 16) return value;

  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = normalizeValue(value[i], depth + 1);
    }
    return value;
  }

  const obj = value as Record<string, unknown>;

  // Shape match: { symbol: string, admin: string, ... } — rewrite admin.
  if (typeof obj.symbol === 'string' && typeof obj.admin === 'string') {
    obj.admin = resolveAdmin(obj.symbol, obj.admin);
  }

  // Recurse into every field — covers { asset: {…} }, { from: {…} }, arrays.
  for (const key of Object.keys(obj)) {
    obj[key] = normalizeValue(obj[key], depth + 1);
  }
  return obj;
}

export function normalizeInstruments(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    try {
      normalizeValue(req.body);
    } catch {
      // Never block the request on a normalization bug — let the route
      // handler decide how to respond to malformed payloads.
    }
  }
  next();
}
