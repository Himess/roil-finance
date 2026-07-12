# Roil Cantex Sidecar

FastAPI sidecar wrapping [`cantex_sdk`](https://github.com/caviarnine/cantex_sdk) so
the Roil TypeScript backend can call Cantex DEX over plain HTTP.

The native TS port at `backend/src/cantex-client.ts` had wrong response schemas and
no WebSocket-based swap confirmation; this sidecar uses the published Python SDK
1:1 and exposes a symbol-based REST API (`CC` / `USDCx` / `CBTC` …) so the backend
never deals with raw Daml `InstrumentId`s.

## Run locally

```bash
cd sidecars/cantex
python -m venv venv
venv/Scripts/python -m pip install -e .         # Windows
# or
. venv/bin/activate && pip install -e .         # Linux

cp .env.example .env  # fill in CANTEX_OPERATOR_KEY + CANTEX_TRADING_KEY
python app.py
```

Defaults to MainNet (`https://api.cantex.io`) on `127.0.0.1:6200`.

## Endpoints

| Verb | Path | Notes |
|------|------|-------|
| GET  | `/health`  | Liveness + auth status. No sidecar auth required. |
| GET  | `/balance` | Per-token unlocked/locked amounts (symbols). |
| GET  | `/pools`   | Pool list with reverse-resolved symbols. |
| POST | `/quote`   | `{sell, buy, amount}` — price + per-fee breakdown. |
| POST | `/swap`    | `{sell, buy, amount, max_network_fee?}` — WS-confirmed. |

All endpoints (except `/health`) require `X-Sidecar-Auth: <SIDECAR_AUTH_TOKEN>`
if the env is set. The Roil backend sets it; nothing else should reach this port.

## Why a sidecar instead of porting to TS?

- The Python SDK is officially supported and matches the live API exactly.
- It already handles: challenge-response auth, secp256k1 intent signing, and the
  private WebSocket needed to read `SwapExecutedEvent` (real output_amount).
- Rewriting all three in TS without bugs takes longer than the value it adds.
- Sidecar runs on the same host as the backend, so latency is loopback-bound
  (~1 ms) and there is no extra network surface.
