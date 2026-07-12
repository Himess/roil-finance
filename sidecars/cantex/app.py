"""
Roil Cantex sidecar.

Wraps cantex_sdk in a small FastAPI service so the Roil TypeScript backend
can call Cantex DEX over plain HTTP. Runs on the same host as the backend.

Endpoints (symbol-based — pass "CC" / "USDCx" / "CBTC" etc.):
  GET  /health                  – liveness + Cantex auth status
  GET  /balance                 – per-token unlocked/locked amounts
  GET  /pools                   – pool list (symbols + contract IDs)
  POST /quote   {sell, buy, amount}            – price quote
  POST /swap    {sell, buy, amount, max_network_fee?}
                                – WebSocket-confirmed swap, returns
                                  real (post-execution) output amount

Auth between Roil backend and sidecar: optional X-Sidecar-Auth header,
checked against SIDECAR_AUTH_TOKEN env. Empty token disables the check
(dev only; production must set it).
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from cantex_sdk import (
    CantexSDK,
    IntentTradingKeySigner,
    OperatorKeySigner,
)
from cantex_sdk._sdk import (  # noqa: F401 — keep import to surface errors early
    CantexAPIError,
    CantexAuthError,
    CantexError,
    CantexTimeoutError,
    InstrumentId,
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("CANTEX_BASE_URL", "https://api.cantex.io")
OPERATOR_KEY = os.environ.get("CANTEX_OPERATOR_KEY", "")
TRADING_KEY = os.environ.get("CANTEX_TRADING_KEY", "")
API_KEY_PATH = os.environ.get("CANTEX_API_KEY_PATH", "./api_key.txt")
AUTH_TOKEN = os.environ.get("SIDECAR_AUTH_TOKEN", "")

if not OPERATOR_KEY:
    raise RuntimeError("CANTEX_OPERATOR_KEY env is required")

logger = logging.getLogger("roil.cantex.sidecar")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


# ---------------------------------------------------------------------------
# Auth (between Roil backend and this sidecar)
# ---------------------------------------------------------------------------


def require_auth(x_sidecar_auth: str | None = Header(default=None)) -> None:
    if not AUTH_TOKEN:
        return  # dev mode
    if x_sidecar_auth != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="invalid sidecar auth")


# ---------------------------------------------------------------------------
# Shared SDK instance + symbol cache
# ---------------------------------------------------------------------------


class SDKState:
    """One CantexSDK + a symbol→InstrumentId cache, populated on startup.

    The cache lets the Roil backend send simple "CC" / "USDCx" / "CBTC"
    symbols instead of the full Daml InstrumentId (admin party + id).
    """

    sdk: CantexSDK | None = None
    instruments: dict[str, InstrumentId] = {}  # symbol -> InstrumentId
    party_address: str = ""

    @classmethod
    async def refresh_instruments(cls) -> None:
        assert cls.sdk is not None
        admin = await cls.sdk.get_account_admin()
        cls.party_address = admin.address
        cls.instruments = {
            inst.instrument_symbol: inst.instrument for inst in admin.instruments
        }
        logger.info(
            "instrument cache: %s -> party %s",
            ",".join(cls.instruments),
            cls.party_address[:24],
        )

    @classmethod
    def resolve(cls, symbol: str) -> InstrumentId:
        try:
            return cls.instruments[symbol]
        except KeyError as e:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"unknown instrument symbol '{symbol}'; "
                    f"known: {sorted(cls.instruments)}"
                ),
            ) from e


@asynccontextmanager
async def lifespan(app: FastAPI):
    operator = OperatorKeySigner.from_hex(OPERATOR_KEY)
    intent = IntentTradingKeySigner.from_hex(TRADING_KEY) if TRADING_KEY else None
    SDKState.sdk = CantexSDK(
        operator,
        intent,
        base_url=BASE_URL,
        api_key_path=API_KEY_PATH,
    )
    try:
        await SDKState.sdk.authenticate()
        await SDKState.refresh_instruments()
        logger.info("sidecar ready: base=%s party=%s", BASE_URL, SDKState.party_address[:24])
        yield
    finally:
        if SDKState.sdk is not None:
            await SDKState.sdk.close()


app = FastAPI(title="Roil Cantex Sidecar", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    ok: bool
    base_url: str
    party_address: str
    instruments: list[str]


class TokenBalance(BaseModel):
    symbol: str
    unlocked: str  # Decimal as string to preserve precision over JSON
    locked: str


class BalanceResponse(BaseModel):
    party_address: str
    tokens: list[TokenBalance]


class PoolDescriptor(BaseModel):
    contract_id: str
    pair: str  # "CC/USDCx"
    token_a_symbol: str
    token_b_symbol: str


class PoolsResponse(BaseModel):
    pools: list[PoolDescriptor]


class QuoteRequest(BaseModel):
    sell: str = Field(..., description="Sell symbol, e.g. CC")
    buy: str = Field(..., description="Buy symbol, e.g. USDCx")
    amount: str = Field(..., description="Sell amount as decimal string")


class QuoteResponse(BaseModel):
    sell: str
    buy: str
    sell_amount: str
    returned_amount: str
    returned_symbol: str
    trade_price: str
    slippage: str
    fee_percentage: str
    admin_fee: str
    liquidity_fee: str
    network_fee_cc: str
    estimated_seconds: str
    pools_used: int


class SwapRequest(BaseModel):
    sell: str
    buy: str
    amount: str
    max_network_fee: str | None = Field(
        default=None,
        description=(
            "Optional cap on network fee (in CC, decimal string). "
            "If omitted, sidecar uses quote × 1.25."
        ),
    )
    timeout_seconds: float = 120.0


class SwapResponse(BaseModel):
    event_id: str
    market: str
    input_amount: str
    input_symbol: str
    output_amount: str
    output_symbol: str
    admin_fee_amount: str
    liquidity_fee_amount: str
    price: str
    created_at: str


class TransferRequest(BaseModel):
    symbol: str = Field(..., description="Instrument symbol, e.g. CC or USDCx")
    amount: str = Field(..., description="Amount as decimal string")
    receiver: str = Field(..., description="Receiver party ID (full Daml party)")
    memo: str = Field(default="", description="Optional memo, free text")


class TransferResponse(BaseModel):
    # `cantex_sdk.transfer` returns a free-form dict; we surface the bits
    # that look stable across SDK versions (id + transaction hash) and pass
    # the rest through as `raw` for ops debugging.
    transfer_id: str | None = None
    raw: dict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sym_for(inst: InstrumentId) -> str:
    """Reverse-lookup symbol from cached InstrumentId."""
    for sym, cached in SDKState.instruments.items():
        if cached.id == inst.id and cached.admin == inst.admin:
            return sym
    return inst.id


def _err(e: Exception) -> HTTPException:
    """Translate Cantex SDK errors to HTTP errors with useful detail."""
    if isinstance(e, CantexAuthError):
        return HTTPException(status_code=401, detail=f"cantex auth: {e}")
    if isinstance(e, CantexTimeoutError):
        return HTTPException(status_code=504, detail=str(e))
    if isinstance(e, CantexAPIError):
        return HTTPException(status_code=502, detail=f"cantex api: {e.status}: {e.body[:300]}")
    if isinstance(e, CantexError):
        return HTTPException(status_code=502, detail=str(e))
    return HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness — does not refresh auth; returns cached state."""
    return HealthResponse(
        ok=SDKState.sdk is not None and bool(SDKState.instruments),
        base_url=BASE_URL,
        party_address=SDKState.party_address,
        instruments=sorted(SDKState.instruments.keys()),
    )


