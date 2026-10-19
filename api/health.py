
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import yfinance as yf

app = FastAPI(title="StockScope Stock Data API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

COMPANIES = {
    "TMUS": "T-Mobile",
    "VZ": "Verizon",
    "T": "AT&T",
}

PERIODS = {
    "1M": "1mo",
    "6M": "6mo",
    "1Y": "1y",
    "5Y": "5y",
}


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "StockScope"}


@app.get("/api/stocks")
def get_stocks(
    period: str = Query(default="1Y"),
):
    period = period.upper()

    if period not in PERIODS:
        raise HTTPException(
            status_code=400,
            detail="Invalid date range",
        )

    results = {}

    for ticker, name in COMPANIES.items():
        try:
            stock = yf.Ticker(ticker)

            history = stock.history(
                period=PERIODS[period],
                interval="1d",
                auto_adjust=True,
                actions=True,
            )

            if history.empty:
                raise ValueError("No stock data returned")

            history = history.dropna(subset=["Close"])

            dates = [
                date.strftime("%Y-%m-%d")
                for date in history.index
            ]

            prices = [
                round(float(value), 4)
                for value in history["Close"]
            ]

            volumes = [
                int(value) if pd.notna(value) else 0
                for value in history["Volume"]
            ]

            results[ticker] = {
                "name": name,
                "dates": dates,
                "prices": prices,
                "volumes": volumes,
                "latest_price": prices[-1],
                "latest_date": dates[-1],
            }

        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to retrieve {ticker} data: {exc}",
            )

    return {
        "source": "Yahoo Finance via yfinance",
        "price_type": "Auto-adjusted closing price",
        "period": period,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "companies": results,
    }
