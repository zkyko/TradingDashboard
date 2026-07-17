"""Zkyko market math service — indicators, VP, ML, options. Descriptive only."""
from __future__ import annotations

from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

app = FastAPI(title="Zkyko Analyze", version="0.1.0")


class Bar(BaseModel):
    time: str | None = None
    open: float
    high: float
    low: float
    close: float
    volume: float = 0


class AnalyzeRequest(BaseModel):
    bars: list[Bar]
    bins: int = Field(default=32, ge=8, le=96)
    vp_mode: Literal["daily", "session", "visible"] = "daily"
    include_ml: bool = False


class PredictRequest(BaseModel):
    bars: list[Bar]


class OptionsAnalyzeRequest(BaseModel):
    symbol: str
    bins: int = 32
    include_ml: bool = False


def bars_to_df(bars: list[Bar]) -> pd.DataFrame:
    if not bars:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    rows = [
        {
            "Open": b.open,
            "High": b.high,
            "Low": b.low,
            "Close": b.close,
            "Volume": b.volume or 0,
            "time": b.time or "",
        }
        for b in bars
    ]
    df = pd.DataFrame(rows)
    return df


def series_or_none(s: pd.Series) -> list[float | None]:
    out: list[float | None] = []
    for v in s.tolist():
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            out.append(None)
        else:
            out.append(float(v))
    return out


def last_num(values: list[float | None]) -> float | None:
    for v in reversed(values):
        if v is not None:
            return v
    return None


def compute_indicators(df: pd.DataFrame) -> dict[str, Any]:
    if df.empty:
        empty = []
        return {
            "sma20": empty,
            "sma50": empty,
            "sma200": empty,
            "ema12": empty,
            "ema26": empty,
            "macd": empty,
            "macdSignal": empty,
            "macdHist": empty,
            "rsi": empty,
            "bbUpper": empty,
            "bbMid": empty,
            "bbLower": empty,
            "atr": empty,
            "stochK": empty,
            "stochD": empty,
            "volSma": empty,
            "volRatio": empty,
        }

    close = df["Close"]
    high = df["High"]
    low = df["Low"]
    vol = df["Volume"]

    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - macd_signal

    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    bb_mid = sma20
    bb_std = close.rolling(20).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std

    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(14).mean()

    low14 = low.rolling(14).min()
    high14 = high.rolling(14).max()
    stoch_k = 100 * ((close - low14) / (high14 - low14).replace(0, np.nan))
    stoch_d = stoch_k.rolling(3).mean()

    vol_sma = vol.rolling(20).mean()
    vol_ratio = vol / vol_sma.replace(0, np.nan)

    return {
        "sma20": series_or_none(sma20),
        "sma50": series_or_none(sma50),
        "sma200": series_or_none(sma200),
        "ema12": series_or_none(ema12),
        "ema26": series_or_none(ema26),
        "macd": series_or_none(macd),
        "macdSignal": series_or_none(macd_signal),
        "macdHist": series_or_none(macd_hist),
        "rsi": series_or_none(rsi),
        "bbUpper": series_or_none(bb_upper),
        "bbMid": series_or_none(bb_mid),
        "bbLower": series_or_none(bb_lower),
        "atr": series_or_none(atr),
        "stochK": series_or_none(stoch_k),
        "stochD": series_or_none(stoch_d),
        "volSma": series_or_none(vol_sma),
        "volRatio": series_or_none(vol_ratio),
    }


def compute_states(df: pd.DataFrame, ind: dict[str, Any]) -> dict[str, str]:
    if df.empty:
        return {
            "rsi": "neutral",
            "vsSma20": "neutral",
            "macd": "neutral",
            "stoch": "neutral",
            "volume": "normal",
            "bb": "neutral",
        }
    close = float(df["Close"].iloc[-1])
    rsi = last_num(ind["rsi"])
    sma20 = last_num(ind["sma20"])
    macd_hist = last_num(ind["macdHist"])
    stoch = last_num(ind["stochK"])
    vol_r = last_num(ind["volRatio"])
    bb_u = last_num(ind["bbUpper"])
    bb_l = last_num(ind["bbLower"])

    rsi_state = "neutral"
    if rsi is not None:
        if rsi >= 70:
            rsi_state = "overbought"
        elif rsi <= 30:
            rsi_state = "oversold"

    vs = "neutral"
    if sma20:
        vs = "above" if close >= sma20 else "below"

    macd_state = "neutral"
    if macd_hist is not None:
        macd_state = "hist_pos" if macd_hist >= 0 else "hist_neg"

    stoch_state = "neutral"
    if stoch is not None:
        if stoch >= 80:
            stoch_state = "overbought"
        elif stoch <= 20:
            stoch_state = "oversold"

    vol_state = "normal"
    if vol_r is not None:
        if vol_r >= 1.5:
            vol_state = "high"
        elif vol_r <= 0.5:
            vol_state = "low"

    bb_state = "neutral"
    if bb_u is not None and bb_l is not None:
        if close >= bb_u:
            bb_state = "above_upper"
        elif close <= bb_l:
            bb_state = "below_lower"

    return {
        "rsi": rsi_state,
        "vsSma20": vs,
        "macd": macd_state,
        "stoch": stoch_state,
        "volume": vol_state,
        "bb": bb_state,
    }


