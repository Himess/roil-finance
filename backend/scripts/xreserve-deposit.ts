/**
 * xReserve deposit test script
 *
 * Sends USDC from Ethereum Sepolia to a Canton party via Circle's xReserve.
 * Reference: github.com/digital-asset/xreserve-deposits
 *
 * Usage:
 *   PRIVATE_KEY=0x... CANTON_PARTY=roil::1220... AMOUNT=1 \
 *     npx tsx scripts/xreserve-deposit.ts
 *
 * Prerequisites:
 *   - Sepolia ETH for gas (get from https://sepoliafaucet.com/)
 *   - Sepolia USDC (get from https://faucet.circle.com/)
 *   - User must first onboard via the Roil UI (creates BridgeUserAgreement)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  toHex,
  parseUnits,
  formatUnits,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const X_RESERVE_SEPOLIA = '0x008888878f94C0d87defdf0B07f46B93C1934442' as const;
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const CANTON_DOMAIN = 10001;

const X_RESERVE_ABI = [
  {
    name: 'depositToRemote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'remoteDomain', type: 'uint32' },
      { name: 'remoteRecipient', type: 'bytes32' },
      { name: 'localToken', type: 'address' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

async function main() {
  const pk = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const cantonParty = process.env.CANTON_PARTY;
  const amountStr = process.env.AMOUNT ?? '1';

  if (!pk || !cantonParty) {
    console.error(
      'Required env: PRIVATE_KEY (0x-prefixed hex), CANTON_PARTY (party::1220...)',
    );
    process.exit(1);
  }

  const account = privateKeyToAccount(pk);
  console.log(`Signer: ${account.address}`);
  console.log(`Canton recipient: ${cantonParty}`);

  const rpc = http('https://ethereum-sepolia-rpc.publicnode.com');
  const publicClient = createPublicClient({ chain: sepolia, transport: rpc });
  const walletClient = createWalletClient({ chain: sepolia, transport: rpc, account });

  // Balance checks
  const eth = await publicClient.getBalance({ address: account.address });
  const usdc = (await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;
  console.log(`ETH: ${formatEther(eth)}`);
  console.log(`USDC: ${formatUnits(usdc, 6)}`);

  const amountWei = parseUnits(amountStr, 6);
  if (usdc < amountWei) {
    console.error(
      `Insufficient USDC. Have ${formatUnits(usdc, 6)}, need ${amountStr}.`,
    );
    console.error('Get Sepolia USDC at https://faucet.circle.com/');
    process.exit(1);
  }

  // 1. Approve USDC if needed
  const allowance = (await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, X_RESERVE_SEPOLIA],
  })) as bigint;

  if (allowance < amountWei) {
    console.log('Approving USDC...');
    const approveHash = await walletClient.writeContract({
      address: USDC_SEPOLIA,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [X_RESERVE_SEPOLIA, amountWei],
    });
    console.log(`Approval tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('Approval confirmed');
  }

  // 2. depositToRemote
  const remoteRecipient = keccak256(stringToBytes(cantonParty));
  const hookData = toHex(stringToBytes(cantonParty));

  console.log('\nDepositing to xReserve...');
  console.log(`  value: ${amountStr} USDC (${amountWei} units)`);
  console.log(`  remoteDomain: ${CANTON_DOMAIN}`);
  console.log(`  remoteRecipient: ${remoteRecipient}`);
  console.log(`  hookData: ${hookData}`);

  const depositHash = await walletClient.writeContract({
    address: X_RESERVE_SEPOLIA,
    abi: X_RESERVE_ABI,
    functionName: 'depositToRemote',
    args: [amountWei, CANTON_DOMAIN, remoteRecipient, USDC_SEPOLIA, 0n, hookData],
  });

  console.log(`\nDeposit tx: ${depositHash}`);
  console.log(`Etherscan: https://sepolia.etherscan.io/tx/${depositHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);
  console.log('\nNext: wait ~13-15 min for Ethereum finality, then Circle writes');
  console.log('a DepositAttestation on Canton. Claim via Roil UI or:');
  console.log(`  curl -X POST $BACKEND/api/xreserve/deposits/DEP_ID/claim`);
}

main().catch(err => {
  console.error('Deposit failed:', err);
  process.exit(1);
});
