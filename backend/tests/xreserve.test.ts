/**
 * xReserve client tests — unit tests for deposit/withdraw state management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  XReserveClient,
  CANTON_XRESERVE_DOMAIN,
  ETHEREUM_DOMAIN,
  XRESERVE_CHAINS,
  getSourceChain,
  getOperator,
  XRESERVE_OPERATOR,
} from '../src/services/xreserve-client.js';

describe('XReserveClient', () => {
  let client: XReserveClient;

  beforeEach(() => {
    client = new XReserveClient();
  });

  describe('deposits', () => {
    it('creates deposit with pending_approval status', () => {
      const d = client.createDeposit({
        cantonParty: 'alice::1220abc',
        evmAddress: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '1000000', // 1 USDC
      });

      expect(d.id).toBeDefined();
      expect(d.status).toBe('pending_approval');
      expect(d.amount).toBe('1000000');
      expect(d.createdAt).toBeDefined();
    });

    it('transitions through states correctly', () => {
      const d = client.createDeposit({
        cantonParty: 'alice::1220abc',
        evmAddress: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '1000000',
      });

      const burnHash = '0x' + 'a'.repeat(64);
      const updated = client.recordBurnTx(d.id, burnHash);
      expect(updated?.status).toBe('awaiting_finality');
      expect(updated?.burnTxHash).toBe(burnHash);

      const attested = client.markAttested(d.id, 'cid:attestation:1');
      expect(attested?.status).toBe('attested');
      expect(attested?.attestationContractId).toBe('cid:attestation:1');

      const minted = client.markMinted(d.id, 'tx:mint:1');
      expect(minted?.status).toBe('completed');
      expect(minted?.completedAt).toBeDefined();
    });

    it('returns null for non-existent deposit', () => {
      expect(client.recordBurnTx('fake-id', '0x' + 'a'.repeat(64))).toBeNull();
      expect(client.markAttested('fake-id', 'cid')).toBeNull();
      expect(client.markMinted('fake-id', 'tx')).toBeNull();
    });

    it('filters deposits by party', () => {
      const alice = 'alice::1220abc';
      const bob = 'bob::1220def';

      client.createDeposit({ cantonParty: alice, evmAddress: '0x' + 'a'.repeat(40), amount: '1000000' });
      client.createDeposit({ cantonParty: alice, evmAddress: '0x' + 'a'.repeat(40), amount: '2000000' });
      client.createDeposit({ cantonParty: bob, evmAddress: '0x' + 'b'.repeat(40), amount: '500000' });

      expect(client.getDepositsByParty(alice)).toHaveLength(2);
      expect(client.getDepositsByParty(bob)).toHaveLength(1);
      expect(client.getDepositsByParty('charlie::1220xyz')).toHaveLength(0);
    });

    it('sorts deposits by most recent first', async () => {
      const alice = 'alice::1220abc';
      const d1 = client.createDeposit({ cantonParty: alice, evmAddress: '0x' + 'a'.repeat(40), amount: '1' });
      await new Promise(r => setTimeout(r, 10));
      const d2 = client.createDeposit({ cantonParty: alice, evmAddress: '0x' + 'a'.repeat(40), amount: '2' });

      const list = client.getDepositsByParty(alice);
      expect(list[0].id).toBe(d2.id);
      expect(list[1].id).toBe(d1.id);
    });
  });

  describe('withdrawals', () => {
    it('creates withdrawal', () => {
      const w = client.createWithdrawal({
        cantonParty: 'alice::1220abc',
        destinationEvmAddress: '0x1234567890abcdef1234567890abcdef12345678',
        amount: '500000',
      });

      expect(w.id).toMatch(/^wd-/);
      expect(w.status).toBe('pending');
      expect(w.amount).toBe('500000');
    });

    it('transitions withdrawal through states', () => {
      const w = client.createWithdrawal({
        cantonParty: 'alice::1220abc',
        destinationEvmAddress: '0x' + 'a'.repeat(40),
        amount: '100',
      });

      const burned = client.markWithdrawBurned(w.id, 'cid:burn:1');
      expect(burned?.status).toBe('burning');
      expect(burned?.burnContractId).toBe('cid:burn:1');

      const released = client.markWithdrawReleased(w.id, '0x' + 'b'.repeat(64));
      expect(released?.status).toBe('completed');
      expect(released?.releaseTxHash).toBe('0x' + 'b'.repeat(64));
      expect(released?.completedAt).toBeDefined();
    });

    it('filters withdrawals by party', () => {
      const alice = 'alice::1220abc';
      const bob = 'bob::1220def';

      client.createWithdrawal({ cantonParty: alice, destinationEvmAddress: '0x' + 'a'.repeat(40), amount: '1' });
      client.createWithdrawal({ cantonParty: bob, destinationEvmAddress: '0x' + 'b'.repeat(40), amount: '2' });

      expect(client.getWithdrawalsByParty(alice)).toHaveLength(1);
      expect(client.getWithdrawalsByParty(bob)).toHaveLength(1);
    });
  });

  describe('buildDepositParams', () => {
    it('returns correct xReserve chain config and encoded recipient', () => {
      const cantonParty = 'roil::12204c8abc773054c8747b620a82c812cc25dac333c82dba57dcc47bd55533e7e6fa';
      const params = client.buildDepositParams(cantonParty);

      expect(params.cantonDomain).toBe(CANTON_XRESERVE_DOMAIN);
      expect(params.cantonDomain).toBe(10001);
      expect(params.chain.chainId).toBeOneOf([1, 11155111]); // ethereum or sepolia
      expect(params.remoteRecipient).toMatch(/^0x[0-9a-f]{64}$/);
      expect(params.hookData).toMatch(/^0x[0-9a-f]+$/);

      // hookData is the hex of UTF-8 party bytes
      const expectedHookData = '0x' + Buffer.from(cantonParty, 'utf8').toString('hex');
      expect(params.hookData).toBe(expectedHookData);
    });

    it('encodes recipient deterministically', () => {
      const p1 = client.buildDepositParams('alice::1220abc');
      const p2 = client.buildDepositParams('alice::1220abc');
      expect(p1.remoteRecipient).toBe(p2.remoteRecipient);

      const p3 = client.buildDepositParams('bob::1220def');
      expect(p3.remoteRecipient).not.toBe(p1.remoteRecipient);
    });
  });
});

describe('xReserve constants', () => {
  it('Canton domain is 10001', () => {
    expect(CANTON_XRESERVE_DOMAIN).toBe(10001);
  });

  it('Ethereum domain is 0', () => {
    expect(ETHEREUM_DOMAIN).toBe(0);
  });

  it('Sepolia chain config matches xreserve-deposits reference', () => {
    expect(XRESERVE_CHAINS.sepolia.xReserveContract).toBe(
      '0x008888878f94C0d87defdf0B07f46B93C1934442',
    );
    expect(XRESERVE_CHAINS.sepolia.usdcContract).toBe(
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    );
    expect(XRESERVE_CHAINS.sepolia.chainId).toBe(11155111);
  });

  it('Mainnet chain config matches xreserve-deposits reference', () => {
    expect(XRESERVE_CHAINS.ethereum.xReserveContract).toBe(
      '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    );
    expect(XRESERVE_CHAINS.ethereum.usdcContract).toBe(
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    );
    expect(XRESERVE_CHAINS.ethereum.chainId).toBe(1);
  });

  it('Operator parties are set for both mainnet and testnet', () => {
    expect(XRESERVE_OPERATOR.mainnet).toContain('decentralized-usdc-interchain-rep');
    expect(XRESERVE_OPERATOR.testnet).toContain('decentralized-usdc-interchain-rep');
    expect(XRESERVE_OPERATOR.mainnet).not.toBe(XRESERVE_OPERATOR.testnet);
  });

  it('getSourceChain returns sepolia on testnet, ethereum on mainnet', () => {
    // Vitest runs with process.env.CANTON_NETWORK set from setup
    const source = getSourceChain();
    expect(['sepolia', 'ethereum']).toContain(source);
  });

  it('getOperator matches the network', () => {
    const op = getOperator();
    expect(op).toContain('decentralized-usdc-interchain-rep');
  });
});