def compute_risk(df: pd.DataFrame) -> dict[str, Any]:
    if len(df) < 2:
        return {
            "totalReturn": None,
            "annVol": None,
            "sharpe": None,
            "maxDrawdown": None,
            "cumulative": [],
        }
    closes = df["Close"].astype(float)
    total_return = float(closes.iloc[-1] / closes.iloc[0] - 1) if closes.iloc[0] else None
    rets = closes.pct_change().dropna()
    ann_vol = float(rets.std() * np.sqrt(252)) if len(rets) else None
    mean = float(rets.mean()) if len(rets) else 0.0
    sharpe = float((mean * 252) / ann_vol) if ann_vol and ann_vol > 0 else None
    peak = closes.cummax()
    dd = (closes / peak - 1).min()
    cum = (1 + rets).cumprod() - 1
    cumulative = [0.0] + [float(x) for x in cum.tolist()]
    return {
        "totalReturn": total_return,
        "annVol": ann_vol,
        "sharpe": sharpe,
        "maxDrawdown": float(dd) if not np.isnan(dd) else None,
        "cumulative": cumulative,
    }


def compute_volume_profile(df: pd.DataFrame, bins: int = 32, mode: str = "daily") -> dict[str, Any]:
    """Volume-by-price. Daily/session/visible all use provided bars; mode is a label."""
    if df.empty:
        return {
            "mode": mode,
            "bins": [],
            "poc": None,
            "vah": None,
            "val": None,
            "totalVolume": 0,
        }

    work = df.copy()
    if mode == "session" and "time" in work.columns and len(work) > 0:
        # Use last calendar day of bars when timestamps exist
        last_t = str(work["time"].iloc[-1])[:10]
        day = work[work["time"].astype(str).str.startswith(last_t)]
        if len(day) >= 2:
            work = day

    price_low = float(work["Low"].min())
    price_high = float(work["High"].max())
    if not np.isfinite(price_low) or not np.isfinite(price_high) or price_high <= price_low:
        mid = float(work["Close"].iloc[-1])
        price_low = mid * 0.99
        price_high = mid * 1.01

    edges = np.linspace(price_low, price_high, bins + 1)
    volumes = np.zeros(bins)

    for _, row in work.iterrows():
        lo = float(row["Low"])
        hi = float(row["High"])
        vol = float(row["Volume"] or 0)
        if vol <= 0:
            continue
        if hi <= lo:
            # All volume into close bin
            c = float(row["Close"])
            idx = int(np.clip(np.searchsorted(edges, c, side="right") - 1, 0, bins - 1))
            volumes[idx] += vol
            continue
        # Distribute volume uniformly across overlapping bins
        for i in range(bins):
            a, b = edges[i], edges[i + 1]
            overlap = max(0.0, min(hi, b) - max(lo, a))
            if overlap > 0:
                volumes[i] += vol * (overlap / (hi - lo))

    total = float(volumes.sum())
    bin_rows = []
    for i in range(bins):
        bin_rows.append(
            {
                "priceLow": float(edges[i]),
                "priceHigh": float(edges[i + 1]),
                "mid": float((edges[i] + edges[i + 1]) / 2),
                "volume": float(volumes[i]),
            }
        )

    poc_idx = int(np.argmax(volumes)) if total > 0 else 0
    poc = bin_rows[poc_idx]["mid"] if bin_rows else None

    # Value area ~70% of volume around POC
    vah = val = poc
    if total > 0 and bin_rows:
        target = total * 0.7
        lo_i = hi_i = poc_idx
        covered = volumes[poc_idx]
        while covered < target and (lo_i > 0 or hi_i < bins - 1):
            left = volumes[lo_i - 1] if lo_i > 0 else -1
            right = volumes[hi_i + 1] if hi_i < bins - 1 else -1
            if right >= left and hi_i < bins - 1:
                hi_i += 1
                covered += volumes[hi_i]
            elif lo_i > 0:
                lo_i -= 1
                covered += volumes[lo_i]
            else:
                break
        val = bin_rows[lo_i]["priceLow"]
        vah = bin_rows[hi_i]["priceHigh"]

    return {
        "mode": mode,
        "bins": bin_rows,
        "poc": poc,
        "vah": vah,
        "val": val,
        "totalVolume": total,
    }


def price_vs_va(price: float | None, val: float | None, poc: float | None, vah: float | None) -> str:
    """Where price sits vs value area. at_* uses ~5% of VA width (min 0.05% of price)."""
    if price is None or val is None or vah is None or poc is None:
        return "unknown"
    if not all(np.isfinite(x) for x in (price, val, poc, vah)):
        return "unknown"
    width = max(abs(vah - val), abs(price) * 0.0005, 1e-9)
    tol = width * 0.05
    if abs(price - val) <= tol:
        return "at_val"
    if abs(price - vah) <= tol:
        return "at_vah"
    if abs(price - poc) <= tol:
        return "at_poc"
    if price < val:
        return "below_val"
    if price > vah:
        return "above_vah"
    return "inside_va"


def vp_levels(df: pd.DataFrame, mode: str = "visible", bins: int = 32, price: float | None = None) -> dict[str, Any]:
    vp = compute_volume_profile(df, bins=bins, mode=mode)
    pos = price_vs_va(price, vp.get("val"), vp.get("poc"), vp.get("vah"))
    return {
        "mode": mode,
        "poc": vp.get("poc"),
        "val": vp.get("val"),
        "vah": vp.get("vah"),
        "totalVolume": vp.get("totalVolume"),
        "position": pos,
        "alert": pos in {"at_val", "at_vah", "at_poc"},
    }


