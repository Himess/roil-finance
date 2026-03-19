import { config } from '../config.js';
import { logger } from '../monitoring/logger.js';

interface OpenRound {
  round: number;
  opensAt: string;
  targetClosesAt: string;
}

interface NetworkStats {
  totalAmuletBalance: string;
  totalRewardCollected: string;
  numFeaturedApps: number;
}

export class ScanClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = config.scanUrl) {
    this.baseUrl = baseUrl;
  }

  async getOpenRounds(): Promise<OpenRound[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/scan/v0/open-and-issuing-mining-rounds`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.open_mining_rounds || []).map((r: any) => ({
        round: r.payload?.round?.number ?? 0,
        opensAt: r.payload?.opensAt ?? '',
        targetClosesAt: r.payload?.targetClosesAt ?? '',
      }));
    } catch (err) {
      logger.warn('Scan API open rounds failed', { error: String(err) });
      return [];
    }
  }

  async getTotalAmuletBalance(party: string): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/scan/v0/total-amulet-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party }),
      });
      if (!res.ok) return '0';
      const data = await res.json() as any;
      return data.total_balance ?? '0';
    } catch (err) {
      logger.warn('Scan API balance failed', { error: String(err) });
      return '0';
    }
  }

  async getFeaturedApps(): Promise<{ provider: string; description: string }[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/scan/v0/featured-apps`);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return (data.featured_apps || []).map((a: any) => ({
        provider: a.provider ?? '',
        description: a.description ?? '',
      }));
    } catch (err) {
      logger.warn('Scan API featured apps failed', { error: String(err) });
      return [];
    }
  }

  async getNetworkInfo(): Promise<{ synchronizerNodes: number; openRounds: number } | null> {
    try {
      const rounds = await this.getOpenRounds();
      const apps = await this.getFeaturedApps();
      return {
        synchronizerNodes: 0, // Would need a separate endpoint
        openRounds: rounds.length,
      };
    } catch {
      return null;
    }
  }
}

export const scanClient = new ScanClient();
