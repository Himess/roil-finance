#!/bin/bash
set -euo pipefail

# =============================================================================
# Canton Rebalancer — LocalNet Setup
# =============================================================================
# Downloads cn-quickstart, starts Canton LocalNet via Docker Compose,
# waits for services to become healthy, builds and uploads the DAR,
# allocates parties, and prints connection information.
# =============================================================================

echo "=== Canton Rebalancer — LocalNet Setup ==="
echo ""

# ---------------------------------------------------------------------------
# 0. Prerequisites
# ---------------------------------------------------------------------------

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 is required but not installed."
    echo "  $2"
    exit 1
  fi
}

check_cmd docker   "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
check_cmd java     "Install Java 17+: https://adoptium.net"
check_cmd node     "Install Node.js 20+: https://nodejs.org"
check_cmd git      "Install Git: https://git-scm.com"

# Verify Java version >= 17
JAVA_VER=$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')
if [ "$JAVA_VER" -lt 17 ] 2>/dev/null; then
  echo "WARNING: Java 17+ recommended (detected version $JAVA_VER)."
fi

# Verify Docker daemon is running
if ! docker info &>/dev/null; then
  echo "ERROR: Docker daemon is not running. Start Docker Desktop first."
  exit 1
fi

# Locale fix for Turkish Windows (Java's Locale.toUpperCase bug)
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Duser.language=en -Duser.country=US"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CN_QUICKSTART_DIR="$PROJECT_DIR/.cn-quickstart"
MAIN_DIR="$PROJECT_DIR/main"
DAR_PATH="$MAIN_DIR/.daml/dist/canton-rebalancer-0.1.0.dar"

echo "Project root:  $PROJECT_DIR"
echo "cn-quickstart: $CN_QUICKSTART_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. Clone cn-quickstart
# ---------------------------------------------------------------------------

if [ ! -d "$CN_QUICKSTART_DIR" ]; then
  echo "[1/6] Cloning cn-quickstart..."
  git clone --depth 1 https://github.com/digital-asset/cn-quickstart "$CN_QUICKSTART_DIR"
else
  echo "[1/6] cn-quickstart already present — skipping clone."
fi

# ---------------------------------------------------------------------------
# 2. Build Daml contracts
# ---------------------------------------------------------------------------

echo "[2/6] Building Daml contracts..."
cd "$MAIN_DIR"

if command -v dpm &>/dev/null; then
  dpm build
elif command -v daml &>/dev/null; then
  daml build
else
  echo "WARNING: Neither dpm nor daml found on PATH."
  if [ -f "$DAR_PATH" ]; then
    echo "  Using existing DAR at $DAR_PATH"
  else
    echo "ERROR: No DAR found and no Daml SDK available to build."
    echo "  Install the Daml SDK: https://docs.daml.com/getting-started/installation.html"
    exit 1
  fi
fi

if [ ! -f "$DAR_PATH" ]; then
  echo "ERROR: DAR file not found at $DAR_PATH after build."
  exit 1
fi

echo "  DAR ready: $DAR_PATH"

# ---------------------------------------------------------------------------
# 3. Start Canton LocalNet
# ---------------------------------------------------------------------------

echo "[3/6] Starting Canton LocalNet..."
cd "$CN_QUICKSTART_DIR"

# Apply override if present at project root
OVERRIDE_ARGS=""
if [ -f "$PROJECT_DIR/docker-compose.override.yml" ]; then
  OVERRIDE_ARGS="-f $PROJECT_DIR/docker-compose.override.yml"
fi

docker compose -f docker-compose.yml $OVERRIDE_ARGS up -d

# ---------------------------------------------------------------------------
# 4. Wait for services to become healthy
# ---------------------------------------------------------------------------

echo "[4/6] Waiting for Canton services to become healthy..."

# JSON API URLs to probe
APP_PROVIDER_URL="http://localhost:3975"
APP_USER_URL="http://localhost:2975"

