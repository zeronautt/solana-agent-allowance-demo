# Solana Native Subscriptions And Allowances: A Technical Deep Dive For Agent And SaaS Metering

Solana's native subscriptions and allowances primitive gives builders a shared on-chain way to model recurring payments, bounded delegated spending, and merchant pull payments without every application inventing its own approval ledger. That sounds narrow at first, but it touches a much larger product surface: SaaS billing, API credits, AI-agent spend limits, wallet-safe automations, and subscriptions that can be audited from the chain instead of trusted only inside a provider dashboard.

This writeup explains the architecture, where the primitive fits, the tradeoffs teams should understand before adopting it, and how Canadian companies or builders could use it for real products. A runnable companion demo is available in this repository:

https://github.com/zeronautt/solana-agent-allowance-demo

## The Problem: Token Approvals Are Too Coarse For Modern Software

SPL Token approvals are useful, but they are low-level. A token account can approve a delegate, and that delegate can spend up to an approved amount. For simple escrow or one-off allowance flows, that can be enough. For modern product billing, it is not expressive enough by itself.

Consider an API gateway that wants to let a user spend at most 3.50 USDC per day on indexer calls. The provider does not want custody. The user does not want to approve unlimited spend. The application does not want to run an off-chain credit ledger that is opaque to the user. The ideal model is closer to an OAuth scope for money:

- the delegate is explicit
- the spend cap is explicit
- the period is explicit
- the expiry is explicit
- the approval can be revoked
- the rule is visible to wallets, indexers, and other applications

Native subscriptions and allowances are designed to make that kind of rule reusable.

## The Core Architecture

The important design move is the subscription authority, usually abbreviated as SA. For each user and mint pair, the program derives a subscription authority PDA. The user's token account approves that SA as the token delegate with a high allowance. The SA then becomes the only delegate that the token account needs at the SPL Token layer.

That does not mean every merchant or agent can freely pull tokens. The SA is constrained by program-owned delegation accounts. A transfer must be authorized by a specific delegation PDA, such as a fixed delegation, recurring delegation, or subscription-plan delegation. In other words, the token program sees one delegate, while the subscriptions program multiplexes many higher-level delegations behind it.

The result is a two-layer model:

1. Token layer: the user's token account delegates to the subscription authority PDA.
2. Subscription layer: the program checks whether a specific delegation or subscription account allows the requested transfer.

This avoids the single-delegate limitation becoming a product bottleneck. A wallet can have one SA for a USDC mint and then use several separate rules: one for an API gateway, one for a SaaS subscription, one for a capped automation bot, and one for a temporary fixed allowance.

## The Three Useful Models

The primitive supports three models that cover different product needs.

### Fixed Delegation

A fixed delegation authorizes a delegate to spend up to a total amount, optionally with an expiry. This is a good fit for bounded one-time tasks:

- a contractor payment capped at a fixed amount
- a one-day event pass
- a one-off agent task budget
- a refund or reimbursement window

The value is that the delegate does not need custody and the user does not need to approve an unlimited token allowance.

### Recurring Delegation

A recurring delegation authorizes a delegate to spend up to a per-period amount. The period can be configured, and the delegation can have an overall expiry. This is the most natural model for metered software:

- 10 USDC per month for a hosted tool
- 3.50 USDC per day for API calls
- 1 USDC per hour for an autonomous bot
- a weekly data budget for a research agent

The key detail is the hard ceiling per period. The merchant or delegate can pull funds only within the rule. If a loop runs wild, the on-chain allowance is still the upper bound.

### Subscription Plans

A subscription plan is the merchant-facing version. A merchant publishes a plan with pricing terms. A subscriber accepts those terms. The merchant, or whitelisted pullers, can then collect according to the plan.

This model is useful when the product is not just "delegate X can spend Y", but "merchant M offers plan P and subscribers opt in." Wallets and dashboards can show that relationship more clearly than a raw token approval.

## How The Demo Maps To The Primitive

The companion demo uses the recurring delegation model for a concrete AI-agent API budget. It reads a JSON policy:

```json
{
  "label": "AI research agent RPC budget",
  "periodSeconds": 86400,
  "periodAmountUi": "3.50",
  "service": {
    "name": "Indexing API credits",
    "unit": "request",
    "maxUnitPriceUi": "0.02"
  }
}
```

From that policy, the TypeScript CLI calculates:

