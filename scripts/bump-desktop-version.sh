#!/bin/sh
# 一键同步桌面端版本号（desktop-ci-cd-plan §七.3 / §八.1）。
#
# 用法：scripts/bump-desktop-version.sh 0.3.0
#
# 同步两处（tag 校验时比较的正是这两处，见 desktop-release.yml）：
#   1. desktop/src-tauri/tauri.conf.json  —— 顶层 "version"
#   2. desktop/src-tauri/Cargo.toml       —— [package] version
#
# 不做的事（保持手动，见 §八）：
#   - companion/package.json（仅 companion 有改动时才需同步并发 companion-v*）
#   - src/shared/downloads.ts 的 FALLBACK_RELEASE（资产体积要等 CI 构建完才知道）

set -eu

cd "$(dirname "$0")/.."

fail() { printf '✖ %s\n' "$1" >&2; exit 1; }

VERSION="${1:-}"
[ -n "$VERSION" ] || fail "用法：scripts/bump-desktop-version.sh <x.y.z>（例如 0.3.0）"
printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || fail "版本号必须是三段 semver（x.y.z），收到：${VERSION}"

TAG="desktop-v${VERSION}"
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  fail "本地已存在 tag ${TAG}，请换一个版本号。"
fi

TAURI_CONF="desktop/src-tauri/tauri.conf.json"
CARGO_TOML="desktop/src-tauri/Cargo.toml"

OLD_CONF="$(sed -n 's/^  "version": "\([^"]*\)",/\1/p' "$TAURI_CONF")"
OLD_CARGO="$(awk -F'"' '/^\[package\]/{p=1} /^\[/&&!/^\[package\]/{p=0} p&&/^version = /{print $2; exit}' "$CARGO_TOML")"
[ -n "$OLD_CONF" ] || fail "未能在 ${TAURI_CONF} 找到顶层 version 字段。"
[ -n "$OLD_CARGO" ] || fail "未能在 ${CARGO_TOML} 找到 [package] version 字段。"
[ "$OLD_CONF" = "$OLD_CARGO" ] \
  || fail "两处当前版本不一致（tauri.conf.json=${OLD_CONF}，Cargo.toml=${OLD_CARGO}），请先手动对齐。"
[ "$OLD_CONF" != "$VERSION" ] || fail "版本号未变化（当前已是 ${VERSION}）。"

# tauri.conf.json：顶层 version 是唯一两空格缩进的 "version" 键
sed -i '' "s/^  \"version\": \"${OLD_CONF}\"/  \"version\": \"${VERSION}\"/" "$TAURI_CONF"

# Cargo.toml：只改 [package] 段内的 version（[dependencies] 里还有别的 version）
awk -v ver="$VERSION" '
  /^\[package\]/ { in_pkg=1 }
  /^\[/ && !/^\[package\]/ { in_pkg=0 }
  in_pkg && /^version = "/ { sub(/"[^"]*"/, "\"" ver "\"") }
  { print }
' "$CARGO_TOML" > "${CARGO_TOML}.tmp" && mv "${CARGO_TOML}.tmp" "$CARGO_TOML"

# 回读校验
NEW_CONF="$(sed -n 's/^  "version": "\([^"]*\)",/\1/p' "$TAURI_CONF")"
NEW_CARGO="$(awk -F'"' '/^\[package\]/{p=1} /^\[/&&!/^\[package\]/{p=0} p&&/^version = /{print $2; exit}' "$CARGO_TOML")"
[ "$NEW_CONF" = "$VERSION" ] && [ "$NEW_CARGO" = "$VERSION" ] \
  || fail "写入校验失败（tauri.conf.json=${NEW_CONF}，Cargo.toml=${NEW_CARGO}）。"

printf '✔ 版本号已同步：%s → %s\n' "$OLD_CONF" "$VERSION"
printf '\n后续步骤：\n'
printf '  1. 提交合并进 main\n'
printf '  2. git tag %s && git push origin %s\n' "$TAG" "$TAG"
printf '  3. CI 构建完成后手动更新 src/shared/downloads.ts 的 FALLBACK_RELEASE\n'
printf '  4. 检查 https://image.honlnk.com/download 已解析到新版本\n'
