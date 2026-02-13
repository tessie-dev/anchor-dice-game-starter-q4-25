import anchor from "@coral-xyz/anchor";
import { randomBytes } from "crypto";

const { BN, Program, web3 } = anchor;
const { Keypair, PublicKey, SystemProgram, Transaction, Ed25519Program, LAMPORTS_PER_SOL } = web3;

describe("anchor-dice-game-q4-25", () => {
  const payer = Keypair.generate();
  const provider = new anchor.AnchorProvider(
    new web3.Connection("http://127.0.0.1:8899", "confirmed"),
    new anchor.Wallet(payer),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.anchorDiceGameQ425 as anchor.Program<any>;

  const house = Keypair.generate();
  const player = Keypair.generate();
  const seed = new BN(randomBytes(16), "le");

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), house.publicKey.toBuffer()],
    program.programId
  );
  const [bet] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), vault.toBuffer(), seed.toArrayLike(Buffer, "le", 16)],
    program.programId
  );

  const confirmTx = async (sig: string) => {
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature: sig,
        ...latest,
      },
      "confirmed"
    );
  };

  it("Airdrop", async () => {
    const sigs = await Promise.all(
      [payer, house, player].map((kp) =>
        connection.requestAirdrop(kp.publicKey, 20 * LAMPORTS_PER_SOL)
      )
    );
    await Promise.all(sigs.map(confirmTx));
  });

  it("Initialize", async () => {
    const sig = await program.methods
      .initialize(new BN(10 * LAMPORTS_PER_SOL))
      .accountsStrict({
        house: house.publicKey,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .signers([house])
      .rpc();

    await confirmTx(sig);
  });

  it("Place a bet", async () => {
    const sig = await program.methods
      .placeBet(seed, 96, new BN(LAMPORTS_PER_SOL / 100))
      .accountsStrict({
        player: player.publicKey,
        house: house.publicKey,
        vault,
        bet,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

    await confirmTx(sig);
  });

  it("Resolve a bet", async () => {
    const account = await connection.getAccountInfo(bet, "confirmed");
    if (!account) {
      throw new Error("Bet account not found");
    }

    const sigIx = Ed25519Program.createInstructionWithPrivateKey({
      privateKey: house.secretKey,
      message: account.data.subarray(8),
    });

    const resolveIx = await program.methods
      .resolveBet(Buffer.from(sigIx.data.slice(48, 112)))
      .accountsStrict({
        house: house.publicKey,
        player: player.publicKey,
        vault,
        bet,
        instructionsSysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .signers([house])
      .instruction();

    const tx = new Transaction().add(sigIx, resolveIx);
    const sig = await web3.sendAndConfirmTransaction(connection, tx, [house], {
      commitment: "confirmed",
    });
    await confirmTx(sig);
  });
});