- the subscription authority PDA for the owner and token mint
- the recurring delegation PDA for the owner, delegate, and nonce
- the period amount in base units
- the expiry timestamp
- the maximum request count allowed by the period budget
- the `createRecurringDelegation` instruction and parsed instruction data

The demo uses `@solana/subscriptions` and `@solana/kit` rather than hand-written PDA math:

```ts
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
```

It also builds the recurring delegation instruction with the generated SDK:

```ts
const instruction = getCreateRecurringDelegationInstruction({
  delegator: createNoopSigner(userAddress),
  subscriptionAuthority: subscriptionAuthorityPda,
  delegationAccount: recurringDelegationPda,
  delegatee: delegateAddress,
  recurringDelegation: {
    nonce,
    amountPerPeriod: periodAmountBaseUnits,
    periodLengthS: BigInt(policy.periodSeconds),
    startTs,
    expiryTs: BigInt(expiresAtUnix),
    expectedSubscriptionAuthorityInitId: 0n
  }
});
```

Running `npm run check` builds the TypeScript and runs the demo. The example outputs the subscriptions program id, the derived PDAs, the daily USDC base-unit allowance, a request ceiling of 175 API calls per period for a 0.02 USDC unit price, and a parsed instruction summary with the discriminator, account count, data length, period amount, period length, start time, expiry, and expected subscription-authority init id.

That is a small example, but it shows the business logic: an API gateway can map on-chain allowance to off-chain service metering. Before each request, the gateway can check its local usage ledger and the delegation rule. At collection time, it pulls only what the rule permits.

## Why This Is Better Than A Normal API Key

An API key usually authorizes behavior inside a vendor's backend. If the key leaks, if an agent loops, or if a customer misconfigures automation, the provider's billing system decides what happens. Some providers offer usage limits, but those limits are off-chain and provider-specific.

A recurring on-chain allowance changes the control point. The user's wallet owns the spend rule. The service can still meter usage, but it cannot exceed the token allowance. The user can revoke, reduce, or expire the delegation without asking the provider to change an internal account record.

This is especially relevant for autonomous agents. Agents are good at making many small calls: RPC, search, model inference, data enrichment, transaction simulation, indexer queries. Those calls are valuable, but the failure mode is expensive. A bounded recurring allowance lets an owner give the agent enough autonomy to be useful while preserving a hard financial boundary.

## Tooling And Current Developer Path

The current developer path is practical enough to experiment with:

- The Solana subscriptions program is published as a shared program.
- The TypeScript client is available as `@solana/subscriptions`.
- The client can derive the relevant PDAs and wrap program instructions.
- The program supports SPL Token and Token-2022 mints, with important caveats around configured TransferHook behavior.
- The program emits on-chain events for indexer integration.
- Rent for delegation, plan, and subscription authority accounts is recoverable when accounts are closed.

For production work, a team should still build a clear UX around the setup steps. Users need to understand that the first step enables a subscription authority for a mint, and later steps create specific delegations or subscriptions. The primitive is powerful, but wallet copy matters. A spender should never be hidden behind vague language like "connect account" or "enable payments."

## Product Opportunities

### Agent Infrastructure

Agent platforms can offer wallet-scoped budgets instead of API-key-only billing. A user could give an agent a 5 USDC daily budget for research, a 20 USDC monthly budget for model calls, and a separate fixed 2 USDC budget for a one-time data purchase.

The advantage is composability. A wallet dashboard, block explorer, or accounting tool can inspect the same rules that the agent platform uses.

### SaaS Billing

SaaS products can model monthly subscriptions or usage credits without taking custody. The service still needs account management, user support, and service delivery logic, but payment authorization can be explicit and user-controlled.

This is a particularly good fit for crypto-native SaaS where the user already pays in stablecoins and expects wallet-native controls.

### API And RPC Marketplaces

RPC providers, indexers, and data vendors can sell metered access with predictable caps. A recurring delegation can represent the customer's maximum spend per period, while the provider's gateway enforces request-level pricing.

This creates a clean separation:

- Solana enforces the maximum pullable amount.
- The gateway enforces usage accounting and service limits.
- The user keeps revocation and expiry control.

### Merchant Subscriptions

The subscription plan model fits products where a merchant publishes terms and subscribers accept them. A merchant can collect according to the agreed schedule while subscribers retain on-chain visibility.

That can reduce the amount of custom billing infrastructure needed by wallet-native products.

## Canadian Relevance

Superteam Canada asked for thoughtful Canadian context, so here are concrete examples of where the primitive could matter. These are not claims that the companies are adopting it; they are product-fit examples.

