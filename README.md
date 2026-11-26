# ARK Wallet

A lightweight, open-source desktop wallet for the [ARK](https://ark.io) blockchain (ARK Core v3 mainnet and devnet),
for macOS, Windows and Linux.

> **Independent community project.** ARK Wallet is not affiliated with or endorsed by ARK.io / ARK SCIC. The original
> ARK Desktop Wallet was archived in 2023 in favour of the web-based ARKVault; this project is a fresh native take on a
> desktop wallet.

> [!WARNING]
> **Use at your own risk. The author accepts no responsibility for lost funds.**
> This software is provided "as is", without warranty of any kind (see the [MIT license](LICENSE)). The author and
> contributors are not liable for any loss of funds, passphrases or data, failed or mistaken transactions, or any other
> damage resulting from the use of this software, whatever the cause.
>
> Before you trust it with real funds, you are strongly encouraged to **review the code yourself (or have it audited)
> and [build it from source](#building-from-source)** rather than running a binary you did not build. Start with a small
> amount, keep an offline backup of every passphrase, and never share a passphrase with anyone.

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
- **Exchange** (mainnet): swap ARK to **USDC or USDT** on Polygon, Ethereum, Arbitrum, Optimism, BNB Chain or Base
  (USDC only), comparing quotes from several instant exchanges. See [Exchange](#exchange).
- **Payout address book**: named USDC/USDT addresses, each tied to its coin and network, in Settings.
- **Custom API**: every network uses the official ARK API by default (`https://api.ark.io/api`,
  `https://dwallets.ark.io/api`), and you can point it at your own Core v3 node. The node is checked before it is saved.

## Security model

- **Passphrases are never stored.** The app saves only public data (addresses, names, settings) in
  `state.json` in the OS app-data folder.
- You type the passphrase when you sign. It goes to the Rust core, is used once to sign locally, and is then zeroized.
  Only the signed transaction is sent to the node.
- The Rust core checks that the passphrase matches the wallet's address (and that the second passphrase matches the
  wallet's second public key) before signing, and verifies its own signature before returning it.
- **Accidental publication is blocked.** A transaction is not signed when its memo is a valid BIP39 mnemonic or the
  passphrase of the signing wallet, and a message is not signed when it is the passphrase itself. Memos and signed
  messages are public, and memos stay on the blockchain forever.
- **No clipboard for secrets.** New passphrases have no copy button. The clipboard can be read by other apps and synced
  to other devices.
- **No screen capture of secrets.** While a new passphrase or a revealed ("show") passphrase is on screen, the window
  is excluded from screenshots, screen recording and screen sharing (macOS and Windows).
- Passphrase fields turn off autocomplete, autocorrect, spellcheck and writing suggestions. Errors never repeat what
  you typed, and nothing is logged.
- The UI runs under a strict Content Security Policy (no remote or inline scripts, no network access except through
  the Rust core) with frozen JavaScript prototypes. It may only open a fixed list of links (the ARK explorers
  ark.geops.net and ARKScan, the exchanges' order pages and the payout chains' explorers) and write to the clipboard.
- The Exchange's service is reached only through the Rust core, on three fixed paths. Nothing about your wallets or
  passphrases is sent to it: only the amount, coin, network, payout address and refund (your ARK) address of an order.
- Limits: the passphrase passes through the webview as a JavaScript string, which can't be wiped from memory (it is
  dropped as soon as it has been used). Malware already running as your user (a keylogger, or an app with
  Accessibility access) can see what you type in any app. Use the wallet on a machine you trust.
- Signing uses ARK's Schnorr scheme (the same one as ARK's own SDKs); message signing uses ECDSA. The serializer and
  signature code are tested against real mainnet transactions of every supported type (see
  `src-tauri/tests/fixtures`).

## Exchange

The **Exchange** tab (mainnet wallets only) swaps ARK to USDC or USDT without an exchange account:

1. **Pick a payout address.** Choose one from your payout address book (**Settings → Payout addresses**: a name, a
   coin·network and a `0x` address), or enter a one-off address with its coin and network. Addresses are checked
   with their EIP-55 checksum, and all-lowercase ones get a warning because they can't be checked.
2. **Get quotes.** Enter an amount (or **Max**: balance minus the transfer fee). The wallet asks the exchange
   aggregators [Flashift](https://flashift.app) and [Trocador](https://trocador.app) for quotes and lists the best
   offers from the instant exchanges behind them (ChangeNOW, Changelly, SimpleSwap, StealthEX and others), ranked by
   what you receive, next to the market value.
3. **Create the order.** The exchange you pick returns an ARK deposit address. Before anything is signed, the wallet
   checks that the order pays out to **your** address, in the coin and on the network you chose, for the amount you
   entered, within 3% of the quote, that the deposit address is a valid ARK address that isn't one of your own, and
   that no deposit memo is required. Any mismatch blocks the order.
4. **Confirm the transfer.** Nothing is sent until you confirm: you see the deposit address, amount and fee, then type
   your passphrase, and the ARK transfer is signed locally like any other. Your wallet's own address is the refund
   address.
5. **Follow it.** The order card and the history link to the exchange's own order page and to your payout address on
   the chain's explorer (Polygonscan, Etherscan, …), where the coins arriving can be seen directly.

**How it connects.** The aggregator APIs need API keys, which can't be kept secret inside a public app. The app
therefore talks to a small hosted service, `https://xc.geops.net`, which holds the keys and only **quotes and creates
orders**: it never sees a passphrase, can't move funds, and keeps no logs of IPs or orders. It is open to any client
and protects the keys with rate limits (10 requests a minute per IP, 15 a minute per aggregator), so quotes may
briefly show a cooldown. The exchange itself (rates, fees, KYC policy, delivery) is entirely the chosen exchange's
service, not this project's.

**Using your own service.** To use a different one, build with its URL:

```bash
EXCHANGE_WORKER_URL=https://your-service.example npm run tauri build
```

It must use `https` (plain `http` is accepted only for `localhost`) and answer `POST /health`, `/quote` and `/order`
with the same JSON the app's [`src/lib/drain.ts`](src/lib/drain.ts) expects. The app checks every order it gets back
as described above, whichever service created it.

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

## API behaviour

All data comes from the public ARK API (`api.ark.io`, or a node URL you set per network). It was
load-tested to tune how the wallet talks to it (November 2026):

| What | Measured | How the wallet handles it |
|---|---|---|
| Rate limit | 200 requests / 60 s per IP (devnet 100); a `429` carries `Retry-After` | The host goes on cooldown for that long. Waits up to 3 s are absorbed silently; longer ones show "Retrying in Ns…" and reload by themselves |
| Normal latency | 0.1–0.9 s typical, up to ~3.3 s for heavy queries | 5 s connect timeout, 10 s total per request |
| Server overload | `500` after ~3.2 s (the server's own query timeout) | User actions retry twice (after 0.3 s and 1 s); network errors retry after 0.5 s and 1.5 s |
| Deep transaction pages | newest-first queries more than ~20k rows deep usually fail with `500`; oldest-first succeeds at any depth in 1–2.5 s | Pages deeper than 20k rows are read oldest-first and reversed; newest-first is the fallback |
| Counterparty names | one `/wallets/{address}` lookup per row would cost up to 100 requests per page | The delegate directory (~14 requests) is loaded once and refreshed every 30 min |
| New blocks | `/blockchain` ~0.13 s; `/blocks?height.from&height.to` ~0.17 s; "latest blocks" queries ~3 s with frequent `500`s | The watcher polls the tip every 8 s and fetches only the new height range |

Background work (the block watcher and periodic refresh) makes a single attempt and never
retries: the next poll catches up, and it doesn't compete with what you are looking at. A failed
background refresh keeps the last good balance on screen instead of showing an error.

## Tech stack

- [Tauri 2](https://tauri.app) shell, with a Rust core for keys, AIP-11 serialization, signing and HTTP (`k256`, `bip39`)
- [Svelte 5](https://svelte.dev) + TypeScript + Vite UI
- Data: official ARK Core v3 REST API; prices: CoinGecko public API; exchange quotes and orders: Flashift and
  Trocador through the hosted exchange service

## Downloads

Every build is made by [GitHub Actions](.github/workflows/build.yml) from the tagged source, for x64 and arm64:

| OS | Files |
|---|---|
| macOS | `macos-arm64.dmg` (Apple Silicon), `macos-x64.dmg` (Intel) |
| Windows | `windows-x64.msi` / `windows-x64-setup.exe`, `windows-arm64-setup.exe` |
| Linux | `.deb`, `.rpm` and `.AppImage` for `linux-x64` and `linux-arm64` |

Check your download against `SHA256SUMS` in the release.

The builds are **not signed with a developer certificate**: macOS builds are ad-hoc signed, Windows and Linux builds
are unsigned. Your OS will warn the first time:

- **macOS:** "Apple could not verify…". Open System Settings → Privacy & Security and click **Open Anyway**, or run
  `xattr -dr com.apple.quarantine "/Applications/ARK Wallet.app"`.
- **Windows:** SmartScreen "Windows protected your PC". Click **More info → Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x`), or install the `.deb` / `.rpm`.

If you'd rather not trust a binary, build it yourself (below).

## Building from source

Building it yourself is the recommended way to run ARK Wallet: you know exactly which code you are running.
Supported platforms are **macOS**, **Windows**, and **Linux** (Debian/Ubuntu-based and Red Hat/Fedora-based).

Every platform needs:

- [Git](https://git-scm.com)
- [Rust](https://rustup.rs) (stable toolchain, installed with `rustup`)
- [Node.js](https://nodejs.org) 20 or newer (LTS recommended), which includes `npm`

plus the platform-specific system packages below. Then follow [Build](#build) (the same on every OS).

### macOS (12 Monterey or newer, Apple Silicon or Intel)

```bash
xcode-select --install                                           # Apple's command line tools (compiler, git)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
brew install node                                                # Node.js (or use the installer from nodejs.org)
```

The build produces `ARK Wallet.app` and a `.dmg` in `src-tauri/target/release/bundle/macos/` and `.../bundle/dmg/`.
A self-built app is not notarized; it runs on the machine that built it. If you copy it to another Mac, Gatekeeper
may ask you to allow it in System Settings → Privacy & Security.

### Windows (10 or 11, x64)

1. Install **Microsoft C++ Build Tools**: run the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   installer and select the **"Desktop development with C++"** workload.
2. **WebView2** is already part of Windows 10 (21H2+) and 11. On older systems install the
   [Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/).
3. Install Git, Rust and Node.js, for example with `winget` in PowerShell:

   ```powershell
   winget install --id Git.Git
   winget install --id Rustlang.Rustup
   winget install --id OpenJS.NodeJS.LTS
   ```

   Open a new terminal afterwards and make sure the MSVC toolchain is the default:

   ```powershell
   rustup default stable-msvc
   ```

The build produces an `.msi` installer in `src-tauri\target\release\bundle\msi\` and an NSIS `-setup.exe` in
`src-tauri\target\release\bundle\nsis\`.

### Linux: Debian / Ubuntu / Linux Mint / Pop!_OS (Debian 12+, Ubuntu 22.04+)

```bash
sudo apt update
sudo apt install -y build-essential curl wget file git pkg-config \
  libwebkit2gtk-4.1-dev libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
```

Install Node.js 20+ from [nodejs.org](https://nodejs.org/en/download) or your preferred version manager (the `nodejs`
package in older distro releases is too old).

Build only the Debian package and AppImage with `npm run tauri build -- --bundles deb,appimage`; install the result
with `sudo apt install ./src-tauri/target/release/bundle/deb/*.deb`.

### Linux: Fedora / RHEL / Rocky / AlmaLinux (Fedora 38+, RHEL 9+)

```bash
sudo dnf check-update
sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file git \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install -y "c-development"     # Fedora 41+; on older Fedora / RHEL: "Development Tools"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
sudo dnf install -y nodejs                    # Fedora; on RHEL use: sudo dnf module install -y nodejs:20
```

On RHEL, Rocky and AlmaLinux, enable the **CRB** repository and **EPEL** first, because some of the development
packages (for example `libxdo-devel`, `libappindicator-gtk3-devel`) live there:

```bash
sudo dnf config-manager --set-enabled crb
sudo dnf install -y epel-release
```

Build only the RPM with `npm run tauri build -- --bundles rpm`; install it with
`sudo dnf install ./src-tauri/target/release/bundle/rpm/*.rpm`.

### Build

```bash
git clone https://github.com/geopsllc/ark-wallet.git
cd ark-wallet
npm ci                  # exact dependency versions from package-lock.json
npm run tauri build     # release build + installers in src-tauri/target/release/bundle/
```

Optional checks before you build:

```bash
cd src-tauri && cargo test    # crypto, serialization and fee tests (against real mainnet transactions)
cd .. && npm run check        # TypeScript / Svelte type check
```

`npm run tauri dev` runs the app in development mode with hot reload. `npm run dev` alone opens the UI in a normal
browser with a mocked, read-only backend (no signing), which is handy for UI work.

Each platform builds its own installers; cross-compiling between operating systems is not supported.

### Signed local macOS builds

`tools/build-mac.sh` builds an Apple Silicon `.dmg` signed with your own certificate from the keychain
(`--install` also installs it). The certificate is looked up at run time and never stored
in the repo.

## License

[MIT](LICENSE)
