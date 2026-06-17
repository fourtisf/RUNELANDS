# Plotlands — On-chain Land (Solana / Anchor)

> ⚠️ **Status: unaudited devnet SCAFFOLD. Not deployed. Not wired into the live game.**
> This is the step-5 starting point from the handoff doc. It has **not** been compiled or
> tested in this repo (no Rust/Anchor toolchain here). Treat it as a reviewable blueprint,
> not finished code. **Do not custody real USDC with it until it is built, tested on devnet,
> and professionally audited.**

This is the *only* part of Plotlands that belongs on-chain: **land ownership + USDC
payment**. Everything else (movement, combat, building/farm state, ordinary items, wood/coin)
stays off-chain on the authoritative game server — that's the hybrid model the architecture
doc insists on (§5). Forcing gameplay on-chain would be slow, expensive, and ruin UX.

## What's here
```
solana/
  programs/isle_land/src/lib.rs   Anchor program: initialize / buy_land / transfer_land
  tests/isle_land.ts              happy-path + guard tests (buy, no double-buy, owner-only transfer)
  Anchor.toml, Cargo.toml         workspace config (program id is a placeholder)
  package.json                    JS deps for the tests
```

The program records each plot as a PDA keyed by `(island_id, x, y)`. `buy_land` moves `price`
USDC from the buyer to a treasury token account (SPL CPI) and writes ownership; the PDA's
`init` makes a plot un-buyable twice. `transfer_land` lets the current owner reassign a plot.
Both emit events for the indexer to pick up.

## Build & test (needs the toolchain — not run here)
```
# install Rust + Solana CLI + Anchor (avm), then:
cd solana
yarn install
anchor build
anchor keys list                 # copy the program id into Anchor.toml + declare_id! in lib.rs
anchor test                      # spins a local validator and runs tests/isle_land.ts
```

## How it wires into the running game (today → on-chain)
The Merchant already sells a **Land Deed** and the server tracks a `deeds` count per account
(off-chain, server-authoritative). That stays the source of truth until the chain is live.
The migration path, in order:

1. **Program → devnet.** Build, test, deploy to devnet. Keep mainnet off until audited.
2. **Client wallet.** Add `@solana/wallet-adapter` (Phantom) to the client. Guests still play
   with **no wallet**; a wallet is only needed to *buy* land (guest-mode funnel stays intact —
   architecture doc §6). The client already stores a guest id in `localStorage`; link the
   wallet pubkey to that guest account on connect.
3. **Indexer.** A small service subscribes to `LandPurchased` / `LandTransferred` (Helius
   webhook or Geyser) and mirrors ownership into the game DB. The game server reads ownership
   from the DB — never an RPC per frame.
4. **Server reconciliation.** Extend `store.js` with a `land` table
   `(island_id, x, y, owner_account_id, nft_mint, tx_sig, purchased_usdc)` and have the server
   gate land-only actions (e.g. building on owned plots) on DB ownership. The off-chain `deeds`
   counter becomes a pre-wallet convenience that can be reconciled/retired.

## Non-negotiables (real money = real incentives to cheat)
- **Audit before mainnet.** This program custodies USDC. No exceptions (architecture doc §5, §7).
- **Chain secures ownership/payment, NOT gameplay.** The server stays authoritative for play;
  the chain is consulted for *who owns which plot*, not for what happens in the world.
- **Guest-first.** Never put a wallet in front of first play — it's the whole onboarding edge.