### Shopify

Shopify is a Canadian commerce company with a massive app and merchant ecosystem. A wallet-native merchant app could use recurring allowances for paid add-ons: inventory intelligence, analytics, storefront automation, or AI-generated product enrichment. Instead of storing a card and billing later, an app could request a capped monthly stablecoin allowance. The merchant would see the rule in a wallet and could revoke it when uninstalling the app.

### Cohere

Cohere is a Canadian AI company. AI inference and retrieval services are naturally metered. A crypto-native integration could use recurring delegations to sell bounded inference credits to autonomous agents or organizations that want deterministic spend ceilings. The value is not "AI on-chain"; it is simple spend control for software that can call APIs faster than humans can supervise.

### Ada

Ada, a Canadian customer-service automation company, is another good conceptual fit. Support agents often call tools, knowledge bases, CRMs, and external APIs. If a customer wanted wallet-native payment for usage-based automations, recurring allowances could cap tool spend by workspace, bot, or customer account.

### Lightspeed Commerce

Lightspeed Commerce serves merchants and point-of-sale workflows. Merchant subscriptions, add-on services, and usage-based integrations could all map to subscription plans or recurring allowances. The benefit would be strongest for merchants that already accept stablecoins or operate in crypto-native markets.

The broader Canadian angle is straightforward: Canada has strong commerce, fintech, AI, and SaaS companies. Those are exactly the sectors where predictable recurring billing and metered API spend already exist. Solana's primitive gives those patterns a wallet-native implementation path.

## Tradeoffs And Risks

### UX Complexity

The architecture is safer than unlimited approvals, but it is still a multi-step setup. A user may need to enable a subscription authority and then create a specific delegation or subscription. If a product hides that complexity, users may approve rules they do not understand. Wallets and apps should display delegate, mint, period, amount, expiry, and revocation path.

### Off-Chain Metering Still Matters

The chain can enforce the maximum amount a delegate can pull. It does not know whether an API request was useful, whether a model response was correct, or whether a service fulfilled its promise. Providers still need fair usage accounting, receipts, and dispute handling.

### Pull Payments Need Operational Discipline

Merchants must handle retries, idempotency, failed pulls, and customer state transitions. The primitive gives a payment permission layer, not a full billing department.

### Token And Regulatory Considerations

Many examples use USDC because it is practical for stable pricing, but teams still need to account for geography, taxes, reporting, and compliance. This is especially true for consumer products and regulated industries.

### Token-2022 Extension Constraints

Token-2022 support is valuable, but configured TransferHook behavior has restrictions. Teams using advanced token extensions should test their mint configuration before assuming subscriptions will work.

### Social And Discovery Still Matter

For bounty judging and real go-to-market, a public artifact with traction may score better than a technically correct private document. The primitive is infrastructure; the market still rewards clear explanations, demos, and integrations that real teams can understand quickly.

## Implementation Checklist

For a team building with subscriptions and allowances, I would start with this checklist:

1. Pick the right model: fixed, recurring, or subscription plan.
2. Use the official client package instead of hand-writing account derivation.
3. Display the delegate, mint, amount, period, and expiry before approval.
4. Add a one-click revoke path.
5. Index events so dashboards and support tools stay in sync.
6. Make collection idempotent.
7. Treat on-chain allowance as the maximum, not as proof that service was delivered.
8. Close unused accounts where appropriate so rent can be recovered.

## Conclusion

Subscriptions and allowances are not just "recurring payments on Solana." The more interesting idea is programmable, inspectable spending permission. That is useful anywhere software needs limited autonomy: SaaS billing, API credits, AI agents, merchant subscriptions, and tool-calling automations.

The architecture is also realistic. It uses a subscription authority PDA to work around the single-delegate shape of token accounts, then adds higher-level delegation accounts for fixed, recurring, and merchant-plan flows. That gives users stronger control while giving developers a common primitive to build on.

The next wave of wallet-native products will need billing and spend controls that feel as normal as OAuth scopes and API keys. Solana's subscriptions and allowances primitive is a credible step in that direction.

## References

- Solana announcement: https://solana.com/news/subscriptions-and-allowances
- Solana subscriptions program: https://github.com/solana-program/subscriptions
- Solana subscription plan docs: https://solana.com/docs/payments/subscriptions/subscription-plan
- Demo repository: https://github.com/zeronautt/solana-agent-allowance-demo
