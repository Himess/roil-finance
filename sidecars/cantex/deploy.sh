#!/usr/bin/env bash
# Deploy the Cantex sidecar to a remote VPS over SSH.
#
# Usage: ./deploy.sh user@host
#
# Idempotent — re-running upgrades the code, refreshes the venv, and
# restarts the systemd unit. Does NOT touch /opt/roil-cantex-sidecar/.env
# so secrets you set manually survive the deploy.
set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "usage: $0 user@host" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
echo "[deploy] target=$TARGET source=$HERE"

# 1. Ensure system dependencies + service user on the remote.
ssh "$TARGET" bash -s <<'BOOTSTRAP'
set -euo pipefail
if ! id roil >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin roil
fi
mkdir -p /opt/roil-cantex-sidecar
chown roil:roil /opt/roil-cantex-sidecar

# Pin to Python 3.11+ — cantex_sdk requires it.
if ! command -v python3.11 >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3 python3-venv python3-pip
fi
BOOTSTRAP

# 2. Copy code (rsync would be nicer; scp keeps the prereqs minimal).
# cantex_sdk is not on PyPI yet, so we ship its source tree alongside the
# sidecar code and pip-install from it on the remote.
CANTEX_SDK_DIR="${CANTEX_SDK_DIR:-$HOME/AppData/Local/Temp/cantex_sdk}"
if [[ ! -f "$CANTEX_SDK_DIR/pyproject.toml" ]]; then
  echo "[deploy] error: cantex_sdk source not found at $CANTEX_SDK_DIR" >&2
  echo "Set CANTEX_SDK_DIR to override." >&2
  exit 3
fi

ssh "$TARGET" "rm -rf /tmp/cantex_sdk && mkdir -p /tmp/cantex_sdk"
scp -q -r "$CANTEX_SDK_DIR"/* "$TARGET":/tmp/cantex_sdk/
scp -q "$HERE/app.py" "$HERE/pyproject.toml" "$HERE/README.md" \
    "$HERE/roil-cantex-sidecar.service" \
    "$TARGET":/tmp/

# Seed .env from .env.example only if no .env exists yet — we never
# overwrite an .env that the operator has filled in.
ssh "$TARGET" bash -s <<'INSTALL'
set -euo pipefail
TARGET_DIR=/opt/roil-cantex-sidecar
install -o roil -g roil -m 0644 /tmp/app.py "$TARGET_DIR/app.py"
install -o roil -g roil -m 0644 /tmp/pyproject.toml "$TARGET_DIR/pyproject.toml"
install -o roil -g roil -m 0644 /tmp/README.md "$TARGET_DIR/README.md"
install -o root -g root -m 0644 /tmp/roil-cantex-sidecar.service \
    /etc/systemd/system/roil-cantex-sidecar.service

# Venv (only created if missing).
PY=$(command -v python3.11 || command -v python3)
if [[ ! -x "$TARGET_DIR/venv/bin/python" ]]; then
  sudo -u roil "$PY" -m venv "$TARGET_DIR/venv"
fi
# Always refresh deps — pin file is pyproject.toml.
sudo -u roil "$TARGET_DIR/venv/bin/pip" install --upgrade pip
sudo -u roil "$TARGET_DIR/venv/bin/pip" install /tmp/cantex_sdk
sudo -u roil "$TARGET_DIR/venv/bin/pip" install "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9"

# .env: only seed if missing. We never clobber a populated env.
if [[ ! -f "$TARGET_DIR/.env" ]]; then
  cat > "$TARGET_DIR/.env" <<'ENV'
CANTEX_BASE_URL=https://api.cantex.io
CANTEX_OPERATOR_KEY=
CANTEX_TRADING_KEY=
SIDECAR_HOST=127.0.0.1
SIDECAR_PORT=6200
SIDECAR_AUTH_TOKEN=
CANTEX_API_KEY_PATH=/opt/roil-cantex-sidecar/api_key.txt
ENV
  chown roil:roil "$TARGET_DIR/.env"
  chmod 600 "$TARGET_DIR/.env"
  echo "Seeded $TARGET_DIR/.env — fill in keys before starting."
fi

systemctl daemon-reload
echo
echo "Installed. Next:"
echo "  1) Edit /opt/roil-cantex-sidecar/.env and set CANTEX_OPERATOR_KEY + CANTEX_TRADING_KEY."
echo "  2) systemctl enable --now roil-cantex-sidecar"
echo "  3) curl http://127.0.0.1:6200/health"
INSTALL

echo "[deploy] done."
