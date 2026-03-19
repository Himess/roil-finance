#!/bin/bash
set -euo pipefail

# =============================================================================
# Canton Rebalancer — Stop LocalNet
# =============================================================================
# Stops the Canton LocalNet Docker Compose stack and optionally removes
# volumes (for a clean restart).
#
# Usage:
#   ./scripts/stop-localnet.sh          # stop containers, keep data
#   ./scripts/stop-localnet.sh --clean  # stop containers and remove volumes
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CN_QUICKSTART_DIR="$PROJECT_DIR/.cn-quickstart"

echo "=== Canton Rebalancer — Stopping LocalNet ==="
echo ""

# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------

if [ ! -d "$CN_QUICKSTART_DIR" ]; then
  echo "cn-quickstart directory not found at $CN_QUICKSTART_DIR"
  echo "Nothing to stop."
  exit 0
fi

cd "$CN_QUICKSTART_DIR"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --clean|--reset|--purge)
      CLEAN=true
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------

OVERRIDE_ARGS=""
if [ -f "$PROJECT_DIR/docker-compose.override.yml" ]; then
  OVERRIDE_ARGS="-f $PROJECT_DIR/docker-compose.override.yml"
fi

if [ "$CLEAN" = true ]; then
  echo "Stopping containers and removing volumes..."
  docker compose -f docker-compose.yml $OVERRIDE_ARGS down -v --remove-orphans
  echo ""
  echo "All containers stopped and volumes removed."
  echo "Run ./scripts/setup-localnet.sh to start fresh."
else
  echo "Stopping containers (preserving volumes)..."
  docker compose -f docker-compose.yml $OVERRIDE_ARGS down --remove-orphans
  echo ""
  echo "All containers stopped. Data volumes preserved."
  echo "Run 'docker compose up -d' in .cn-quickstart/ to restart."
  echo "Or run './scripts/stop-localnet.sh --clean' to remove volumes too."
fi

echo ""
echo "Done."
