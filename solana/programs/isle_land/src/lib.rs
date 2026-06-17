// Goldcrest Isle — on-chain land registry (Anchor / Solana).
//
// ⚠️  SCAFFOLD — UNAUDITED, NOT DEPLOYED, NOT WIRED TO THE LIVE GAME.
//     This is the step-5 starting point from the handoff doc, written to be reviewed and
//     iterated, NOT shipped as-is. It has NOT been compiled or tested in this repo (no Rust/
//     Anchor toolchain here). Before any use:
//       1. `anchor build && anchor test` on devnet,
//       2. a professional security audit (it custodies real USDC),
//       3. then wire it in behind the existing off-chain `deeds` flow (see ../README.md).
//
// Hybrid model (see architecture handoff §5): the chain owns *land ownership + USDC payment*
// only. All gameplay (movement, combat, building state, ordinary items) stays off-chain on the
// authoritative game server — forcing those on-chain would be slow, expensive, and bad UX.
//
// Design: each plot is a PDA keyed by (island_id, x, y). buy_land transfers USDC from the buyer
// to a treasury token account (SPL CPI) and records ownership. transfer_land lets the owner hand
// a plot to someone else. An off-chain indexer (Helius webhook) mirrors these events into the
// game DB so the server never has to hit an RPC per frame.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Land11111111111111111111111111111111111111"); // placeholder — replace after `anchor keys list`

#[program]
pub mod isle_land {
    use super::*;

    /// One-time setup: record the authority, the accepted USDC mint, and the treasury token
    /// account that receives land payments.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.usdc_mint = ctx.accounts.usdc_mint.key();
        cfg.treasury = ctx.accounts.treasury.key();
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Buy an unowned plot: pay `price` USDC into the treasury, then record ownership.
    /// The Land PDA's `init` guarantees a plot can only be bought once (re-init fails).
    pub fn buy_land(ctx: Context<BuyLand>, island_id: u16, x: u16, y: u16, price: u64) -> Result<()> {
        require!(price > 0, LandError::ZeroPrice);
        require_keys_eq!(ctx.accounts.treasury.key(), ctx.accounts.config.treasury, LandError::BadTreasury);
        require_keys_eq!(ctx.accounts.buyer_token.mint, ctx.accounts.config.usdc_mint, LandError::WrongMint);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            price,
        )?;

        let land = &mut ctx.accounts.land;
        land.owner = ctx.accounts.buyer.key();
        land.island_id = island_id;
        land.x = x;
        land.y = y;
        land.price_paid = price;
        land.bump = ctx.bumps.land;

        emit!(LandPurchased { owner: land.owner, island_id, x, y, price });
        Ok(())
    }

    /// Transfer a plot to another wallet. Only the current owner may call this.
    pub fn transfer_land(ctx: Context<TransferLand>, _island_id: u16, _x: u16, _y: u16) -> Result<()> {
        let land = &mut ctx.accounts.land;
        require_keys_eq!(land.owner, ctx.accounts.owner.key(), LandError::NotOwner);
        let new_owner = ctx.accounts.new_owner.key();
        land.owner = new_owner;
        emit!(LandTransferred { from: ctx.accounts.owner.key(), to: new_owner,
            island_id: land.island_id, x: land.x, y: land.y });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Land {
    pub owner: Pubkey,
    pub island_id: u16,
    pub x: u16,
    pub y: u16,
    pub price_paid: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    /// Treasury token account (USDC) that will receive land payments.
    #[account(token::mint = usdc_mint)]
    pub treasury: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(island_id: u16, x: u16, y: u16)]
pub struct BuyLand<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Land::INIT_SPACE,
        seeds = [b"land", &island_id.to_le_bytes(), &x.to_le_bytes(), &y.to_le_bytes()],
        bump
    )]
    pub land: Account<'info, Land>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// Buyer's USDC token account (source of payment).
    #[account(mut, token::authority = buyer)]
    pub buyer_token: Account<'info, TokenAccount>,
    /// Treasury USDC token account (destination); must equal config.treasury.
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(island_id: u16, x: u16, y: u16)]
pub struct TransferLand<'info> {
    #[account(
        mut,
        seeds = [b"land", &island_id.to_le_bytes(), &x.to_le_bytes(), &y.to_le_bytes()],
        bump = land.bump
    )]
    pub land: Account<'info, Land>,
    pub owner: Signer<'info>,
    /// CHECK: only used to record the new owner's pubkey.
    pub new_owner: UncheckedAccount<'info>,
}

#[event]
pub struct LandPurchased { pub owner: Pubkey, pub island_id: u16, pub x: u16, pub y: u16, pub price: u64 }
#[event]
pub struct LandTransferred { pub from: Pubkey, pub to: Pubkey, pub island_id: u16, pub x: u16, pub y: u16 }

#[error_code]
pub enum LandError {
    #[msg("price must be greater than zero")] ZeroPrice,
    #[msg("treasury account does not match config")] BadTreasury,
    #[msg("payment token mint is not the configured USDC mint")] WrongMint,
    #[msg("signer is not the current owner of this plot")] NotOwner,
}
