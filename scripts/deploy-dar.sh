#!/bin/bash
set -euo pipefail

# =============================================================================
# Canton Rebalancer — DAR Deployment
# =============================================================================
# Uploads the canton-rebalancer DAR file to a Canton participant node
# via the JSON Ledger API v2.
#
# Usage:
#   ./scripts/deploy-dar.sh                       # default: http://localhost:3975
#   ./scripts/deploy-dar.sh http://localhost:2975  # custom URL
#   ./scripts/deploy-dar.sh http://localhost:3975 /path/to/custom.dar
# =============================================================================

URL="${1:-http://localhost:3975}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DAR_PATH="${2:-$PROJECT_DIR/main/.daml/dist/canton-rebalancer-0.1.0.dar}"

echo "=== Canton Rebalancer — DAR Deployment ==="
echo ""
echo "  Target:  $URL"
echo "  DAR:     $DAR_PATH"
echo ""

# ---------------------------------------------------------------------------
# Validate DAR file
# ---------------------------------------------------------------------------

if [ ! -f "$DAR_PATH" ]; then
  echo "ERROR: DAR file not found at $DAR_PATH"
  echo ""
  echo "  Build it first:"
  echo "    cd main && daml build"
  exit 1
fi

DAR_SIZE=$(wc -c < "$DAR_PATH" | tr -d ' ')
echo "  DAR size: ${DAR_SIZE} bytes"

# ---------------------------------------------------------------------------
# Check that the target is reachable
# ---------------------------------------------------------------------------

echo ""
echo "[1/2] Checking target availability..."

if ! curl -sf "${URL}/livez" >/dev/null 2>&1; then
  echo "ERROR: Ledger API is not reachable at ${URL}/livez"
  echo "  Make sure Canton is running."
  exit 1
fi

echo "  Target is healthy."

# ---------------------------------------------------------------------------
# Build unsigned JWT (Canton sandbox / cn-quickstart dev mode)
# ---------------------------------------------------------------------------

build_jwt() {
  local header
  header=$(printf '{"alg":"none","typ":"JWT"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  local payload
  payload=$(printf '{"sub":"admin","aud":"https://daml.com/jwt/aud/participant/sandbox","scope":"daml_ledger_api","actAs":[],"readAs":[],"applicationId":"canton-rebalancer"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
  echo "${header}.${payload}."
}

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

echo "[2/2] Uploading DAR..."

TOKEN=$(build_jwt)

HTTP_CODE=$(curl -s -o /tmp/dar-upload-response.txt -w "%{http_code}" \
  -X POST "${URL}/v2/packages" \
  -H "Content-Type: application/octet-stream" \
  -H "Authorization: Bearer ${TOKEN}" \
  --data-binary "@${DAR_PATH}")

RESPONSE=$(cat /tmp/dar-upload-response.txt 2>/dev/null || echo "")
rm -f /tmp/dar-upload-response.txt

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "  Upload successful (HTTP $HTTP_CODE)."
elif [ "$HTTP_CODE" -eq 409 ]; then
  echo "  Package already uploaded (HTTP 409 — this is OK)."
else
  echo "ERROR: Upload failed with HTTP $HTTP_CODE."
  if [ -n "$RESPONSE" ]; then
    echo "  Response: $RESPONSE"
  fi
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

echo ""
echo "  Verifying package list..."

PACKAGES=$(curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  "${URL}/v2/packages" 2>/dev/null || echo "")

if [ -n "$PACKAGES" ]; then
  PKG_COUNT=$(echo "$PACKAGES" | grep -o '"packageId"' | wc -l | tr -d ' ')
  echo "  ${PKG_COUNT} package(s) on the participant."
else
  echo "  (Could not retrieve package list — this is non-critical.)"
fi

echo ""
echo "DAR deployment complete."
