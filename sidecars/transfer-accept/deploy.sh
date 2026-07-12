#!/usr/bin/env bash
# Ship the transfer-accept loop to a validator VPS. Idempotent.
# Usage: ./deploy.sh user@<validator-vps> <VALIDATOR_PARTY_ID>
set -euo pipefail

TARGET="${1:-}"
PARTY="${2:-}"
if [[ -z "$TARGET" || -z "$PARTY" ]]; then
  echo "usage: $0 user@host VALIDATOR_PARTY_ID" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
echo "[deploy] target=$TARGET party=${PARTY:0:30}…"

ssh "$TARGET" 'mkdir -p /opt/roil-transfer-accept'
scp -q "$HERE/accept_loop.py" "$HERE/roil-transfer-accept.service" "$TARGET":/tmp/

ssh "$TARGET" "PARTY='$PARTY' bash -s" <<'INSTALL'
set -euo pipefail
DEST=/opt/roil-transfer-accept

install -o root -g root -m 0644 /tmp/accept_loop.py "$DEST/accept_loop.py"
install -o root -g root -m 0644 /tmp/roil-transfer-accept.service /etc/systemd/system/roil-transfer-accept.service

# Make sure PyJWT is present for mint_ledger_token() — it ships with the
# validator container but not always with the host Python.
if ! python3 -c "import jwt" 2>/dev/null; then
  apt-get install -y python3-jwt 2>&1 | tail -3 || pip3 install --break-system-packages pyjwt 2>&1 | tail -3
fi

if [[ ! -f "$DEST/.env" ]]; then
  cat > "$DEST/.env" <<ENV
VALIDATOR_PARTY=$PARTY
TRUSTED_SENDERS=Cantex-validator-1::122038c015864f106cfed48bb9106b7c89982368d27956ffcdfda6c38328f0909b8c
POLL_INTERVAL_SEC=60
ENV
  chmod 600 "$DEST/.env"
fi

systemctl daemon-reload
systemctl enable roil-transfer-accept
systemctl restart roil-transfer-accept
sleep 2
systemctl is-active roil-transfer-accept || true
journalctl -u roil-transfer-accept -n 10 --no-pager
INSTALL

echo "[deploy] done."