def resample_ohlcv(hist: pd.DataFrame, rule: str) -> pd.DataFrame:
    if hist is None or hist.empty:
        return hist
    return (
        hist.resample(rule)
        .agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"})
        .dropna()
    )


def hist_to_bars(hist: pd.DataFrame, limit: int = 240) -> list[dict[str, float | int]]:
    bars: list[dict[str, float | int]] = []
    if hist is None or hist.empty:
        return bars
    for idx, row in hist.iloc[-limit:].iterrows():
        bars.append(
            {
                "time": int(pd.Timestamp(idx).timestamp()),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row.get("Volume") or 0),
            }
        )
    return bars


def build_live_profiles(hist_5m: pd.DataFrame, hist_1d: pd.DataFrame, price: float | None) -> dict[str, Any]:
    """VP suite: 10m / 15m / 30m / 1d + session daily + weekly."""
    profiles: dict[str, Any] = {}
    if hist_5m is not None and not hist_5m.empty:
        for key, rule in (("10m", "10min"), ("15m", "15min"), ("30m", "30min")):
            frame = resample_ohlcv(hist_5m, rule)
            profiles[key] = vp_levels(frame, mode="visible", bins=28, price=price) if not frame.empty else None
        # Session / daily = last calendar day of intraday
        day = hist_5m.copy()
        day["time"] = [str(pd.Timestamp(i)) for i in day.index]
        profiles["daily"] = vp_levels(day, mode="session", bins=28, price=price)
    else:
        for key in ("10m", "15m", "30m", "daily"):
            profiles[key] = None

    if hist_1d is not None and not hist_1d.empty:
        profiles["1d"] = vp_levels(hist_1d.iloc[-40:], mode="visible", bins=28, price=price)
        profiles["weekly"] = vp_levels(hist_1d.iloc[-5:], mode="visible", bins=24, price=price)
    else:
        profiles["1d"] = None
        profiles["weekly"] = None
    return profiles


def _r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0


def train_predict(df: pd.DataFrame) -> dict[str, Any] | None:
    """Classical next-close forecast via ridge regression (numpy-only, no sklearn)."""
    if len(df) < 80:
        return None
    data = df.copy()
    data["SMA_20"] = data["Close"].rolling(20).mean()
    data["SMA_50"] = data["Close"].rolling(50).mean()
    data["EMA_12"] = data["Close"].ewm(span=12, adjust=False).mean()
    data["EMA_26"] = data["Close"].ewm(span=26, adjust=False).mean()
    data["MACD"] = data["EMA_12"] - data["EMA_26"]
    delta = data["Close"].diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    data["RSI"] = 100 - (100 / (1 + rs))
    data["Returns"] = data["Close"].pct_change()
    data["ATR"] = (
        pd.concat(
            [
                data["High"] - data["Low"],
                (data["High"] - data["Close"].shift()).abs(),
                (data["Low"] - data["Close"].shift()).abs(),
            ],
            axis=1,
        )
        .max(axis=1)
        .rolling(14)
        .mean()
    )
    data["Price_vs_SMA20"] = (data["Close"] - data["SMA_20"]) / data["SMA_20"] * 100
    data["Price_vs_SMA50"] = (data["Close"] - data["SMA_50"]) / data["SMA_50"] * 100
    data["Price_volatility_10d"] = data["Returns"].rolling(10).std()
    data["Price_volatility_20d"] = data["Returns"].rolling(20).std()
    for lag in [1, 2, 3, 5, 10]:
        data[f"Close_lag_{lag}"] = data["Close"].shift(lag)
        data[f"Volume_lag_{lag}"] = data["Volume"].shift(lag)
        data[f"Returns_lag_{lag}"] = data["Returns"].shift(lag)
    for window in [5, 10, 20]:
        data[f"Close_mean_{window}"] = data["Close"].rolling(window).mean()
        data[f"Close_std_{window}"] = data["Close"].rolling(window).std()
        data[f"Volume_mean_{window}"] = data["Volume"].rolling(window).mean()

    feature_cols = [
        c
        for c in data.columns
        if (
            "lag" in c
            or "mean" in c
            or "std" in c
            or c
            in [
                "RSI",
                "MACD",
                "Price_vs_SMA20",
                "Price_vs_SMA50",
                "Price_volatility_10d",
                "Price_volatility_20d",
                "ATR",
            ]
        )
    ]
    data["target"] = data["Close"].shift(-1)
    work = data[feature_cols + ["target", "Close"]].dropna()
    if len(work) < 50:
        return None

    X = work[feature_cols].to_numpy(dtype=float)
    y = work["target"].to_numpy(dtype=float)
    # Standardize
    mu = X.mean(axis=0)
    sigma = X.std(axis=0)
    sigma[sigma == 0] = 1.0
    Xs = (X - mu) / sigma
    n = len(Xs)
    split = max(10, int(n * 0.8))
    X_train, X_test = Xs[:split], Xs[split:]
    y_train, y_test = y[:split], y[split:]
    # Ridge closed form
    lam = 1.0
    xtx = X_train.T @ X_train + lam * np.eye(X_train.shape[1])
    xty = X_train.T @ y_train
    try:
        coef = np.linalg.solve(xtx, xty)
    except np.linalg.LinAlgError:
        coef = np.linalg.lstsq(xtx, xty, rcond=None)[0]
    train_pred = X_train @ coef
    test_pred = X_test @ coef if len(X_test) else train_pred
    train_score = _r2(y_train, train_pred)
    test_score = _r2(y_test, test_pred) if len(X_test) else train_score
    prediction = float(Xs[-1] @ coef)
    last_close = float(work["Close"].iloc[-1])
    abs_coef = np.abs(coef)
    total_c = float(abs_coef.sum()) or 1.0
    importances = sorted(
        (
            {"feature": f, "importance": float(a / total_c)}
            for f, a in zip(feature_cols, abs_coef)
        ),
        key=lambda x: x["importance"],
        reverse=True,
    )[:12]
    return {
        "predictedClose": prediction,
        "lastClose": last_close,
        "predictedChangePct": ((prediction / last_close) - 1) * 100 if last_close else None,
        "trainScore": train_score,
        "testScore": test_score,
        "featureImportance": importances,
        "model": "ridge",
        "disclaimer": "Experimental classical ML — descriptive math only, not a recommendation.",
    }


