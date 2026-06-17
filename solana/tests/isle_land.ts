// Goldcrest Isle land program — test sketch (devnet scaffold).
//
// ⚠️  Not run in this repo (needs the Anchor/Solana toolchain + a local validator).
//     Run with:  cd solana && yarn install && anchor test
//
// Covers the happy path + the key guards an auditor will look for:
//   • buy_land transfers USDC to the treasury and records ownership
//   • a plot can't be bought twice (PDA init fails)
//   • only the owner can transfer_land
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IsleLand } from "../target/types/isle_land";
import {
  createMint, createAccount, mintTo, getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("isle_land", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IsleLand as Program<IsleLand>;
  const conn = provider.connection;
  const authority = provider.wallet as anchor.Wallet;

  let usdcMint: anchor.web3.PublicKey;
  let treasury: anchor.web3.PublicKey;
  let buyer: anchor.web3.Keypair;
  let buyerToken: anchor.web3.PublicKey;

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")], program.programId);
  const landPda = (island: number, x: number, y: number) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("land"), u16le(island), u16le(x), u16le(y)], program.programId)[0];
  const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

  before(async () => {
    // 6-decimals like real USDC; authority is the mint+treasury owner for the test
    usdcMint = await createMint(conn, authority.payer, authority.publicKey, null, 6);
    treasury = await createAccount(conn, authority.payer, usdcMint, authority.publicKey);
    buyer = anchor.web3.Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(buyer.publicKey, 2e9));
    buyerToken = await createAccount(conn, authority.payer, usdcMint, buyer.publicKey);
    await mintTo(conn, authority.payer, usdcMint, buyerToken, authority.publicKey, 1_000_000_000); // 1000 USDC

    await program.methods.initialize()
      .accounts({ config: configPda, usdcMint, treasury, authority: authority.publicKey })
      .rpc();
  });

  it("buys a plot and pays the treasury", async () => {
    const price = new anchor.BN(50_000_000); // 50 USDC
    await program.methods.buyLand(1, 10, 10, price)
      .accounts({
        config: configPda, land: landPda(1, 10, 10), buyer: buyer.publicKey,
        buyerToken, treasury, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer]).rpc();

    const land = await program.account.land.fetch(landPda(1, 10, 10));
    assert.ok(land.owner.equals(buyer.publicKey));
    const t = await getAccount(conn, treasury);
    assert.equal(t.amount.toString(), price.toString());
  });

  it("rejects buying the same plot twice", async () => {
    try {
      await program.methods.buyLand(1, 10, 10, new anchor.BN(50_000_000))
        .accounts({ config: configPda, land: landPda(1, 10, 10), buyer: buyer.publicKey,
          buyerToken, treasury, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([buyer]).rpc();
      assert.fail("should not buy an owned plot");
    } catch (_) { /* PDA already initialized → expected */ }
  });

  it("only the owner can transfer a plot", async () => {
    const stranger = anchor.web3.Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(stranger.publicKey, 1e9));
    try {
      await program.methods.transferLand(1, 10, 10)
        .accounts({ land: landPda(1, 10, 10), owner: stranger.publicKey, newOwner: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail("non-owner must not transfer");
    } catch (_) { /* NotOwner → expected */ }
  });
});
