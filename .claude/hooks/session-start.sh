#!/bin/bash
# SessionStart hook — prepares a fresh Claude Code container for this repo.
#
# Remote containers are ephemeral: everything outside the git repo is gone on
# the next session. This script rebuilds that state so a new session can run
# the tests and use gstack without any manual step.
#
# Idempotent and non-interactive: safe to re-run, never prompts.
set -uo pipefail

log() { echo "[session-start] $*"; }

# ── 1. Project dependencies ───────────────────────────────────────────────
# `npm install` (not `ci`) so the cached container layer is reused.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
if [ -f package.json ]; then
  log "installing npm dependencies"
  npm install --no-audit --no-fund >/dev/null 2>&1 || log "WARN: npm install failed"
fi

# ── 2. Playwright Chromium ────────────────────────────────────────────────
# The network policy blocks cdn.playwright.dev, so Playwright can never
# download its own browser here. A working Chromium is preinstalled under
# /opt/pw-browsers under a different build number — link it into the layout
# Playwright expects instead of downloading.
# Each Playwright install pins its own Chromium build number, so the repo's
# copy and gstack's copy usually want different ones. Call this per install.
link_chromium() {
  local from="$1"
  local root="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
  [ -d "$root" ] || return 0
  [ -d "$from/node_modules/playwright" ] || return 0

  # Ask Playwright for both paths it expects, e.g.
  #   /opt/pw-browsers/chromium-1208/chrome-linux64/chrome
  #   /opt/pw-browsers/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell
  local want want_shell
  want=$(cd "$from" && node -e 'try{const{chromium}=require("playwright");console.log(chromium.executablePath())}catch(e){}' 2>/dev/null)
  [ -n "$want" ] || return 0
  [ -x "$want" ] && return 0   # already satisfied
  want_shell=$(echo "$want" \
    | sed -E 's#chromium-([0-9]+)#chromium_headless_shell-\1#; s#chrome-linux64/chrome$#chrome-headless-shell-linux64/chrome-headless-shell#')

  local have have_shell
  have=$(ls -d "$root"/chromium-[0-9]* 2>/dev/null | head -1)
  have_shell=$(ls -d "$root"/chromium_headless_shell-[0-9]* 2>/dev/null | head -1)
  [ -n "$have" ] || return 0

  log "linking preinstalled $(basename "$have") into $(basename "${want%/*/*}")"
  mkdir -p "${want%/*/*}"
  ln -sfn "$have/chrome-linux" "${want%/*}"
  touch "${want%/*/*}/INSTALLATION_COMPLETE"

  if [ -n "$have_shell" ]; then
    mkdir -p "${want_shell%/*}"
    ln -sfn "$have_shell/chrome-linux/headless_shell" "$want_shell"
    touch "${want_shell%/*/*}/INSTALLATION_COMPLETE"
  fi
}
link_chromium "$PWD"

# ── 3. gstack ─────────────────────────────────────────────────────────────
# Skills live in ~/.claude/skills, outside the repo, so they vanish with the
# container. Reinstall them here. Best-effort: a gstack failure must never
# block the session, so every step swallows its error.
GSTACK_DIR="$HOME/.claude/skills/gstack"
if command -v bun >/dev/null 2>&1; then
  if [ ! -d "$GSTACK_DIR/.git" ]; then
    log "cloning gstack"
    git clone --single-branch --depth 1 \
      https://github.com/garrytan/gstack.git "$GSTACK_DIR" >/dev/null 2>&1 \
      || log "WARN: gstack clone failed (network policy?)"
  fi
  if [ -d "$GSTACK_DIR" ] && [ ! -x "$GSTACK_DIR/browse/dist/browse" ]; then
    # Install deps first so gstack's own Playwright exists, then link its
    # Chromium build. ./setup aborts on a failed browser launch, and it can
    # never download one here, so the link has to be in place beforehand.
    log "installing gstack dependencies"
    (cd "$GSTACK_DIR" && bun install --frozen-lockfile >/dev/null 2>&1) \
      || log "WARN: bun install failed"
    link_chromium "$GSTACK_DIR"
    log "running gstack setup (first run, takes a few minutes)"
    (cd "$GSTACK_DIR" && ./setup -q >/dev/null 2>&1) || log "WARN: gstack setup incomplete"
  fi
  # Covers the case where gstack is already built but its Chromium link is gone.
  link_chromium "$GSTACK_DIR"
  [ -x "$GSTACK_DIR/browse/dist/browse" ] && log "gstack ready"
else
  log "bun not found — skipping gstack"
fi

# ── 4. graphify ───────────────────────────────────────────────────────────
# Same problem as gstack: the skill lives in ~/.claude/skills and goes away with
# the container. Reinstall it so /graphify works without a manual step.
#
# No CLAUDE_CODE_REMOTE guard needed — the check below finds an existing local
# install and skips, so a laptop that already has graphify is left alone.
#
# The PyPI package is graphifyy (double y) while the graphify name is being
# reclaimed upstream; the CLI and the skill command are both graphify.
install_graphify_cli() {
  pip3 install --quiet graphifyy >/dev/null 2>&1 && return 0
  pip3 install --quiet --break-system-packages graphifyy >/dev/null 2>&1 && return 0
  command -v uv >/dev/null 2>&1 && uv tool install --quiet graphifyy >/dev/null 2>&1 && return 0
  return 1
}

if command -v graphify >/dev/null 2>&1 && [ -f "$HOME/.claude/skills/graphify/SKILL.md" ]; then
  log "graphify ready"
else
  if ! command -v graphify >/dev/null 2>&1; then
    log "installing graphify"
    install_graphify_cli || log "WARN: graphifyy install failed (network policy?)"
  fi
  if command -v graphify >/dev/null 2>&1; then
    # Writes the skill to ~/.claude/skills/graphify/ so /graphify resolves.
    graphify install >/dev/null 2>&1 \
      && log "graphify ready" \
      || log "WARN: graphify skill install failed"
  fi
fi

# ── 5. Session environment ────────────────────────────────────────────────
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export B=\"$GSTACK_DIR/browse/dist/browse\"" >> "$CLAUDE_ENV_FILE"
  echo "export PATH=\"$GSTACK_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

log "done"
exit 0
