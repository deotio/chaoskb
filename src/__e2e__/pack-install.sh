#!/usr/bin/env bash
#
# E2E test: Pack & install simulation (T8)
#
# Simulates what a real user experiences after `npm install -g @de-otio/chaoskb-client`.
# Runs on POSIX (Linux/macOS).
#
# Exit 0 = pass, exit 1 = fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR=""
PASSED=0
FAILED=0

pass() {
  echo "  PASS: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  FAIL: $1"
  FAILED=$((FAILED + 1))
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

echo ""
echo "=== Pack & Install ==="

# 1. npm pack
cd "$SRC_DIR"
TARBALL=$(npm pack --pack-destination /tmp 2>/dev/null | tail -1)
TARBALL_PATH="/tmp/$TARBALL"

if [ -f "$TARBALL_PATH" ]; then
  pass "npm pack produced $TARBALL"
else
  fail "npm pack did not produce a tarball"
  echo ""
  echo "=== Results: $PASSED passed, $FAILED failed ==="
  exit 1
fi

# 2. Install in temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"
npm init -y --silent >/dev/null 2>&1
npm install "$TARBALL_PATH" --silent 2>/dev/null

if [ -f "$TEMP_DIR/node_modules/.bin/chaoskb-mcp" ]; then
  pass "chaoskb-mcp binary installed in node_modules/.bin"
else
  fail "chaoskb-mcp binary not found in node_modules/.bin"
fi

# 3. Run --help (use `script` to fake a TTY — the CLI auto-enters MCP mode when stdin is piped)
ENTRY_JS="$TEMP_DIR/node_modules/@de-otio/chaoskb-client/dist/cli/index.js"
if command -v script >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    # macOS script syntax
    HELP_OUTPUT=$(script -q /dev/null node "$ENTRY_JS" --help 2>&1 || true)
  else
    # Linux script syntax
    HELP_OUTPUT=$(script -qc "node '$ENTRY_JS' --help" /dev/null 2>&1 || true)
  fi
else
  HELP_OUTPUT=$(node "$ENTRY_JS" --help </dev/null 2>&1 || true)
fi
if echo "$HELP_OUTPUT" | grep -qi "usage\|chaoskb\|commands\|options"; then
  pass "--help prints usage information"
else
  fail "--help did not print recognizable usage info"
  echo "  Output: $(echo "$HELP_OUTPUT" | head -5)"
fi

# 4. Run --version
if command -v script >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    VERSION_OUTPUT=$(script -q /dev/null node "$ENTRY_JS" --version 2>&1 || true)
  else
    VERSION_OUTPUT=$(script -qc "node '$ENTRY_JS' --version" /dev/null 2>&1 || true)
  fi
else
  VERSION_OUTPUT=$(node "$ENTRY_JS" --version </dev/null 2>&1 || true)
fi
EXPECTED_VERSION=$(node -e "console.log(require('$SRC_DIR/package.json').version)")

if echo "$VERSION_OUTPUT" | grep -q "$EXPECTED_VERSION"; then
  pass "--version prints $EXPECTED_VERSION"
else
  fail "--version output '$(echo "$VERSION_OUTPUT" | tr -d '[:cntrl:]')' does not contain expected '$EXPECTED_VERSION'"
fi

# 5. Verify shebang
ENTRY="$TEMP_DIR/node_modules/@de-otio/chaoskb-client/dist/cli/index.js"
if [ -f "$ENTRY" ]; then
  FIRST_LINE=$(head -1 "$ENTRY")
  if [ "$FIRST_LINE" = "#!/usr/bin/env node" ]; then
    pass "shebang line is correct"
  else
    fail "shebang line is '$FIRST_LINE', expected '#!/usr/bin/env node'"
  fi
else
  fail "dist/cli/index.js not found in installed package"
fi

# 6. Verify registry.json is included
REGISTRY="$TEMP_DIR/node_modules/@de-otio/chaoskb-client/dist/cli/agent-registry/registry.json"
if [ -f "$REGISTRY" ]; then
  pass "registry.json included in package"
else
  fail "registry.json not found in installed package"
fi

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="
[ "$FAILED" -eq 0 ] || exit 1
