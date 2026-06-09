# Zeronautt Solana Agent Allowance Demo

This is a small technical demo for the Superteam Canada bounty:
**Technical Demo: Solana Native Subscriptions & Allowances Code Sample**.

## Idea

AI agents increasingly call paid APIs, RPC endpoints, indexers, model routers, and data services. A normal API key is all-or-nothing: if it leaks or a loop runs wild, the user eats the bill.

This demo models a safer pattern:

1. A user creates a Solana subscription authority for a USDC mint.
2. The user grants a recurring allowance to an agent or API gateway delegate.
3. The delegate can pull only a bounded amount per period.
4. The policy is easy to audit, rotate, and expire.

That makes stablecoin API credits feel closer to an OAuth scope: useful for autonomous agents, but capped by on-chain rules.

## Why Subscriptions And Allowances Fit

The official Solana subscriptions program supports fixed delegations, recurring delegations, and subscription plans. The recurring delegation model is the best fit for agent spend because it resets each period while preserving a hard ceiling.

Useful source references:

- https://solana.com/news/subscriptions-and-allowances
- https://github.com/solana-program/subscriptions
- https://solana.com/docs/payments/subscriptions/subscription-plan
- https://docs.chainstack.com/docs/solana-subscriptions-and-allowances

## What This Demo Does

The CLI reads a JSON policy and derives the program addresses needed for a recurring allowance:

- subscription authority PDA for the user/mint pair
- recurring delegation PDA for the user/mint/delegate pair
- base-unit budget for the period
- expiry timestamp
- maximum API calls per period, based on a configured unit price

It uses the public `@solana/subscriptions` TypeScript package instead of hand-written PDA math.

## Run

```bash
npm install
npm run check
```

Expected output is a spending plan with the subscriptions program id, derived PDAs, budget in base units, expiry, and request ceiling.

## Example Policy

```json
{
  "label": "AI research agent RPC budget",
  "network": "devnet",
  "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "owner": "4vJ9JU1bJJE96FWSYJY3uLJSgYk9zYrZ5f2a1x8Kf5w",
  "ownerTokenAccount": "2yYQZLwXxse8pJ6QdFJ2RHHnP8JxsvqVWnzt8nLz8bMp",
  "delegate": "11111111111111111111111111111111",
  "periodSeconds": 86400,
  "periodAmountUi": "3.50",
  "decimals": 6,
  "expiresInDays": 30,
  "service": {
    "name": "Indexing API credits",
    "endpoint": "https://api.example.com/v1/search",
    "unit": "request",
    "maxUnitPriceUi": "0.02"
  }
}
```

The sample addresses are valid public keys for derivation demos. Replace them before sending real transactions.

## Canadian Context

A Canadian Solana builder running a public data API could use this pattern to sell metered access to agents without requiring custody, card billing, or an off-chain credit ledger. For example, an AI research tool in Toronto could grant its indexing gateway a daily USDC allowance, then revoke or reduce it without changing any server-side account.

## Next Steps

- Replace placeholder pubkeys with devnet addresses.
- Add a transaction builder that calls `initSubscriptionAuthority` and `createRecurringDelegation`.
- Add a mock gateway that checks remaining period budget before each API request.