@app.get("/balance", response_model=BalanceResponse, dependencies=[Depends(require_auth)])
async def balance() -> BalanceResponse:
    assert SDKState.sdk is not None
    try:
        info = await SDKState.sdk.get_account_info()
    except Exception as e:
        raise _err(e) from e

    return BalanceResponse(
        party_address=info.address,
        tokens=[
            TokenBalance(
                symbol=t.instrument_symbol,
                unlocked=str(t.unlocked_amount),
                locked=str(t.locked_amount),
            )
            for t in info.tokens
        ],
    )


@app.get("/pools", response_model=PoolsResponse, dependencies=[Depends(require_auth)])
async def pools() -> PoolsResponse:
    assert SDKState.sdk is not None
    try:
        pools_info = await SDKState.sdk.get_pool_info()
    except Exception as e:
        raise _err(e) from e

    out: list[PoolDescriptor] = []
    for p in pools_info.pools:
        a = _sym_for(p.token_a)
        b = _sym_for(p.token_b)
        out.append(
            PoolDescriptor(
                contract_id=p.contract_id,
                pair=f"{a}/{b}",
                token_a_symbol=a,
                token_b_symbol=b,
            )
        )
    return PoolsResponse(pools=out)


@app.post("/quote", response_model=QuoteResponse, dependencies=[Depends(require_auth)])
async def quote(req: QuoteRequest) -> QuoteResponse:
    assert SDKState.sdk is not None
    sell_inst = SDKState.resolve(req.sell)
    buy_inst = SDKState.resolve(req.buy)
    try:
        q = await SDKState.sdk.get_swap_quote(
            sell_amount=Decimal(req.amount),
            sell_instrument=sell_inst,
            buy_instrument=buy_inst,
        )
    except Exception as e:
        raise _err(e) from e

    return QuoteResponse(
        sell=req.sell,
        buy=req.buy,
        sell_amount=str(q.sell_amount),
        returned_amount=str(q.returned.amount),
        returned_symbol=_sym_for(q.returned.instrument),
        trade_price=str(q.prices.trade),
        slippage=str(q.prices.slippage),
        fee_percentage=str(q.fees.fee_percentage),
        admin_fee=str(q.fees.amount_admin),
        liquidity_fee=str(q.fees.amount_liquidity),
        network_fee_cc=str(q.fees.network_fee.amount),
        estimated_seconds=str(q.estimated_time_seconds),
        pools_used=len(q.pools),
    )


