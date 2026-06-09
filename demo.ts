import { readFile } from "node:fs/promises";
import { inspect } from "node:util";

import { address } from "@solana/kit";
import {
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  SUBSCRIPTIONS_PROGRAM_ADDRESS
} from "@solana/subscriptions";

type Network = "devnet" | "mainnet-beta" | "localnet";

type Service = {
  name: string;
  endpoint: string;
  unit: string;
  maxUnitPriceUi: string;
};

type Policy = {
  label: string;
  network: Network;
  mint: string;
  owner: string;
  ownerTokenAccount: string;
  delegate: string;
  periodSeconds: number;
  periodAmountUi: string;
  decimals: number;
  expiresInDays: number;
  service: Service;
};

type SpendingPlan = {
  label: string;
  network: Network;
  programId: string;
  subscriptionAuthorityPda: unknown;
  recurringDelegationPda: unknown;
  periodSeconds: number;
  periodAmountBaseUnits: bigint;
  expiresAtUnix: number;
  maxRequestsPerPeriod: bigint;
  userFacingSummary: string;
};

function parseUiAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ""] = amount.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(normalizedFraction || "0");
}

function assertPolicy(policy: Policy): void {
  if (!policy.label.trim()) throw new Error("label is required");
  if (!policy.mint.trim()) throw new Error("mint is required");
  if (!policy.owner.trim()) throw new Error("owner is required");
  if (!policy.ownerTokenAccount.trim()) throw new Error("ownerTokenAccount is required");
  if (!policy.delegate.trim()) throw new Error("delegate is required");
  if (!Number.isInteger(policy.periodSeconds) || policy.periodSeconds <= 0) {
    throw new Error("periodSeconds must be a positive integer");
  }
  if (!Number.isInteger(policy.decimals) || policy.decimals < 0 || policy.decimals > 18) {
    throw new Error("decimals must be an integer from 0 to 18");
  }
  if (!Number.isInteger(policy.expiresInDays) || policy.expiresInDays <= 0) {
    throw new Error("expiresInDays must be a positive integer");
  }
}

async function buildSpendingPlan(policy: Policy): Promise<SpendingPlan> {
  assertPolicy(policy);

  const userAddress = address(policy.owner);
  const mintAddress = address(policy.mint);
  const delegateAddress = address(policy.delegate);
  const nonce = 0n;
  const periodAmountBaseUnits = parseUiAmount(policy.periodAmountUi, policy.decimals);
  const maxUnitPriceBaseUnits = parseUiAmount(policy.service.maxUnitPriceUi, policy.decimals);
  const maxRequestsPerPeriod =
    maxUnitPriceBaseUnits > 0n ? periodAmountBaseUnits / maxUnitPriceBaseUnits : 0n;
  const expiresAtUnix = Math.floor(Date.now() / 1000) + policy.expiresInDays * 24 * 60 * 60;

  const [subscriptionAuthorityPda] = await findSubscriptionAuthorityPda({
    user: userAddress,
    tokenMint: mintAddress
  });

  const [recurringDelegationPda] = await findRecurringDelegationPda({
    subscriptionAuthority: subscriptionAuthorityPda,
    delegator: userAddress,
    delegatee: delegateAddress,
    nonce
  });

  return {
    label: policy.label,
    network: policy.network,
    programId: SUBSCRIPTIONS_PROGRAM_ADDRESS,
    subscriptionAuthorityPda,
    recurringDelegationPda,
    periodSeconds: policy.periodSeconds,
    periodAmountBaseUnits,
    expiresAtUnix,
    maxRequestsPerPeriod,
    userFacingSummary:
      `${policy.service.name}: delegate can pull at most ${policy.periodAmountUi} tokens ` +
      `every ${policy.periodSeconds}s until ${new Date(expiresAtUnix * 1000).toISOString()}.`
  };
}

async function main(): Promise<void> {
  const policyPath = process.argv[2];
  if (!policyPath) {
    throw new Error("Usage: npm run demo -- agent-api-allowance.json");
  }

  const policy = JSON.parse(await readFile(policyPath, "utf8")) as Policy;
  const plan = await buildSpendingPlan(policy);

  console.log(inspect(plan, { depth: null, colors: false }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
