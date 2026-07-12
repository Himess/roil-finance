"""
Validator-side auto-accept loop for incoming Splice TransferInstructions.

When the Roil backend or admin pulls liquidity *out* of the Cantex account
back to the validator wallet, Cantex creates a Splice `TransferInstruction`
(CIP-0056 Token Standard, two-step). The receiver (our validator party)
must exercise `TransferInstruction_Accept` for the tokens to actually
settle into their wallet.

This loop runs on the validator VPS, polls the wallet API once a minute
for pending instructions, and accepts each one through the wallet's own
`/wallet/token-standard/transfers/{cid}/accept` endpoint (which knows how
to attach the Splice context contracts the gRPC ledger API doesn't).

Design notes:
- We only accept TIs where `transfer.receiver == OUR_PARTY` and the
  sender is in `TRUSTED_SENDERS` (currently just the Cantex provider
  party). That stops a stranger DoSing us by creating zero-value TIs.
- We don't auto-reject anything; rejection is a manual decision.
- `executeBefore` deadline is checked so we don't waste a submit on an
  expired TI.
- Polled every 60s rather than streamed because incoming withdrawals are
  rare (operator-triggered) and a streaming subscription is overkill for
  this volume.

Run via systemd: `roil-transfer-accept.service` (see same directory).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

LOG = logging.getLogger("roil.transfer-accept")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)

# ---------------------------------------------------------------------------
# Config (env-driven so the same script ships to TestNet + MainNet unchanged)
# ---------------------------------------------------------------------------

WALLET_HOST_HEADER = os.environ.get("WALLET_HOST", "wallet.localhost")
LEDGER_HOST_HEADER = os.environ.get("LEDGER_HOST", "json-ledger-api.localhost")
WALLET_BASE_URL = os.environ.get("WALLET_BASE_URL", "http://127.0.0.1")

# The party the validator wallet runs under (i.e. who must accept).
OUR_PARTY = os.environ["VALIDATOR_PARTY"]

# Comma-separated list of senders we trust. Default: empty == accept anyone
# (acceptable for early-stage; tighten in production).
TRUSTED_SENDERS = [
    s.strip()
    for s in os.environ.get("TRUSTED_SENDERS", "").split(",")
    if s.strip()
]

POLL_INTERVAL_SEC = int(os.environ.get("POLL_INTERVAL_SEC", "60"))

# Splice token-standard TransferInstruction interface (CIP-0056).
TI_INTERFACE = (
    "#splice-api-token-transfer-instruction-v1"
    ":Splice.Api.Token.TransferInstructionV1:TransferInstruction"
)

# Path to the `get-token.py` helper that mints validator-app JWTs. Same
# pattern the rest of the validator stack uses.
TOKEN_HELPER = os.environ.get(
    "TOKEN_HELPER",
    "/root/splice-node/docker-compose/validator/get-token.py",
)

# Path to the Python interpreter that has PyJWT installed (the system one
# on the validator VPS does).
TOKEN_PY = os.environ.get("TOKEN_PY", "/usr/bin/python3")


# ---------------------------------------------------------------------------
# Token + HTTP helpers
# ---------------------------------------------------------------------------


def mint_admin_token() -> str:
    """Run the standard get-token.py helper to mint a wallet-admin JWT.

    Done per-cycle (cheap; the script just signs a JWT with the unsafe
    secret) so a token that drifts past its `iat` window can't poison the
    rest of the loop.
    """
    out = subprocess.check_output(
        [TOKEN_PY, TOKEN_HELPER, "administrator"], text=True
    ).strip()
    if not out or out.count(".") != 2:
        raise RuntimeError(f"get-token.py returned non-JWT output: {out[:40]!r}")
    return out


def mint_ledger_token() -> str:
    """Mint a participant-audience JWT for the JSON Ledger API.

    The standard get-token.py helper produces a token with the wrong
    audience (`validator.example.com`) for the JSON Ledger API — that one
    expects `ledger_api.example.com`. We sign one directly with the same
    `unsafe` secret used by the helper.
    """
    import jwt  # type: ignore[import-not-found]

    now = int(time.time())
    return jwt.encode(
        {"iat": now, "aud": "https://ledger_api.example.com", "sub": "ledger-api-user"},
        "unsafe",
        algorithm="HS256",
    )


def http_request(
    method: str,
    path: str,
    *,
    host_header: str,
    token: str,
    body: dict | None = None,
    timeout: float = 30.0,
) -> dict:
    url = f"{WALLET_BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Host", host_header)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} on {method} {path}: {text[:300]}") from e


# ---------------------------------------------------------------------------
# Pending-TI query + accept
# ---------------------------------------------------------------------------


def fetch_ledger_end_offset(token: str) -> int:
    resp = http_request(
        "GET",
        "/v2/state/ledger-end",
        host_header=LEDGER_HOST_HEADER,
        token=token,
    )
    return int(resp.get("offset", 0))


def list_pending_transfer_instructions(token: str) -> list[dict]:
    """Query active TransferInstruction contracts where we are the receiver.

    Uses the InterfaceFilter form so we don't have to know the concrete
    template id (AmuletTransferInstruction etc.). The interface view gives
    us `transfer.sender`, `transfer.receiver`, `transfer.executeBefore`.
    """
    offset = fetch_ledger_end_offset(token)
    body = {
        "filter": {
            "filtersByParty": {
                OUR_PARTY: {
                    "cumulative": [
                        {
                            "identifierFilter": {
                                "InterfaceFilter": {
                                    "value": {
                                        "interfaceId": TI_INTERFACE,
                                        "includeInterfaceView": True,
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        },
        "verbose": False,
        "activeAtOffset": offset,
    }
    resp = http_request(
        "POST",
        "/v2/state/active-contracts",
        host_header=LEDGER_HOST_HEADER,
        token=token,
        body=body,
    )
    items = resp if isinstance(resp, list) else resp.get("contracts") or []
    out: list[dict] = []
    for it in items:
        entry = it.get("contractEntry") or {}
        ac = entry.get("JsActiveContract") or {}
        created = ac.get("createdEvent") or {}
        cid = created.get("contractId")
        views = created.get("interfaceViews") or []
        view = None
        for v in views:
            if v.get("interfaceId", "").endswith(":TransferInstruction"):
                view = v.get("viewValue") or {}
                break
        if not cid or not view:
            continue
        tx = view.get("transfer") or {}
        out.append(
            {
                "cid": cid,
                "sender": tx.get("sender", ""),
                "receiver": tx.get("receiver", ""),
                "amount": tx.get("amount", ""),
                "instrument_id": (tx.get("instrumentId") or {}).get("id", ""),
                "execute_before": tx.get("executeBefore"),
            }
        )
    return out


def accept_transfer_instruction(token: str, cid: str) -> dict:
    """Exercise the wallet-side accept endpoint for the given TI."""
    return http_request(
        "POST",
        f"/api/validator/v0/wallet/token-standard/transfers/{cid}/accept",
        host_header=WALLET_HOST_HEADER,
        token=token,
        timeout=60.0,
    )


# ---------------------------------------------------------------------------
# Decision logic
# ---------------------------------------------------------------------------


def is_safe_to_accept(ti: dict) -> tuple[bool, str]:
    if ti["receiver"] != OUR_PARTY:
        return False, "receiver-mismatch"
    if TRUSTED_SENDERS and ti["sender"] not in TRUSTED_SENDERS:
        return False, "untrusted-sender"
    exec_before = ti.get("execute_before")
    if exec_before:
        try:
            dt = datetime.fromisoformat(exec_before.replace("Z", "+00:00"))
            if dt < datetime.now(timezone.utc):
                return False, "expired"
        except ValueError:
            # Unparseable; treat as missing — let the accept fail loudly.
            pass
    return True, "ok"


# ---------------------------------------------------------------------------
# Loop
# ---------------------------------------------------------------------------


def cycle() -> None:
    ledger_token = mint_ledger_token()
    admin_token = mint_admin_token()
    pending = list_pending_transfer_instructions(ledger_token)
    if not pending:
        LOG.debug("no pending transfer instructions")
        return
    LOG.info("found %d pending TI(s)", len(pending))
    for ti in pending:
        ok, reason = is_safe_to_accept(ti)
        if not ok:
            LOG.info(
                "skip %s sender=%s amount=%s instrument=%s reason=%s",
                ti["cid"][:24],
                ti["sender"][:30],
                ti["amount"],
                ti["instrument_id"],
                reason,
            )
            continue
        try:
            result = accept_transfer_instruction(admin_token, ti["cid"])
            LOG.info(
                "accepted %s amount=%s %s from=%s  result=%s",
                ti["cid"][:24],
                ti["amount"],
                ti["instrument_id"],
                ti["sender"][:30],
                str(result)[:120],
            )
        except Exception as e:
            LOG.error("accept failed for %s: %s", ti["cid"][:24], e)


def main() -> int:
    LOG.info(
        "transfer-accept loop starting: party=%s interval=%ds trusted=%s",
        OUR_PARTY[:30],
        POLL_INTERVAL_SEC,
        ",".join(s[:20] for s in TRUSTED_SENDERS) if TRUSTED_SENDERS else "<any>",
    )
    while True:
        try:
            cycle()
        except Exception as e:
            LOG.error("cycle failed: %s", e)
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
