# RUNELANDS — Solana Fantasy Realm MMO — Technical Architecture & Build Handoff

**Untuk:** Michael (implementasi via Claude Code)
**Dari:** ALFA / Fourtis
**Referensi:** islands.games (2D top-down tile MMO, USDC land on Solana, build/fight/trade, guest play)
**Status:** Blueprint v1 — baca seluruh dokumen sebelum mulai ngoding.

---

## 0. Baca ini dulu (honest framing)

Ini **bukan** project setipe Gold Mine Tycoon atau Cosmic Hunter. Game itu single-player / loop sederhana — nggak ada server yang harus nge-sync state ratusan pemain real-time. Ini MMO. **80% kesulitan ada di netcode (Fase 1)**, bukan di grafis atau blockchain.

Aturan utama yang nggak bisa ditawar: **server-authoritative**. Client nggak pernah dipercaya soal posisi, saldo, kepemilikan, atau hasil combat. Karena ada uang asli (USDC), kalau client yang nentuin state, game langsung di-exploit dalam hitungan jam.

Estimasi realistis solo dev kompeten: **3–4 bulan** sampai versi kasar tapi beneran jalan. Kalau Michael belum pernah pegang real-time multiplayer, Fase 1 akan lebih lama dari perkiraan — budgetkan itu, jangan kaget.

---

## 1. Arsitektur tingkat tinggi

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER CLIENT                          │
│  Phaser 3 (render tile + sprite)  +  TypeScript                │
│  Solana wallet-adapter (Phantom)  +  Colyseus client SDK       │
│  - Kirim INPUT (intent gerak/aksi), bukan posisi               │
│  - Client prediction + interpolation untuk visual smooth       │
└───────────────┬──────────────────────────┬────────────────────┘
                │ WebSocket (state sync)     │ RPC (read-only)
                ▼                            ▼
┌──────────────────────────────┐   ┌─────────────────────────────┐
│      GAME SERVER (Colyseus)    │   │     SOLANA (Anchor program) │
│  - Room = 1 realm/zona         │   │  - Land = NFT / PDA registry│
│  - Authoritative simulation    │   │  - buy_land (bayar USDC)    │
│  - Tick 10–20 Hz               │   │  - treasury + ownership     │
│  - Area of Interest (grid)     │   └──────────────┬──────────────┘
│  - Anti-cheat (validasi semua) │                  │ webhook/geyser
└────────┬──────────────┬────────┘                  ▼
         │              │                  ┌─────────────────────┐
         ▼              ▼                  │   INDEXER (Helius)   │
