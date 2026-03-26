import * as crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';
import {
  decimalToNumber,
  numberToDecimal,
  decimalAdd,
  decimalGt,
  decimalSub,
  DECIMAL_ZERO,
} from '../utils/decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhitelistEntry {
  partyId: string;
  email?: string;
  invitedBy?: string;
  joinedAt: number;
  isActive: boolean;
  dailySwapUsed: string;   // Decimal string, resets daily
  lastSwapDate: string;     // YYYY-MM-DD
}

export interface WhitelistStats {
  totalUsers: number;
  maxUsers: number;
  activeToday: number;
  spotsRemaining: number;
}

export interface SwapCheck {
  allowed: boolean;
  reason?: string;
  remaining: string;
}

interface InviteCode {
  code: string;
  createdBy: string;
  createdAt: number;
  redeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INVITES_PER_USER = 3;
const INVITE_CODE_LENGTH = 8;

// ---------------------------------------------------------------------------
// WhitelistManager
// ---------------------------------------------------------------------------

/**
 * Whitelist and invite system for controlled platform access.
 *
 * Features:
 * - Capped user count (default 1000)
 * - Daily swap volume limit per user (default $50/day)
 * - Max single trade size (default $25/trade)
 * - Invite code system (each user gets 3 codes)
 * - Daily limits auto-reset at UTC midnight
 * - In-memory storage with future DB persistence path
 */
export class WhitelistManager {
  private readonly MAX_USERS: number;
  private readonly DAILY_SWAP_LIMIT: string;
  private readonly MAX_TRADE_SIZE: string;

  /** Main whitelist store: partyId -> WhitelistEntry */
  private entries = new Map<string, WhitelistEntry>();

  /** Invite codes: code -> InviteCode */
  private inviteCodes = new Map<string, InviteCode>();

  /** Track how many invite codes each user has created */
  private inviteCountByUser = new Map<string, number>();

  constructor() {
    const tc = (config as any).treasury;
    this.MAX_USERS = tc?.maxUsers ?? 1000;
    this.DAILY_SWAP_LIMIT = tc?.dailyLimitUsd ?? '50.0';
    this.MAX_TRADE_SIZE = tc?.maxTradeUsd ?? '25.0';

    logger.info('[whitelist] Initialised whitelist manager', {
      maxUsers: this.MAX_USERS,
      dailySwapLimit: this.DAILY_SWAP_LIMIT,
      maxTradeSize: this.MAX_TRADE_SIZE,
    });
  }

  // -----------------------------------------------------------------------
  // User management
  // -----------------------------------------------------------------------

  /**
   * Add a user to the whitelist.
   * Returns true if the user was added, false if already whitelisted or cap reached.
   */
  addUser(partyId: string, email?: string, invitedBy?: string): boolean {
    if (this.entries.has(partyId)) {
      logger.info('[whitelist] User already whitelisted', { partyId });
      return false;
    }

    if (this.entries.size >= this.MAX_USERS) {
      logger.warn('[whitelist] Whitelist full, cannot add user', {
        partyId,
        current: this.entries.size,
        max: this.MAX_USERS,
      });
      return false;
    }

    const entry: WhitelistEntry = {
      partyId,
      email,
      invitedBy,
      joinedAt: Date.now(),
      isActive: true,
      dailySwapUsed: DECIMAL_ZERO,
      lastSwapDate: '',
    };

    this.entries.set(partyId, entry);

    logger.info('[whitelist] User added', {
      partyId,
      invitedBy: invitedBy ?? 'direct',
      totalUsers: this.entries.size,
    });

    return true;
  }

  /**
   * Remove a user from the whitelist.
   */
  removeUser(partyId: string): void {
    const existed = this.entries.delete(partyId);
    if (existed) {
      logger.info('[whitelist] User removed', { partyId });
    }
  }

  /**
   * Check if a user is whitelisted and active.
   */
  isWhitelisted(partyId: string): boolean {
    const entry = this.entries.get(partyId);
    return entry?.isActive === true;
  }

  /**
   * Get user info.
   */
  getUserInfo(partyId: string): WhitelistEntry | null {
    const entry = this.entries.get(partyId);
    if (!entry) return null;
    // Auto-reset daily volume if date changed
    this.resetDailyIfNeeded(entry);
    return { ...entry };
  }

  // -----------------------------------------------------------------------
  // Swap limit enforcement
  // -----------------------------------------------------------------------

  /**
   * Check if a user can perform a swap of the given USD amount.
   *
   * Validates:
   * 1. User is whitelisted and active
   * 2. Trade size does not exceed max single trade size
   * 3. Daily volume does not exceed daily limit
   *
   * Returns { allowed, reason, remaining } where remaining is the
   * remaining daily allowance in USD terms.
   */
  canSwap(partyId: string, amountUsd: string): SwapCheck {
    const entry = this.entries.get(partyId);

    if (!entry) {
      return { allowed: false, reason: 'Not whitelisted', remaining: DECIMAL_ZERO };
    }

    if (!entry.isActive) {
      return { allowed: false, reason: 'Whitelist entry is inactive', remaining: DECIMAL_ZERO };
    }

    // Reset daily counters if new day
    this.resetDailyIfNeeded(entry);

    // Check single trade size
    if (decimalGt(amountUsd, this.MAX_TRADE_SIZE)) {
      return {
        allowed: false,
        reason: `Trade size $${amountUsd} exceeds maximum $${this.MAX_TRADE_SIZE} per trade`,
        remaining: decimalSub(this.DAILY_SWAP_LIMIT, entry.dailySwapUsed),
      };
    }

    // Check daily limit
    const projectedTotal = decimalAdd(entry.dailySwapUsed, amountUsd);
    if (decimalGt(projectedTotal, this.DAILY_SWAP_LIMIT)) {
      const remaining = decimalSub(this.DAILY_SWAP_LIMIT, entry.dailySwapUsed);
      return {
        allowed: false,
        reason: `Daily swap limit reached. Used: $${entry.dailySwapUsed}, Limit: $${this.DAILY_SWAP_LIMIT}`,
        remaining,
      };
    }

    const remaining = decimalSub(this.DAILY_SWAP_LIMIT, projectedTotal);
    return { allowed: true, remaining };
  }

