#!/usr/bin/env bash
# Local macOS builds, Apple Silicon and Intel as separate .dmg files, signed with YOUR certificate
# from the login keychain. The identity is looked up at run time (prefers "Developer ID
# Application", else the first valid code-signing identity) or taken from APPLE_SIGNING_IDENTITY;
# it is never written to the repo. Public builds come from GitHub Actions and are ad-hoc signed.
#
#   tools/build-mac.sh            build both, output in build/
#   tools/build-mac.sh --install  also install the build for this Mac into /Applications
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  ids=$(security find-identity -v -p codesigning)
  APPLE_SIGNING_IDENTITY=$(printf '%s\n' "$ids" | awk -F'"' '/Developer ID Application/ {print $2; exit}')
  [ -n "$APPLE_SIGNING_IDENTITY" ] || APPLE_SIGNING_IDENTITY=$(printf '%s\n' "$ids" | awk -F'"' 'NF > 1 {print $2; exit}')
fi
[ -n "$APPLE_SIGNING_IDENTITY" ] || { echo "No code-signing identity found in the keychain"; exit 1; }
export APPLE_SIGNING_IDENTITY
echo "Signing with keychain identity: ${APPLE_SIGNING_IDENTITY%%:*}"

version=$(node -p 'require("./src-tauri/tauri.conf.json").version')
mkdir -p build
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  case $target in aarch64-*) arch=arm64 ;; *) arch=x64 ;; esac
  rustup target add "$target" >/dev/null
  npx tauri build --target "$target" --bundles app,dmg
  b="src-tauri/target/$target/release/bundle"
  codesign --verify --deep --strict "$b/macos/ARK Wallet.app"
  cp "$b"/dmg/*.dmg "build/ARK-Wallet_${version}_macos-${arch}.dmg"
  rm -rf "build/ARK Wallet ($arch).app"
  ditto "$b/macos/ARK Wallet.app" "build/ARK Wallet ($arch).app"
done

if [ "${1:-}" = "--install" ]; then
  case $(uname -m) in arm64) arch=arm64 ;; *) arch=x64 ;; esac
  osascript -e 'tell application "ARK Wallet" to quit' 2>/dev/null || true
  sleep 1
  rm -rf "/Applications/ARK Wallet.app"
  ditto "build/ARK Wallet ($arch).app" "/Applications/ARK Wallet.app"
  echo "Installed the $arch build in /Applications"
fi
ls -la build