def build_analysis(df: pd.DataFrame, bins: int, vp_mode: str, include_ml: bool) -> dict[str, Any]:
    ind = compute_indicators(df)
    payload: dict[str, Any] = {
        "indicators": ind,
        "states": compute_states(df, ind),
        "risk": compute_risk(df),
        "volumeProfile": compute_volume_profile(df, bins=bins, mode=vp_mode),
        "last": {
            "close": float(df["Close"].iloc[-1]) if len(df) else None,
            "rsi": last_num(ind["rsi"]),
            "sma20": last_num(ind["sma20"]),
            "sma50": last_num(ind["sma50"]),
            "volRatio": last_num(ind["volRatio"]),
        },
        "source": "zkyko-python",
    }
    if include_ml:
        payload["ml"] = train_predict(df)
    return payload


@app.get("/health")
def health():
    return {"ok": True, "service": "zkyko-analyze"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    df = bars_to_df(req.bars)
    return build_analysis(df, req.bins, req.vp_mode, req.include_ml)


@app.post("/volume-profile")
def volume_profile(req: AnalyzeRequest):
    df = bars_to_df(req.bars)
    return compute_volume_profile(df, bins=req.bins, mode=req.vp_mode)


@app.post("/predict")
def predict(req: PredictRequest):
    df = bars_to_df(req.bars)
    result = train_predict(df)
    if result is None:
        raise HTTPException(status_code=400, detail="Insufficient history for ML forecast.")
    return result


@app.get("/options/chain")
def options_chain(symbol: str = Query(..., min_length=1, max_length=12)):
    try:
        import yfinance as yf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yfinance not installed") from exc

    ticker = yf.Ticker(symbol.strip().upper())
    try:
        expiries = list(ticker.options or [])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Chain unavailable: {exc}") from exc

    chains = []
    for exp in expiries[:8]:
        try:
            chain = ticker.option_chain(exp)
            calls = chain.calls.fillna(0).to_dict(orient="records")
            puts = chain.puts.fillna(0).to_dict(orient="records")
            chains.append({"expiry": exp, "calls": calls, "puts": puts})
        except Exception:
            continue
    return {
        "symbol": symbol.strip().upper(),
        "expiries": expiries,
        "chains": chains,
        "source": "yfinance",
        "note": "Read-only market data supplement — not for order placement.",
    }


@app.post("/options/analyze")
def options_analyze(req: OptionsAnalyzeRequest):
    try:
        import yfinance as yf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yfinance not installed") from exc

    symbol = req.symbol.strip().upper()
    ticker = yf.Ticker(symbol)
    try:
        hist = ticker.history(period="6mo", interval="1d")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"History unavailable: {exc}") from exc
    if hist is None or hist.empty:
        raise HTTPException(status_code=400, detail="No option history returned.")

    bars = []
    for idx, row in hist.iterrows():
        bars.append(
            Bar(
                time=str(idx),
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume") or 0),
            )
        )
    df = bars_to_df(bars)
    analysis = build_analysis(df, req.bins, "daily", req.include_ml)
    analysis["symbol"] = symbol
    analysis["bars"] = [b.model_dump() for b in bars]
    analysis["source"] = "yfinance"
    return analysis


class LiveBoardRequest(BaseModel):
    interval: Literal["10m", "15m", "30m"] = "15m"
    symbols: list[str] = Field(
        default_factory=lambda: ["SOXL", "SOXS", "SPY", "QQQ", "TSLA", "TSLL", "LABD", "NFXL", "ES=F"]
    )
    include_ml: bool = True