  /**
   * Record a swap usage for daily volume tracking.
   * Called after a swap is successfully executed.
   */
  recordSwap(partyId: string, amountUsd: string): void {
    const entry = this.entries.get(partyId);
    if (!entry) return;

    this.resetDailyIfNeeded(entry);
    entry.dailySwapUsed = decimalAdd(entry.dailySwapUsed, amountUsd);
    entry.lastSwapDate = this.todayUTC();
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Get whitelist statistics.
   */
  getStats(): WhitelistStats {
    const today = this.todayUTC();
    let activeToday = 0;

    for (const entry of this.entries.values()) {
      if (entry.lastSwapDate === today) {
        activeToday++;
      }
    }

    return {
      totalUsers: this.entries.size,
      maxUsers: this.MAX_USERS,
      activeToday,
      spotsRemaining: Math.max(0, this.MAX_USERS - this.entries.size),
    };
  }

  // -----------------------------------------------------------------------
  // Invite codes
  // -----------------------------------------------------------------------

  /**
   * Generate an invite code for a whitelisted user.
   * Each user can generate up to MAX_INVITES_PER_USER codes.
   *
   * Returns the invite code string, or null if the user has no invites left.
   */
  generateInviteCode(partyId: string): string | null {
    if (!this.isWhitelisted(partyId)) {
      return null;
    }

    const currentCount = this.inviteCountByUser.get(partyId) ?? 0;
    if (currentCount >= MAX_INVITES_PER_USER) {
      return null;
    }

    const code = this.randomAlphanumeric(INVITE_CODE_LENGTH);

    const invite: InviteCode = {
      code,
      createdBy: partyId,
      createdAt: Date.now(),
      redeemed: false,
    };

    this.inviteCodes.set(code, invite);
    this.inviteCountByUser.set(partyId, currentCount + 1);

    logger.info('[whitelist] Invite code generated', {
      code,
      createdBy: partyId,
      invitesUsed: currentCount + 1,
      maxInvites: MAX_INVITES_PER_USER,
    });

    return code;
  }

  /**
   * Redeem an invite code to join the whitelist.
   * Returns true if redeemed successfully, false otherwise.
   */
  redeemInviteCode(code: string, newPartyId: string): boolean {
    const invite = this.inviteCodes.get(code);

    if (!invite) {
      logger.warn('[whitelist] Invalid invite code', { code });
      return false;
    }

    if (invite.redeemed) {
      logger.warn('[whitelist] Invite code already redeemed', { code });
      return false;
    }

    if (this.entries.has(newPartyId)) {
      logger.info('[whitelist] User already whitelisted, code not consumed', { newPartyId, code });
      return false;
    }

    // Add user via invite
    const added = this.addUser(newPartyId, undefined, invite.createdBy);
    if (!added) {
      return false;
    }

    // Mark invite as redeemed
    invite.redeemed = true;
    invite.redeemedBy = newPartyId;
    invite.redeemedAt = Date.now();

    logger.info('[whitelist] Invite code redeemed', {
      code,
      newPartyId,
      invitedBy: invite.createdBy,
    });

    return true;
  }

  /**
   * Get all invite codes created by a user, including their status.
   */
  getInviteCodes(partyId: string): Array<{
    code: string;
    createdAt: number;
    redeemed: boolean;
    redeemedBy?: string;
  }> {
    const codes: Array<{
      code: string;
      createdAt: number;
      redeemed: boolean;
      redeemedBy?: string;
    }> = [];

    for (const invite of this.inviteCodes.values()) {
      if (invite.createdBy === partyId) {
        codes.push({
          code: invite.code,
          createdAt: invite.createdAt,
          redeemed: invite.redeemed,
          redeemedBy: invite.redeemedBy,
        });
      }
    }

    return codes.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get the number of remaining invite codes a user can generate.
   */
  getRemainingInvites(partyId: string): number {
    const used = this.inviteCountByUser.get(partyId) ?? 0;
    return Math.max(0, MAX_INVITES_PER_USER - used);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Reset daily swap usage if the date has changed since last swap.
   */
  private resetDailyIfNeeded(entry: WhitelistEntry): void {
    const today = this.todayUTC();
    if (entry.lastSwapDate !== today) {
      entry.dailySwapUsed = DECIMAL_ZERO;
      // Note: lastSwapDate is NOT updated here — only on actual swap
    }
  }

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private randomAlphanumeric(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const whitelistManager = new WhitelistManager();