wait_for_url() {
  local url="$1"
  local name="$2"
  local max_attempts=60
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if curl -sf "${url}/livez" >/dev/null 2>&1; then
      echo "  $name is healthy."
      return 0
    fi
    attempt=$((attempt + 1))
    if [ $((attempt % 10)) -eq 0 ]; then
      echo "  Still waiting for $name... (${attempt}s)"
    fi
    sleep 1
  done

  echo "ERROR: $name did not become healthy within ${max_attempts}s."
  echo "  Check logs: docker compose -f $CN_QUICKSTART_DIR/docker-compose.yml logs"
  exit 1
}

wait_for_url "$APP_PROVIDER_URL" "JSON API (App Provider)"
wait_for_url "$APP_USER_URL"     "JSON API (App User)"

echo "  All services healthy."

# ---------------------------------------------------------------------------
# 5. Upload DAR
# ---------------------------------------------------------------------------

echo "[5/6] Uploading DAR to participant nodes..."

upload_dar() {
  local url="$1"
  local name="$2"

  # Build an unsigned JWT for the upload (Canton sandbox accepts alg:none)
  local header
  header=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  local payload
  payload=$(printf '{"sub":"admin","aud":"https://daml.com/jwt/aud/participant/sandbox","scope":"daml_ledger_api","actAs":[],"readAs":[],"applicationId":"canton-rebalancer"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  local token="${header}.${payload}."

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${url}/v2/packages" \
    -H "Content-Type: application/octet-stream" \
    -H "Authorization: Bearer ${token}" \
    --data-binary "@${DAR_PATH}")

  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "  DAR uploaded to $name (HTTP $status)."
  else
    echo "WARNING: DAR upload to $name returned HTTP $status."
    echo "  This may be OK if the package was already uploaded."
  fi
}

upload_dar "$APP_PROVIDER_URL" "App Provider"
upload_dar "$APP_USER_URL"     "App User"

# ---------------------------------------------------------------------------
# 6. Allocate parties
# ---------------------------------------------------------------------------

echo "[6/6] Allocating parties..."

allocate_party() {
  local url="$1"
  local hint="$2"
  local display="$3"

  local header
  header=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  local payload
  payload=$(printf '{"sub":"admin","aud":"https://daml.com/jwt/aud/participant/sandbox","scope":"daml_ledger_api","actAs":[],"readAs":[],"applicationId":"canton-rebalancer"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  local token="${header}.${payload}."

  local result
  result=$(curl -sf -X POST "${url}/v2/parties" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" \
    -d "{\"partyIdHint\":\"${hint}\",\"displayName\":\"${display}\"}" 2>/dev/null) || true

  if [ -n "$result" ]; then
    local party
    party=$(echo "$result" | grep -o '"party":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$party" ]; then
      echo "  $display => $party"
      return 0
    fi
  fi

  echo "  $display => (may already exist or allocation skipped)"
}

allocate_party "$APP_PROVIDER_URL" "platform"  "Platform"
allocate_party "$APP_PROVIDER_URL" "alice"     "Alice"
allocate_party "$APP_PROVIDER_URL" "bob"       "Bob"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo "============================================"
echo " Canton LocalNet is running!"
echo "============================================"
echo ""
echo " JSON API (App Provider):  $APP_PROVIDER_URL"
echo " JSON API (App User):      $APP_USER_URL"
echo " Wallet UI:                http://localhost:2000"
echo " Scan UI:                  http://localhost:4000"
echo ""
echo " DAR uploaded:  canton-rebalancer-0.1.0.dar"
echo " Parties:       Platform, Alice, Bob"
echo ""
echo " Next steps:"
echo "   1. Initialize ledger:  cd backend && npx tsx ../scripts/init-ledger.ts"
echo "   2. Start backend:      cd backend && npm run dev"
echo "   3. Start frontend:     cd ui && npm run dev"
echo ""
echo " To stop:  ./scripts/stop-localnet.sh"
echo "============================================"