┌────────────────┐ ┌─────────┐             │  sync ownership →DB  │
│   PostgreSQL    │ │  Redis  │◄────────────┘                     │
│ (persistent)    │ │ presence│
│ akun, land,     │ │ pub/sub │
│ inventory, bld  │ │ session │
└────────────────┘ └─────────┘
```

**Prinsip pemisahan tanggung jawab:**
- **Blockchain hanya untuk kepemilikan & pembayaran** (land, aset bernilai tinggi, USDC). BUKAN untuk logika gameplay (gerak, combat, drop loot). Salah kaprah paling umum di game crypto: maksa semua on-chain → mahal + lemot + UX hancur.
- **Game server pegang semua logika gameplay** dan jadi satu-satunya sumber kebenaran saat main.
- **Indexer** nyalin kepemilikan on-chain ke Postgres, biar game server nggak nembak RPC tiap frame.

---

## 2. Tech stack + alasan

| Layer | Pilihan | Alasan | Tradeoff jujur |
|---|---|---|---|
| Render | **Phaser 3** + TypeScript | Engine 2D matang, tilemap & sprite built-in, dokumentasi tebal | Alternatif PixiJS lebih ringan tapi harus bikin sistem game sendiri |
| Netcode | **Colyseus** (Node.js) | Framework MMO room-based; delta state sync otomatis (Schema), matchmaking, scaling via Redis. Motong kerjaan netcode mentah berbulan-bulan | Opinionated; kalau butuh kontrol ekstrem, raw WebSocket/Go lebih fleksibel tapi jauh lebih lama |
| DB persistent | **PostgreSQL** | Relasional, cocok buat akun/land/inventory | — |
| State live | **Redis** | Presence antar-room, pub/sub, session | — |
| Chain | **Anchor (Rust)** di Solana | Standar de-facto program Solana | Nulis program aman butuh skill khusus + audit sebelum pegang USDC asli |
| Indexer | **Helius webhooks** atau geyser | Sync ownership tanpa polling RPC | Helius = layanan berbayar saat skala |
| Build | Vite | Cepat | — |
| Deploy | Docker → Railway/Fly.io awal, k8s saat skala | Mulai kecil | — |

---

## 3. Netcode — bagian yang menentukan hidup-mati (Fase 1)

Ini inti MMO. Salah di sini, sisanya percuma.

**3.1 Server-authoritative loop**
- Client kirim **input** (`{moveX, moveY, action}` + sequence number), BUKAN posisi.
- Server simulasi di fixed tick (mulai **15 Hz** cukup buat top-down).
- Server broadcast state patch authoritative tiap tick.

**3.2 State sync**
- Pakai **Colyseus Schema** → delta encoding otomatis, cuma field berubah yang dikirim. Jangan kirim full state tiap tick.

**3.3 Area of Interest (AoI)**
- Room 100 pemain TIDAK boleh broadcast semua ke semua (O(n²) → meledak).
- Bagi peta jadi grid bucket (spatial hashing). Pemain cuma terima entity dalam radius pandang + bucket tetangga.
- Ini yang bikin "feels fine pas 3 tester, melt pas 80 pemain" kalau dilewatin.

**3.4 Client prediction + interpolation**
- Gerakan diri sendiri: prediksi lokal langsung (biar responsif), lalu rekonsiliasi pas state server datang — koreksi halus, jangan teleport.
- Pemain lain: interpolasi antar snapshot dengan buffer ~100ms biar gerak mulus walau tick jarang.

**3.5 Room = shard**
- 1 room = 1 realm/zona, cap **~50–100 pemain**. Penuh → spawn instance room baru. Inilah cara MMO "muat ribuan pemain" tanpa satu server jebol.

> **Milestone Fase 1 = jalan-jalan di peta dan lihat pemain lain gerak real-time dengan smooth.** Jangan lanjut ke combat/building sebelum ini solid.

---

## 4. Data model (PostgreSQL)

```sql
accounts        (id, wallet_pubkey NULLABLE, is_guest, created_at)
characters      (id, account_id, level, xp, hp, island_id, x, y)
land            (id, island_id, coord_x, coord_y, owner_account_id,
                 nft_mint, purchased_usdc, tx_sig, purchased_at)
