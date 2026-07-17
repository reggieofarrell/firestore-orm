#!/usr/bin/env sh
#
# Verify Node.js major version matches .nvmrc (used by Husky hooks).
#
# Intended to be *sourced* from hooks so that `nvm use` updates PATH in the
# same shell that later runs `npm`/`npx`. Executing as a subprocess would check
# the version but would not leave the correct Node on PATH for the rest of the hook.
#
# Husky 9 runs hooks with `sh -e`, so this file stays POSIX sh (no bash-only
# features). Callers should set REPO_ROOT before sourcing; when unset we fall
# back to resolving from $0 (works for both "sourced from .husky/*" and
# "executed as scripts/check-node-version.sh").
#

# Prefer REPO_ROOT from the caller (Husky hooks set this explicitly). Only
# resolve it here when the script is run standalone or the caller omitted it.
if [ -z "${REPO_ROOT:-}" ]; then
  # When sourced from .husky/pre-commit, $0 is the hook path (.husky/...).
  # When executed as ./scripts/check-node-version.sh, $0 is this file.
  # In both cases the repo root is one directory above dirname($0).
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
export REPO_ROOT

echo "Checking Node.js version..."

REQUIRED_NODE_VERSION=""

# Primary pin: .nvmrc (same file CI uses via node-version-file).
if [ -f "$REPO_ROOT/.nvmrc" ]; then
  REQUIRED_NODE_VERSION=$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc" | cut -d'.' -f1)
fi

# Fallback: package.json engines.node when .nvmrc is missing.
if [ -z "$REQUIRED_NODE_VERSION" ] && [ -f "$REPO_ROOT/package.json" ]; then
  NODE_VERSION_STRING=$(grep -A 5 '"engines"' "$REPO_ROOT/package.json" | grep -m 1 '"node"' | sed -E 's/.*"node"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  if [ -n "$NODE_VERSION_STRING" ]; then
    REQUIRED_NODE_VERSION=$(echo "$NODE_VERSION_STRING" | grep -oE '[0-9]+' | head -n 1)
  fi
fi

if [ -z "$REQUIRED_NODE_VERSION" ]; then
  echo "Error: Could not determine required Node.js version from .nvmrc or package.json engines."
  exit 1
fi

# Load nvm in this shell when present so GUI/git clients and non-login shells
# still resolve the repo's Node before npm/npx run. Must be sourced (not
# executed) for the PATH change to persist for the rest of the hook.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  # Prefer the exact .nvmrc pin (works even if cwd is not the repo root — some
  # Git GUIs start elsewhere). Fall back to major-only if the exact string fails.
  # Must stay in this shell (no subshell) so PATH updates persist for npm/npx.
  if command -v nvm >/dev/null 2>&1 || type nvm >/dev/null 2>&1; then
    NVMRC_VERSION=$(tr -d '[:space:]' < "$REPO_ROOT/.nvmrc" 2>/dev/null || true)
    if [ -n "$NVMRC_VERSION" ]; then
      nvm use "$NVMRC_VERSION" >/dev/null 2>&1 || nvm use "$REQUIRED_NODE_VERSION" >/dev/null 2>&1
    else
      nvm use "$REQUIRED_NODE_VERSION" >/dev/null 2>&1
    fi
  fi
fi

# After nvm (or when nvm is absent and the system Node is already correct),
# compare major versions. `node` missing still fails the numeric test below.
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not available on PATH after version setup."
  echo "  Install Node v$REQUIRED_NODE_VERSION.x (see .nvmrc) or ensure nvm is installed."
  exit 1
fi

CURRENT_NODE_VERSION=$(node -v | sed 's/v//' | cut -d'.' -f1)
CURRENT_NODE_FULL=$(node -v)

if [ "$CURRENT_NODE_VERSION" -ne "$REQUIRED_NODE_VERSION" ]; then
  echo "Error: Node.js version mismatch."
  echo "  Required: v$REQUIRED_NODE_VERSION.x"
  echo "  Current:  $CURRENT_NODE_FULL"
  exit 1
fi

echo "✓ Node.js version check passed: $CURRENT_NODE_FULL (required: v$REQUIRED_NODE_VERSION.x)"