def run_live_board(
    interval: Literal["10m", "15m", "30m"],
    symbols: list[str],
    include_ml: bool = True,
) -> dict[str, Any]:
    """Intraday board + multi-TF volume profiles (VAL/POC/VAH) + RSI/ML."""
    try:
        import yfinance as yf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yfinance not installed") from exc

    resample_map = {"10m": "10min", "15m": "15min", "30m": "30min"}
    wanted = [s.strip() for s in symbols if s and str(s).strip()]
    out = []
    for raw in wanted:
        display = "ES" if str(raw).upper() in {"ES", "ES=F", "/ES"} else str(raw).upper()
        yf_sym = "ES=F" if display == "ES" else str(raw).upper()
        try:
            hist_5m = yf.Ticker(yf_sym).history(period="5d", interval="5m")
            hist_1d = yf.Ticker(yf_sym).history(period="3mo", interval="1d")
        except Exception as exc:
            out.append(
                {
                    "symbol": display,
                    "yf": yf_sym,
                    "error": str(exc),
                    "bars": [],
                    "last": None,
                    "analysis": None,
                    "profiles": None,
                }
            )
            continue
        if hist_5m is None or hist_5m.empty:
            out.append(
                {
                    "symbol": display,
                    "yf": yf_sym,
                    "error": "No bars",
                    "bars": [],
                    "last": None,
                    "analysis": None,
                    "profiles": None,
                }
            )
            continue

        chart = resample_ohlcv(hist_5m, resample_map[interval])
        if chart is None or chart.empty:
            chart = hist_5m
        bars = hist_to_bars(chart, limit=240)
        window = chart.iloc[-240:].copy()
        last = bars[-1] if bars else None
        price = float(last["close"]) if last else None

        profiles = build_live_profiles(hist_5m, hist_1d if hist_1d is not None else pd.DataFrame(), price)

        analysis_payload = None
        try:
            analysis = build_analysis(window, bins=24, vp_mode="session", include_ml=include_ml)
            rsi_series = []
            sma20_series = []
            for i, bar in enumerate(bars):
                rsi_v = analysis["indicators"]["rsi"][i] if i < len(analysis["indicators"]["rsi"]) else None
                sma_v = analysis["indicators"]["sma20"][i] if i < len(analysis["indicators"]["sma20"]) else None
                if rsi_v is not None:
                    rsi_series.append({"time": bar["time"], "value": float(rsi_v)})
                if sma_v is not None:
                    sma20_series.append({"time": bar["time"], "value": float(sma_v)})
            # Prefer session daily VP on analysis payload too
            daily_vp = profiles.get("daily") or {}
            analysis_payload = {
                "last": analysis["last"],
                "states": analysis["states"],
                "ml": analysis.get("ml"),
                "rsiSeries": rsi_series,
                "sma20Series": sma20_series,
                "volumeProfile": {
                    "mode": "daily",
                    "poc": daily_vp.get("poc"),
                    "val": daily_vp.get("val"),
                    "vah": daily_vp.get("vah"),
                    "totalVolume": daily_vp.get("totalVolume"),
                    "bins": [],
                },
            }
        except Exception as exc:
            analysis_payload = {"error": str(exc), "last": None, "states": {}, "ml": None}

        change_pct = None
        prev_close = None
        try:
            fast = yf.Ticker(yf_sym).fast_info
            prev_close = float(getattr(fast, "previous_close", None) or 0) or None
        except Exception:
            prev_close = None
        if last and prev_close:
            change_pct = (float(last["close"]) / prev_close - 1) * 100
        elif last and len(bars) > 1 and bars[0]["close"]:
            change_pct = (float(last["close"]) / float(bars[0]["close"]) - 1) * 100

        # Surface the hottest VP alert (daily/weekly first)
        alerts = []
        for label in ("daily", "weekly", "1d", interval, "10m", "15m", "30m"):
            snap = profiles.get(label) if profiles else None
            if snap and snap.get("alert"):
                alerts.append({"tf": label, "position": snap.get("position"), **{k: snap.get(k) for k in ("val", "poc", "vah")}})

        out.append(
            {
                "symbol": display,
                "yf": yf_sym,
                "interval": interval,
                "bars": bars,
                "last": last,
                "previousClose": prev_close,
                "changePct": change_pct,
                "analysis": analysis_payload,
                "profiles": profiles,
                "vpAlerts": alerts,
                "error": None,
            }
        )
    return {
        "interval": interval,
        "symbols": out,
        "source": "yfinance+python",
        "updatedAt": pd.Timestamp.now("UTC").isoformat(),
        "note": "Live board VP: 10m/15m/30m/1d + daily session + weekly. Descriptive only.",
    }


@app.get("/live/board")
def live_board_get(
    interval: Literal["10m", "15m", "30m"] = Query("15m"),
    symbols: str = Query(
        "SOXL,SOXS,SPY,QQQ,TSLA,TSLL,LABD,NFXL,ES=F",
        description="Comma-separated Yahoo symbols (ES=F for ES futures)",
    ),
    include_ml: bool = Query(True),
):
    wanted = [s.strip() for s in symbols.split(",") if s.strip()]
    return run_live_board(interval, wanted, include_ml)


@app.post("/live/board")
def live_board_post(req: LiveBoardRequest):
    return run_live_board(req.interval, req.symbols, req.include_ml)


class OptionsHistoryOrder(BaseModel):
    id: str | None = None
    underlying: str = ""
    direction: str = ""
    state: str = ""
    strategy: str | None = None
    quantity: float = 0
    filled_quantity: float = 0
    premium: float | None = None
    cashflow: float | None = None
    created_at: str = ""
    effect: str | None = None
    dte: float | None = None
    option_type: str | None = None
    strike: float | None = None
    expiration: str | None = None


class OptionsHistoryRequest(BaseModel):
    orders: list[OptionsHistoryOrder]


def _logistic_fit(X: np.ndarray, y: np.ndarray, lam: float = 1.0, steps: int = 80) -> np.ndarray:
    """Ridge-regularized logistic via IRLS-ish gradient steps (numpy-only)."""
    n, p = X.shape
    w = np.zeros(p)
    for _ in range(steps):
        z = X @ w
        # stable sigmoid
        prob = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        grad = X.T @ (prob - y) / n + lam * w
        # diagonal Hessian approx
        s = prob * (1.0 - prob)
        H = (X.T * s) @ X / n + lam * np.eye(p)
        try:
            step = np.linalg.solve(H, grad)
        except np.linalg.LinAlgError:
            step = grad
        w = w - step
        if float(np.linalg.norm(step)) < 1e-6:
            break
    return w


