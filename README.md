# ARK Wallet

A lightweight, open-source desktop wallet for the [ARK](https://ark.io) blockchain (ARK Core v3 mainnet and devnet),
for macOS, Windows and Linux.

> **Independent community project.** ARK Wallet is not affiliated with or endorsed by ARK.io / ARK SCIC. The original
> ARK Desktop Wallet was archived in 2023 in favour of the web-based ARKVault; this project is a fresh native take on a
> desktop wallet.

## Features

- **Wallet collection**: add any number of mainnet / devnet wallets by address, by passphrase (only the address is
  kept), or by creating a new BIP39 12/24-word passphrase with a backup check.
- **Balances & portfolio**: live balances, total portfolio value and a 7-day ARK price chart (CoinGecko, 14 currencies).
- **Transactions**: paginated history with All / Received / Sent filters, memos, multipayment and vote details, and
  links to the explorer.
- **Send**: transfers and multipayments (up to 64 recipients) with an optional memo (vendor field, 255 bytes).
- **Vote**: vote, unvote, or **switch your vote in a single transaction** (`["-old", "+new"]`). Searchable delegate list
  with rank, votes and approval.
- **Fees**: every transaction shows the exact **minimum fee** the network accepts, calculated from its size (memo
  included) with the node's dynamic-fee rules, next to the 7-day **average**, or a custom fee. Your Minimum / Average
  choice is remembered as the default.
- **Second passphrase**: sign with it automatically when a wallet has one, or register a new one.
- **Delegates**: register a delegate name (with availability check) or resign.
- **Sign / verify messages**.
- **Custom API**: every network uses the official ARK API by default (`https://api.ark.io/api`,
  `https://dwallets.ark.io/api`), and you can point it at your own Core v3 node. The node is checked before it is saved.

## Security model

- **Passphrases are never stored.** The app saves only public data (addresses, names, settings) in
  `state.json` in the OS app-data folder.
- You type the passphrase when you sign. It goes to the Rust core, is used once to sign locally, and is then zeroized.
  Only the signed transaction is sent to the node.
- The Rust core checks that the passphrase matches the wallet's address (and that the second passphrase matches the
  wallet's second public key) before signing, and verifies its own signature before returning it.
- Signing uses ARK's Schnorr scheme (the same one as ARK's own SDKs); message signing uses ECDSA. The serializer and
  signature code are tested against real mainnet transactions of every supported type (see
  `src-tauri/tests/fixtures`).

## How fees are calculated

ARK Core v3 accepts a transaction when

```
fee >= (addonBytes[type] + round(serializedBytes / 2)) * minFeePool
```

`addonBytes` and `minFeePool` come from the node's `/node/configuration`, and the size includes the memo and any second
signature. This was checked against a live node: a fee of exactly this minimum passes the fee check, and one arktoshi
less is rejected with `ERR_LOW_FEE`. The "Average" option uses the node's 7-day `/node/fees` statistics, or the static
network fee when there's no recent data for that transaction type.

## Tested on mainnet

Every supported mainnet transaction type was signed with this code and broadcast at its computed minimum fee
(test wallet `AZChBii7Qj4kipkNr3EuMVTqzmMPUT9KPH`, 2026-11-21). All were accepted and confirmed:

| Transaction | Size | Fee (ARK) | ID |
|---|---|---|---|
| Transfer with memo | 175 B | 0.00564 | `6284ee42b4515f2dc02e2ebaaee97cc8594a969c70584888caf20e58db4a6715` |
| Multipayment (2) with memo | 200 B | 0.018 | `75724af1d5fab6b56648c022bd62f0ead82b0f6b6a2c69e4618fc315d72da2de` |
| Vote | 158 B | 0.00537 | `5d291b306936f67871c661aa7374656506351a5fd48f3b4c574e2e1c3499907e` |
| Switch vote (unvote + vote in one) | 192 B | 0.00588 | `a35a51d8a311d8192ed9cdee68deefe0fd1576ee69e39f0a7e27a8cf3487f5f5` |
| Unvote | 158 B | 0.00537 | `e3c5582e8108e0ce64dceed41429100002db9f66a5294324dc7f000627b97777` |
| Second passphrase registration | 156 B | 0.00984 | `69bc8c9e2ca7ffa76c5c0fbd30fc706de7dd85ac911f6f3dfce14f5baf0b4ae7` |
| Transfer signed with both passphrases | 220 B | 0.0063 | `056dcef401172d23a21293e7e112659e53b072d97c44e021486b0f25a28d4930` |

## Tech stack

- [Tauri 2](https://tauri.app) shell, with a Rust core for keys, AIP-11 serialization, signing and HTTP (`k256`, `bip39`)
- [Svelte 5](https://svelte.dev) + TypeScript + Vite UI
- Data: official ARK Core v3 REST API; prices: CoinGecko public API

## Building

Prerequisites on every platform: [Rust](https://rustup.rs) (stable) and [Node.js](https://nodejs.org) 20+.

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Microsoft C++ Build Tools and WebView2 (already installed on Windows 10/11)
- **Linux** (Debian/Ubuntu):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

Then:

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # installers in src-tauri/target/release/bundle/
```

`tauri build` produces `.app`/`.dmg` on macOS, `.msi`/`.exe` (NSIS) on Windows, and `.deb`/`.rpm`/`.AppImage` on Linux.
Each platform builds its own installers.

Tests for the crypto core:

```bash
cd src-tauri && cargo test
```

`npm run dev` alone opens the UI in a normal browser with a mocked backend (read-only: no signing). This is useful for
UI work.

## License

[MIT](LICENSE)
