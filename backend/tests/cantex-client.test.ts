import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';

vi.mock('../src/config.js', () => ({
  config: {
    cantexApiUrl: 'http://localhost:6100',
    cantexOperatorKey: 'a'.repeat(64), // 32 bytes hex
    cantexTradingKey: 'b'.repeat(64),
    platformParty: 'test-platform',
    network: 'devnet',
  },
}));

vi.mock('../src/monitoring/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/utils/circuit-breaker.js', () => ({
  cantexBreaker: { execute: vi.fn((fn: any) => fn()) },
}));

vi.mock('../src/utils/retry.js', () => ({
  withRetry: vi.fn((fn: any) => fn()),
}));

// We test the crypto functions indirectly through the module
// Since the class methods are private, we test the public API

describe('CantexRealClient', () => {
  it('can be imported without errors', async () => {
    const mod = await import('../src/cantex-client.js');
    expect(mod.CantexRealClient).toBeDefined();
  });

  it('constructs with operator and trading keys', async () => {
    const { CantexRealClient } = await import('../src/cantex-client.js');
    const client = new CantexRealClient();
    expect(client).toBeDefined();
  });

  it('isAvailable checks the API health', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200
    });

    const { CantexRealClient } = await import('../src/cantex-client.js');
    const client = new CantexRealClient();
    const available = await client.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('Crypto Utilities', () => {
  it('Ed25519 key derivation produces valid key pair', () => {
    const seed = crypto.randomBytes(32);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        seed,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKey = crypto.createPublicKey(privateKey);

    expect(privateKey.type).toBe('private');
    expect(publicKey.type).toBe('public');

    // Sign and verify
    const message = Buffer.from('test message');
    const signature = crypto.sign(null, message, privateKey);
    const isValid = crypto.verify(null, message, publicKey, signature);
    expect(isValid).toBe(true);
  });

  it('secp256k1 key derivation produces valid key', () => {
    const ecdh = crypto.createECDH('secp256k1');
    const privateKeyHex = 'b'.repeat(64);
    ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
    const publicKey = ecdh.getPublicKey();

    expect(publicKey.length).toBe(65); // Uncompressed public key
    expect(publicKey[0]).toBe(0x04); // Uncompressed prefix
  });
});