buildings       (id, land_id, type, level, state_json, placed_at)
inventory       (account_id, item_id, qty)
trades          (id, from_acct, to_acct, items_json, status, created_at)
```

- **Live state** (posisi real-time, HP saat combat) → di memory Colyseus room + Redis, persist berkala & saat event penting (logout, transaksi).
- `wallet_pubkey` nullable → mendukung **guest mode** (lihat §6).

---

## 5. Solana program (Anchor)

Instruksi minimal:
- `buy_land(island_id, coord)` → verifikasi transfer USDC ke treasury, catat ownership (PDA registry atau mint land NFT), emit event.
- `transfer_land` / `list_land` → trading antar pemain.

**Keputusan hybrid (penting):**
- **On-chain:** land + aset bernilai tinggi + USDC. Ini yang user "beneran punya".
- **Off-chain (DB):** item biasa, building state, progress. Murah, instan, UX enak.
- Maksa item recehan on-chain = fee + latency bunuh UX. Semua game crypto yang jalan pakai model hybrid ini.

**Wajib:** program yang pegang USDC asli harus di-**audit** sebelum mainnet. Jangan skip.

---

## 6. Guest mode (kunci onboarding)

islands.games menang karena bisa main **tanpa wallet**. Replikasi:
- Guest → server bikin akun ephemeral (`is_guest=true`), nggak ada tulisan on-chain, main gratis.
- Saat mau beli land / klaim aset → connect wallet, link ke akun, baru transaksi on-chain.
- Friksi nol di awal = funnel jauh lebih lebar. Jangan paksa wallet di depan.

---

## 7. Anti-cheat (non-negotiable, ada uang asli)

- Semua logika di server. Validasi tiap aksi: mampu bayar? dalam jangkauan? cooldown lewat? pemilik land?
- Rate-limit aksi per akun.
- **Blockchain mengamankan kepemilikan/pembayaran, BUKAN gameplay.** Salah paham ini = di-drain.

---

## 8. Build phases + Claude Code prompt sequence

Kerjakan **berurutan**. Jangan loncat.

### Fase 0 — Foundations (1–2 minggu)
> Prompt CC: "Set up a Phaser 3 + TypeScript + Vite project. Load a tilemap (Tiled JSON), render a top-down map, add a player sprite with WASD movement, camera follow, and collision against a 'walls' layer. Single player, no server yet."

### Fase 1 — Multiplayer core (3–5 minggu) ⚠️ milestone terberat
> Prompt CC: "Add a Colyseus server (Node + TypeScript). Create one Room representing a realm. Implement server-authoritative movement: client sends input with sequence numbers, server simulates at a 15Hz fixed tick using Colyseus Schema for state. Implement client-side prediction + reconciliation for the local player and interpolation for remote players. Add a spatial-hash grid for area-of-interest filtering."
>
> Test wajib: simulasikan 50+ bot client, ukur bandwidth & latency sebelum lanjut.

### Fase 2 — Game systems (3–4 minggu)
> Prompt CC: "On the authoritative server, add: enemy hordes (spawn, simple AI, server-side combat with HP/damage validation), building placement (validate ownership + collision), inventory, and XP/leveling. Persist character, inventory, and building state to PostgreSQL with periodic + event-based saves."

### Fase 3 — Solana land + guest mode (2–3 minggu)
> Prompt CC step A (program): "Write an Anchor program with a buy_land instruction that verifies a USDC transfer to a treasury and records land ownership in a PDA registry, plus a transfer_land instruction. Include tests."
>
> Prompt CC step B (integrasi): "Add @solana/wallet-adapter to the client (Phantom). Add a Helius webhook indexer service that syncs on-chain land ownership into the `land` table. Implement guest accounts (no wallet) and wallet-linking flow."

### Fase 4 — Trading & economy (2–3 minggu)
> Prompt CC: "Implement server-validated P2P trading (items off-chain via DB, land via on-chain transfer_land) with a confirm/escrow flow and a simple marketplace listing UI."

### Fase 5 — Scale & polish
> AoI tuning, multi-room spawning, load test, anti-cheat hardening, reconnect handling.

---

## 9. Risk callouts (jujur)

1. **Netcode (Fase 1) = make-or-break.** Kalau molor, ini sumbernya. Jangan remehkan.
2. **Load test sebelum launch.** Enak pas 3 tester, jebol pas 80. Wajib simulasi bot.
3. **On-chain everything = jebakan.** Pakai hybrid.
4. **Anti-cheat.** Uang asli = insentif cheat asli. Server authority mutlak.
5. **Scope creep.** islands.games hasil iterasi bertahun-tahun. Jangan clone semua — kunci MVP (lihat di bawah).
6. **Audit program Solana** sebelum pegang USDC mainnet.

---

## 10. Rekomendasi MVP (kalau mau potong scope)

Buat validasi tercepat tanpa bangun MMO penuh:
- Cap pemain per room kecil (10–20) dulu — skip optimasi AoI berat.
- Gameplay loop minimal: gerak + build + 1 tipe combat.
- Hook utama = **beli land on-chain pakai USDC** (ini yang nyambung ke brand crypto lo).
- Skip trading kompleks & ratusan pemain sampai ada traction.

Kalau MVP rame → baru investasi ke netcode skala penuh.

---

*Catatan: dokumen ini blueprint, bukan kode jadi. Tiap fase butuh iterasi & judgment manusia — Claude Code ngeluarin potongan, tapi nyatuin jadi MMO yang stabil tetap kerjaan engineering beneran.*