@app.post("/swap", response_model=SwapResponse, dependencies=[Depends(require_auth)])
async def swap(req: SwapRequest) -> SwapResponse:
    """Execute a swap and wait for on-ledger confirmation via WebSocket.

    If `max_network_fee` is omitted, sidecar requests a fresh quote first
    and caps the fee at quoted_network_fee × 1.25 to keep the caller safe
    from runaway traffic costs while leaving headroom for round-to-round
    variance.
    """
    assert SDKState.sdk is not None
    if SDKState.sdk._intent_signer is None:  # type: ignore[attr-defined]
        raise HTTPException(status_code=400, detail="CANTEX_TRADING_KEY not configured")

    sell_inst = SDKState.resolve(req.sell)
    buy_inst = SDKState.resolve(req.buy)
    sell_amount = Decimal(req.amount)

    # Resolve max_network_fee
    if req.max_network_fee is not None:
        max_fee = Decimal(req.max_network_fee)
    else:
        try:
            q = await SDKState.sdk.get_swap_quote(
                sell_amount=sell_amount,
                sell_instrument=sell_inst,
                buy_instrument=buy_inst,
            )
            max_fee = (q.fees.network_fee.amount * Decimal("1.25")).quantize(Decimal("0.0001"))
        except Exception as e:
            raise _err(e) from e

    try:
        event = await SDKState.sdk.swap_and_confirm(
            sell_amount=sell_amount,
            sell_instrument=sell_inst,
            buy_instrument=buy_inst,
            max_network_fee=max_fee,
            timeout=req.timeout_seconds,
        )
    except Exception as e:
        raise _err(e) from e

    return SwapResponse(
        event_id=event.event_id,
        market=event.market,
        input_amount=str(event.input_amount),
        input_symbol=_sym_for(event.input_instrument),
        output_amount=str(event.output_amount),
        output_symbol=_sym_for(event.output_instrument),
        admin_fee_amount=str(event.admin_fee_amount),
        liquidity_fee_amount=str(event.liquidity_fee_amount),
        price=str(event.price),
        created_at=event.created_at,
    )


@app.post("/transfer", response_model=TransferResponse, dependencies=[Depends(require_auth)])
async def transfer(req: TransferRequest) -> TransferResponse:
    """Move tokens out of the Cantex account to another Daml party.

    This is the withdrawal direction (Cantex -> Roil validator wallet,
    typically). The Cantex SDK signs the build/submit with the operator
    key, so no intent key is required. The choice of `receiver` is fully
    under the caller's control — we don't restrict it here; the Roil
    backend should validate against an allow-list at its own layer if the
    deployment policy requires it.
    """
    assert SDKState.sdk is not None
    inst = SDKState.resolve(req.symbol)
    try:
        result = await SDKState.sdk.transfer(
            amount=Decimal(req.amount),
            instrument=inst,
            receiver=req.receiver,
            memo=req.memo,
        )
    except Exception as e:
        raise _err(e) from e

    transfer_id = (
        result.get("id")
        or result.get("transfer_id")
        or result.get("transaction_id")
        if isinstance(result, dict)
        else None
    )
    return TransferResponse(transfer_id=transfer_id, raw=result if isinstance(result, dict) else {"value": str(result)})


# ---------------------------------------------------------------------------
# Entrypoint (uvicorn)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("SIDECAR_HOST", "127.0.0.1"),
        port=int(os.environ.get("SIDECAR_PORT", "6200")),
        log_level=os.environ.get("LOG_LEVEL", "info").lower(),
    )
