#!/bin/sh
# GPT Image Studio 桌面端安装脚本（macOS）
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/honlnk/gpt-image-studio/main/scripts/install-desktop.sh | sh
#   curl -fsSL ... | sh -s 0.2.1        # 安装指定版本（默认最新）
#
# 原理：命令行 curl 下载的文件不带 com.apple.quarantine 隔离属性，
# Gatekeeper 不检查 → 未签名 app 全程零警告安装（免签名分发方案 §3.1）。
#
# 资产命名契约（desktop-release.yml / desktop-ci-cd-plan §六）：
#   GPT-Image-Studio_<version>_aarch64.dmg

set -eu

REPO="honlnk/gpt-image-studio"
APP_NAME="GPT Image Studio"
APP_DIR="/Applications"
API_URL="https://api.github.com/repos/${REPO}/releases?per_page=20"
TAG_PREFIX="desktop-v"

# --- 输出辅助（管道到 sh 时也可能没有 tty，颜色用前先判断） ---
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  DIM="$(printf '\033[2m')"
  RESET="$(printf '\033[0m')"
else
  BOLD="" RED="" GREEN="" DIM="" RESET=""
fi

info() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
ok() { printf '%s✔%s %s\n' "$GREEN" "$RESET" "$1"; }
fail() { printf '%s✖ 安装失败：%s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

# --- 临时目录与清理 ---
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t gpt-image-studio)"
MOUNT_DIR="${TMP_DIR}/dmg-mount"
DMG_PATH=""
MOUNTED=0

cleanup() {
  if [ "$MOUNTED" -eq 1 ]; then
    hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# --- 0. 平台检查 ---
[ "$(uname -s)" = "Darwin" ] || fail "本脚本仅支持 macOS；Windows / Linux 请从 https://image.honlnk.com/download 下载安装包。"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ASSET_SUFFIX="aarch64.dmg" ;;
  x86_64) fail "暂只提供 Apple Silicon（arm64）安装包，Intel Mac 版本尚未发布。可关注 https://github.com/${REPO}/releases" ;;
  *) fail "无法识别的 CPU 架构：${ARCH}" ;;
esac

# --- 1. 解析版本（默认最新 desktop-v* release） ---
# 注意：桌面版以 prerelease 发布，/releases/latest 端点取不到，必须用列表 API
# （匿名访问本就看不到 draft，无需额外过滤）。
REQUESTED_VERSION="${1:-}"
if [ -n "$REQUESTED_VERSION" ]; then
  TAG="${REQUESTED_VERSION#${TAG_PREFIX}}"
  TAG="${TAG_PREFIX}${TAG}"
else
  info "查询最新版本…"
  RELEASES_JSON="$(curl -fsSL "$API_URL")" || fail "无法访问 GitHub Releases API（网络问题或触发限流），可稍后重试或手动下载：https://github.com/${REPO}/releases"
  TAG="$(printf '%s' "$RELEASES_JSON" \
    | grep -o "\"tag_name\":[[:space:]]*\"${TAG_PREFIX}[^\"]*\"" \
    | head -n 1 \
    | sed "s/.*\"\(${TAG_PREFIX}[^\"]*\)\"/\1/")"
  [ -n "$TAG" ] || fail "未找到任何桌面版 release（${TAG_PREFIX}*）。"
fi
VERSION="${TAG#${TAG_PREFIX}}"
info "目标版本：${BOLD}${VERSION}${RESET}（${TAG}）"

# --- 2. 下载 DMG ---
ASSET_NAME="GPT-Image-Studio_${VERSION}_${ASSET_SUFFIX}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"
DMG_PATH="${TMP_DIR}/${ASSET_NAME}"

info "下载 ${ASSET_NAME}…"
printf '%s     %s%s\n' "$DIM" "$DOWNLOAD_URL" "$RESET"
curl -fSL --retry 2 -o "$DMG_PATH" "$DOWNLOAD_URL" \
  || fail "下载失败（版本号可能不存在或网络中断）：${DOWNLOAD_URL}"
[ -s "$DMG_PATH" ] || fail "下载产物为空文件。"

# --- 3. 挂载 DMG 并复制 .app ---
mkdir -p "$MOUNT_DIR"
info "挂载 DMG…"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_DIR" "$DMG_PATH" >/dev/null \
  || fail "hdiutil 挂载失败（DMG 可能损坏，请重试）。"
MOUNTED=1

SOURCE_APP="${MOUNT_DIR}/${APP_NAME}.app"
[ -d "$SOURCE_APP" ] || fail "DMG 内未找到 ${APP_NAME}.app（包结构异常）。"

TARGET_APP="${APP_DIR}/${APP_NAME}.app"

# /Applications 不可写时（非管理员账户）用 sudo 完成替换
SUDO=""
if [ ! -w "$APP_DIR" ]; then
  command -v sudo >/dev/null 2>&1 || fail "${APP_DIR} 不可写且 sudo 不可用，请手动安装。"
  SUDO="sudo"
  info "${APP_DIR} 需要管理员权限，可能提示输入密码。"
fi

# 已在运行则先退出（忽略失败——没运行时 pkill 返回 1）。
# 用 pkill 而非 osascript：后者会把没在运行的 app 拉起来再退，且需自动化权限。
pkill -f "${APP_DIR}/${APP_NAME}.app/Contents/MacOS" 2>/dev/null || true

if [ -d "$TARGET_APP" ]; then
  info "移除旧版本…"
  $SUDO rm -rf "$TARGET_APP" || fail "无法删除旧版本 ${TARGET_APP}（可手动删除后重试）。"
fi

info "安装到 ${APP_DIR}…"
$SUDO cp -R "$SOURCE_APP" "$TARGET_APP" || fail "复制 ${APP_NAME}.app 到 ${APP_DIR} 失败。"

hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
MOUNTED=0

# --- 4. 防御性清除隔离属性（curl 下载本不带标记，防用户环境链路写入） ---
$SUDO xattr -cr "$TARGET_APP" 2>/dev/null || true

# --- 5. 完成 ---
[ -d "$TARGET_APP" ] || fail "安装后未找到 ${TARGET_APP}。"
printf '\n'
ok "${BOLD}${APP_NAME} ${VERSION}${RESET}${GREEN} 安装完成${RESET}"
printf '    启动方式：启动台搜索「%s」，或终端执行：\n' "$APP_NAME"
printf '    %sopen -a "%s"%s\n' "$BOLD" "$APP_NAME" "$RESET"
printf '\n'
printf '%s提示：应用内嵌 Companion 服务，首次启动稍慢属正常现象。%s\n' "$DIM" "$RESET"