def analyze_options_history(orders: list[OptionsHistoryOrder]) -> dict[str, Any]:
    """Behavioral ML over options order tape — descriptive only, no trade advice."""
    if len(orders) < 12:
        return {
            "ok": False,
            "error": "Need at least 12 option orders for ML reflection.",
            "disclaimer": "Descriptive process math only — not trade advice.",
        }

    rows = []
    for o in orders:
        try:
            ts = pd.Timestamp(o.created_at)
        except Exception:
            continue
        state = (o.state or "").lower()
        canceled = 1.0 if ("cancel" in state or state in {"rejected", "failed"}) else 0.0
        filled = 1.0 if ("filled" in state and (o.filled_quantity or 0) > 0) else 0.0
        direction = (o.direction or "").lower()
        debit = 1.0 if direction == "debit" else 0.0
        credit = 1.0 if direction == "credit" else 0.0
        effect_open = 1.0 if (o.effect or "").lower() == "open" else 0.0
        effect_close = 1.0 if (o.effect or "").lower() == "close" else 0.0
        is_call = 1.0 if (o.option_type or "").lower() == "call" else 0.0
        is_put = 1.0 if (o.option_type or "").lower() == "put" else 0.0
        premium = float(o.premium or 0)
        dte = float(o.dte) if o.dte is not None and np.isfinite(o.dte) else np.nan
        rows.append(
            {
                "ts": ts,
                "hour": int(ts.hour),
                "dow": int(ts.dayofweek),
                "underlying": (o.underlying or "UNK").upper(),
                "canceled": canceled,
                "filled": filled,
                "debit": debit,
                "credit": credit,
                "effect_open": effect_open,
                "effect_close": effect_close,
                "is_call": is_call,
                "is_put": is_put,
                "premium": premium,
                "log_premium": float(np.log1p(abs(premium))),
                "dte": dte,
                "cashflow": float(o.cashflow) if o.cashflow is not None else np.nan,
                "qty": float(o.quantity or 0),
            }
        )
    df = pd.DataFrame(rows)
    if len(df) < 12:
        return {
            "ok": False,
            "error": "Could not parse enough timestamps.",
            "disclaimer": "Descriptive process math only — not trade advice.",
        }

    # Frequency encoding for underlyings
    freq = df["underlying"].value_counts(normalize=True)
    df["und_freq"] = df["underlying"].map(freq).astype(float)
    df["dte_filled"] = df["dte"].fillna(df["dte"].median() if df["dte"].notna().any() else 7.0)

    feature_cols = [
        "hour",
        "dow",
        "debit",
        "credit",
        "effect_open",
        "effect_close",
        "is_call",
        "is_put",
        "log_premium",
        "dte_filled",
        "und_freq",
        "qty",
    ]
    X_raw = df[feature_cols].to_numpy(dtype=float)
    mu = X_raw.mean(axis=0)
    sigma = X_raw.std(axis=0)
    sigma[sigma == 0] = 1.0
    X = (X_raw - mu) / sigma
    y = df["canceled"].to_numpy(dtype=float)

    # Train/test split chronological
    n = len(X)
    split = max(8, int(n * 0.75))
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    w = _logistic_fit(X_train, y_train)
    def _acc(xx: np.ndarray, yy: np.ndarray) -> float:
        if len(xx) == 0:
            return float("nan")
        prob = 1.0 / (1.0 + np.exp(-np.clip(xx @ w, -30, 30)))
        pred = (prob >= 0.5).astype(float)
        return float((pred == yy).mean())

    train_acc = _acc(X_train, y_train)
    test_acc = _acc(X_test, y_test) if len(X_test) else train_acc
    importance = sorted(
        [
            {"feature": name, "importance": float(abs(coef))}
            for name, coef in zip(feature_cols, w)
        ],
        key=lambda r: r["importance"],
        reverse=True,
    )

    # Rolling cancel rate + cashflow regime
    df = df.sort_values("ts")
    df["cancel_roll20"] = df["canceled"].rolling(20, min_periods=5).mean()
    df["cf"] = df["cashflow"].fillna(0.0)
    df["cf_cum"] = df["cf"].cumsum()
    df["cf_roll10"] = df["cf"].rolling(10, min_periods=3).sum()
    regime = []
    for _, r in df.iloc[:: max(1, len(df) // 40)].iterrows():
        regime.append(
            {
                "t": r["ts"].isoformat(),
                "cancelRate20": None if pd.isna(r["cancel_roll20"]) else float(r["cancel_roll20"]),
                "cashflowCum": float(r["cf_cum"]),
                "cashflowRoll10": None if pd.isna(r["cf_roll10"]) else float(r["cf_roll10"]),
            }
        )

    # Simple 3-means on [hour, log_premium, dte, und_freq] for behavior clusters
    Z = df[["hour", "log_premium", "dte_filled", "und_freq"]].to_numpy(dtype=float)
    zmu, zsd = Z.mean(axis=0), Z.std(axis=0)
    zsd[zsd == 0] = 1.0
    Zs = (Z - zmu) / zsd
    k = 3 if len(Zs) >= 30 else 2
    rng = np.random.default_rng(42)
    centers = Zs[rng.choice(len(Zs), size=k, replace=False)]
    labels = np.zeros(len(Zs), dtype=int)
    for _ in range(25):
        dist = ((Zs[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = dist.argmin(axis=1)
        for i in range(k):
            mask = labels == i
            if mask.any():
                centers[i] = Zs[mask].mean(axis=0)
    clusters = []
    for i in range(k):
        mask = labels == i
        if not mask.any():
            continue
        sub = df.loc[mask]
        top_und = sub["underlying"].value_counts().head(3).to_dict()
        clusters.append(
            {
                "id": i,
                "size": int(mask.sum()),
                "share": float(mask.mean()),
                "avgHour": float(sub["hour"].mean()),
                "avgDte": float(sub["dte_filled"].mean()),
                "avgPremium": float(sub["premium"].mean()),
                "cancelRate": float(sub["canceled"].mean()),
                "netCashflow": float(sub["cf"].sum()),
                "topUnderlyings": top_und,
                "blurb": (
                    f"Cluster {i + 1}: ~{int(round(sub['hour'].mean()))}:00 · "
                    f"DTE~{sub['dte_filled'].mean():.0f} · "
                    f"cancel {sub['canceled'].mean()*100:.0f}% · "
                    f"CF {sub['cf'].sum():+.0f}"
                ),
            }
        )

    by_hour = (
        df.groupby("hour")
        .agg(orders=("canceled", "size"), cancelRate=("canceled", "mean"), netCashflow=("cf", "sum"))
        .reset_index()
        .to_dict(orient="records")
    )
    by_dow = (
        df.groupby("dow")
        .agg(orders=("canceled", "size"), cancelRate=("canceled", "mean"), netCashflow=("cf", "sum"))
        .reset_index()
        .to_dict(orient="records")
    )

    return {
        "ok": True,
        "orderCount": int(len(df)),
        "cancelModel": {
            "target": "canceled_vs_not",
            "trainAccuracy": None if np.isnan(train_acc) else round(train_acc, 3),
            "testAccuracy": None if np.isnan(test_acc) else round(test_acc, 3),
            "featureImportance": importance[:8],
            "note": "Predicts cancel/reject from timing, size, DTE, underlying frequency — process signal, not a trade signal.",
        },
        "regime": regime,
        "clusters": clusters,
        "byHour": [
            {
                "hour": int(r["hour"]),
                "orders": int(r["orders"]),
                "cancelRate": float(r["cancelRate"]),
                "netCashflow": float(r["netCashflow"]),
            }
            for r in by_hour
        ],
        "byDow": [
            {
                "dow": int(r["dow"]),
                "orders": int(r["orders"]),
                "cancelRate": float(r["cancelRate"]),
                "netCashflow": float(r["netCashflow"]),
            }
            for r in by_dow
        ],
        "summary": {
            "overallCancelRate": float(df["canceled"].mean()),
            "filledShare": float(df["filled"].mean()),
            "debitShare": float(df["debit"].mean()),
            "medianPremium": float(df["premium"].median()),
            "medianDte": float(df["dte_filled"].median()),
            "netCashflow": float(df["cf"].sum()),
        },
        "disclaimer": "Descriptive process math on your order history only — never buy/sell advice.",
        "source": "python-numpy",
    }


@app.post("/options/history")
def options_history(req: OptionsHistoryRequest):
    return analyze_options_history(req.orders)


class QuotesRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)


@app.post("/quotes")
def quotes(req: QuotesRequest):
    """Last prices for alert/cron ticks — descriptive market data only."""
    try:
        import yfinance as yf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yfinance not installed") from exc

    wanted = [s.strip().upper() for s in req.symbols if s and str(s).strip()][:40]
    out = []
    for sym in wanted:
        yf_sym = "ES=F" if sym in {"ES", "/ES"} else sym
        try:
            t = yf.Ticker(yf_sym)
            price = None
            try:
                fast = t.fast_info
                price = float(getattr(fast, "last_price", None) or getattr(fast, "lastPrice", None) or 0) or None
            except Exception:
                price = None
            if price is None:
                hist = t.history(period="5d", interval="1d")
                if hist is not None and not hist.empty:
                    price = float(hist["Close"].iloc[-1])
            if price is not None and price > 0:
                out.append({"symbol": sym, "yf": yf_sym, "price": price})
        except Exception as exc:
            out.append({"symbol": sym, "yf": yf_sym, "error": str(exc)})
    return {"quotes": out, "source": "yfinance", "updatedAt": pd.Timestamp.now("UTC").isoformat()}


SECTOR_HEATMAP = [
    {"symbol": "XLK", "name": "Technology", "group": "sector"},
    {"symbol": "XLF", "name": "Financials", "group": "sector"},
    {"symbol": "XLE", "name": "Energy", "group": "sector"},
    {"symbol": "XLV", "name": "Health Care", "group": "sector"},
    {"symbol": "XLI", "name": "Industrials", "group": "sector"},
    {"symbol": "XLY", "name": "Cons. Disc.", "group": "sector"},
    {"symbol": "XLP", "name": "Cons. Staples", "group": "sector"},
    {"symbol": "XLU", "name": "Utilities", "group": "sector"},
    {"symbol": "XLB", "name": "Materials", "group": "sector"},
    {"symbol": "XLRE", "name": "Real Estate", "group": "sector"},
    {"symbol": "XLC", "name": "Comm. Services", "group": "sector"},
    {"symbol": "SMH", "name": "Semiconductors", "group": "theme"},
    {"symbol": "XBI", "name": "Biotech", "group": "theme"},
    {"symbol": "KRE", "name": "Regional Banks", "group": "theme"},
    {"symbol": "XOP", "name": "Oil & Gas E&P", "group": "theme"},
    {"symbol": "ITA", "name": "Aerospace/Def", "group": "theme"},
    {"symbol": "SOXL", "name": "3x Semi Bull", "group": "levered"},
    {"symbol": "SOXS", "name": "3x Semi Bear", "group": "levered"},
    {"symbol": "TQQQ", "name": "3x Nasdaq Bull", "group": "levered"},
    {"symbol": "SQQQ", "name": "3x Nasdaq Bear", "group": "levered"},
    {"symbol": "TSLL", "name": "2x Tesla", "group": "levered"},
    {"symbol": "LABD", "name": "3x Biotech Bear", "group": "levered"},
]

INDEX_SNAP = [
    {"symbol": "SPY", "name": "S&P 500", "group": "index"},
    {"symbol": "QQQ", "name": "Nasdaq 100", "group": "index"},
    {"symbol": "IWM", "name": "Russell 2000", "group": "index"},
    {"symbol": "DIA", "name": "Dow", "group": "index"},
    {"symbol": "^VIX", "name": "VIX", "group": "vol", "display": "VIX"},
]


def _df_records(df: pd.DataFrame, index_as: str | None = None) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []
    work = df.reset_index()
    if index_as and work.columns[0] != index_as:
        work = work.rename(columns={work.columns[0]: index_as})
    rows = []
    for _, row in work.iterrows():
        item: dict[str, Any] = {}
        for col, val in row.items():
            key = str(col)
            if pd.isna(val):
                item[key] = None
            elif hasattr(val, "isoformat"):
                item[key] = val.isoformat()
            elif isinstance(val, (np.integer,)):
                item[key] = int(val)
            elif isinstance(val, (np.floating, float)):
                item[key] = float(val)
            else:
                item[key] = str(val) if not isinstance(val, (str, int, float, bool)) else val
        rows.append(item)
    return rows


def _quote_block(yf: Any, meta: dict[str, Any]) -> dict[str, Any]:
    sym = meta["symbol"]
    display = meta.get("display") or sym.replace("^", "")
    try:
        t = yf.Ticker(sym)
        hist = t.history(period="10d", interval="1d")
        if hist is None or hist.empty:
            return {**meta, "display": display, "error": "No history"}
        closes = [float(x) for x in hist["Close"].tolist()]
        last = closes[-1]
        prev = closes[-2] if len(closes) > 1 else last
        change_pct = ((last / prev) - 1.0) * 100 if prev else 0.0
        week_pct = ((last / closes[0]) - 1.0) * 100 if closes[0] else 0.0
        high = float(hist["High"].iloc[-1])
        low = float(hist["Low"].iloc[-1])
        vol = float(hist["Volume"].iloc[-1]) if "Volume" in hist else 0.0
        return {
            **meta,
            "display": display,
            "price": last,
            "prevClose": prev,
            "changePct": change_pct,
            "weekChangePct": week_pct,
            "high": high,
            "low": low,
            "volume": vol,
            "spark": closes[-8:],
            "error": None,
        }
    except Exception as exc:
        return {**meta, "display": display, "error": str(exc)}


@app.get("/premarket")
def premarket_board(days: int = Query(7, ge=1, le=14)):
    """Premarket briefing: calendars + sector/theme heatmap quotes."""
    try:
        import yfinance as yf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yfinance not installed") from exc

    now = pd.Timestamp.now(tz="America/Chicago")
    day_key = now.strftime("%Y-%m-%d")
    start = now.normalize()
    end = start + pd.Timedelta(days=int(days))

    earnings: list[dict[str, Any]] = []
    economics: list[dict[str, Any]] = []
    ipos: list[dict[str, Any]] = []
    splits: list[dict[str, Any]] = []
    calendar_error = None
    try:
        cal = yf.Calendars(start.to_pydatetime(), end.to_pydatetime())
        earn_df = cal.get_earnings_calendar(limit=80, filter_most_active=True)
        earnings = _df_records(earn_df, index_as="Symbol")
        eco_df = cal.get_economic_events_calendar(limit=80)
        economics = _df_records(eco_df, index_as="Event")
        # Prefer US / major regions first
        us = [e for e in economics if str(e.get("Region") or "").upper() in {"US", "USA", "UNITED STATES"}]
        economics = (us + [e for e in economics if e not in us])[:60]
        try:
            ipos = _df_records(cal.get_ipo_info_calendar(limit=30), index_as="Symbol")
        except Exception:
            ipos = []
        try:
            splits = _df_records(cal.get_splits_calendar(limit=30), index_as="Symbol")
        except Exception:
            splits = []
    except Exception as exc:
        calendar_error = str(exc)

    heatmap = [_quote_block(yf, m) for m in SECTOR_HEATMAP]
    indices = [_quote_block(yf, m) for m in INDEX_SNAP]
    leaders = sorted(
        [h for h in heatmap if h.get("changePct") is not None and not h.get("error")],
        key=lambda x: float(x["changePct"]),
        reverse=True,
    )
    laggards = list(reversed(leaders))

    return {
        "ok": True,
        "dayKey": day_key,
        "timezone": "America/Chicago",
        "windowDays": days,
        "updatedAt": pd.Timestamp.now("UTC").isoformat(),
        "clock": now.strftime("%A, %B %d, %Y %I:%M %p %Z"),
        "indices": indices,
        "heatmap": heatmap,
        "leaders": leaders[:6],
        "laggards": laggards[:6],
        "earnings": earnings,
        "economics": economics,
        "ipos": ipos,
        "splits": splits,
        "calendarError": calendar_error,
        "note": "Descriptive market briefing only — not trade advice. Write before you act.",
        "source": "yfinance",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=False)
