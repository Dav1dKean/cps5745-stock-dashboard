
"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  BarChart3,
  CalendarDays,
  TrendingUp,
  RefreshCw,
  Info,
  AlertCircle,
} from "lucide-react";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
});

const API_URL = "";

const COMPANIES = [
  { ticker: "TMUS", name: "T-Mobile", color: "#e20074" },
  { ticker: "VZ", name: "Verizon", color: "#e11d48" },
  { ticker: "T", name: "AT&T", color: "#009fdb" },
];

const PERIODS = ["1M", "6M", "1Y", "5Y"];

// ---------------------------------------------------
// FINANCIAL CALCULATIONS
// ---------------------------------------------------

function average(values) {
  if (!values.length) return 0;

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function deviation(values) {
  if (values.length < 2) return 0;

  const mean = average(values);

  const variance =
    values.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) /
    (values.length - 1);

  return Math.sqrt(variance);
}

// Return YYYY-MM for the current month in New York.
function getCurrentMarketMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;

  return `${year}-${month}`;
}

// ---------------------------------------------------
// MONTHLY RETURNS — COMPLETED MONTHS ONLY
// ---------------------------------------------------

function calculateMonthlyReturns(dates, prices, currentMonth) {
  if (
    !Array.isArray(dates) ||
    !Array.isArray(prices) ||
    dates.length !== prices.length ||
    dates.length < 2
  ) {
    return [];
  }

  const months = [];

  // Find the last available trading observation
  // for every calendar month.
  for (let i = 0; i < dates.length; i++) {
    const month = dates[i].slice(0, 7);
    const previous = months.at(-1);

    if (previous && previous.month === month) {
      previous.endIndex = i;
    } else {
      months.push({
        month,
        endIndex: i,
      });
    }
  }

  const monthlyReturns = [];

  // We need the previous month's closing price,
  // so the first observed month is a baseline.
  for (let i = 1; i < months.length; i++) {
    const month = months[i].month;

    // Exclude the current calendar month
    // and any future months.
    if (month >= currentMonth) {
      continue;
    }

    const previousPrice =
      prices[months[i - 1].endIndex];

    const currentPrice =
      prices[months[i].endIndex];

    if (
      !Number.isFinite(previousPrice) ||
      !Number.isFinite(currentPrice) ||
      previousPrice <= 0
    ) {
      continue;
    }

    monthlyReturns.push({
      date: month,
      value:
        ((currentPrice / previousPrice) - 1) * 100,
    });
  }

  return monthlyReturns;
}

// ---------------------------------------------------
// ANALYZE A SINGLE COMPANY
// ---------------------------------------------------

function analyzeStock(company, raw, currentMonth) {
  const dates = raw.dates || [];
  const prices = raw.prices || [];

  if (
    prices.length < 2 ||
    dates.length !== prices.length
  ) {
    return null;
  }

  const returns = prices.slice(1).map(
    (price, index) =>
      ((price / prices[index]) - 1) * 100
  );

  const cumulative = prices.map(
    (price) =>
      ((price / prices[0]) - 1) * 100
  );

  const monthly = calculateMonthlyReturns(
    dates,
    prices,
    currentMonth
  );

  const totalReturn = cumulative.at(-1);

  const volatility =
    deviation(returns) * Math.sqrt(252);

  // Annualized return, based on trading observations.
  const annualReturn =
    (
      Math.pow(
        prices.at(-1) / prices[0],
        252 / (prices.length - 1)
      ) - 1
    ) * 100;

  return {
    ...company,
    dates,
    prices,
    returns,
    cumulative,
    monthly,
    volumes: raw.volumes || [],
    latestDate: raw.latest_date,
    latestPrice: raw.latest_price,
    totalReturn,
    volatility,
    annualReturn,
  };
}

// ---------------------------------------------------
// CHART COMPONENT
// ---------------------------------------------------

function ChartCard({ chart, index, layout, config }) {
  const hasData = chart.data.some(
    (trace) =>
      Array.isArray(trace.y) && trace.y.length > 0
  );

  return (
    <section
      className={`min-w-0 rounded-xl border border-slate-200
        bg-white p-5 shadow-sm ${
          index === 0 ? "xl:col-span-2" : ""
        }`}
    >
      <div className="mb-3">
        <h3 className="text-lg font-bold">
          {chart.title}
        </h3>

        <p className="mt-1 text-xs text-slate-500">
          {chart.description}
        </p>
      </div>

      {!hasData ? (
        <div className="flex h-[350px] items-center justify-center rounded-lg bg-slate-50 px-6 text-center text-sm text-slate-500">
          No completed monthly comparison is available
          for this date range. Try selecting a longer period.
        </div>
      ) : (
        <Plot
          data={chart.data}
          layout={{
            ...layout,
            height: 350,
            barmode: chart.barmode,
            xaxis: {
              ...layout.xaxis,
              title: {
                text: chart.xaxis,
              },
            },
            yaxis: {
              ...layout.yaxis,
              title: {
                text: chart.yaxis,
              },
            },
          }}
          config={config}
          useResizeHandler
          style={{
            width: "100%",
            height: "350px",
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------
// MAIN DASHBOARD
// ---------------------------------------------------

export default function Home() {
  const [selected, setSelected] = useState([
    "TMUS",
    "VZ",
    "T",
  ]);

  const [period, setPeriod] = useState("1Y");

  const [stockData, setStockData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const currentMonth = getCurrentMarketMonth();

  // -------------------------------------------------
  // FETCH REAL STOCK DATA FROM PYTHON
  // -------------------------------------------------

  useEffect(() => {
    const controller = new AbortController();

    async function fetchStocks() {
      setLoading(true);
      setError("");
      setStockData(null);

      try {
        const response = await fetch(
          `${API_URL}/api/stocks?period=${period}`,
          {
            signal: controller.signal,
            cache: "no-store",
          }
        );

        if (!response.ok) {
          let message = `API error: ${response.status}`;

          try {
            const details = await response.json();
            message = details.detail || message;
          } catch {
            // Keep original HTTP error.
          }

          throw new Error(message);
        }

        const result = await response.json();

        if (!result.companies) {
          throw new Error(
            "The API response contains no stock data."
          );
        }

        setStockData(result);
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err.message || "Unable to load stock data."
        );

        setStockData(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchStocks();

    return () => controller.abort();
  }, [period, refreshKey]);

  // -------------------------------------------------
  // SHARED COMPANY FILTER
  // -------------------------------------------------

  const datasets = useMemo(() => {
    if (!stockData?.companies) return [];

    return COMPANIES.filter((company) =>
      selected.includes(company.ticker)
    )
      .map((company) => {
        const raw =
          stockData.companies[company.ticker];

        return raw
          ? analyzeStock(company, raw, currentMonth)
          : null;
      })
      .filter(Boolean);
  }, [stockData, selected, currentMonth]);

  function toggleCompany(ticker) {
    setSelected((current) => {
      if (current.includes(ticker)) {
        return current.length > 1
          ? current.filter(
              (item) => item !== ticker
            )
          : current;
      }

      return [...current, ticker];
    });
  }

  // -------------------------------------------------
  // PLOTLY CONFIGURATION
  // -------------------------------------------------

  const commonLayout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: "#475569",
      size: 11,
    },
    margin: {
      l: 70,
      r: 30,
      t: 25,
      b: 70,
    },
    hovermode: "closest",
    autosize: true,
    legend: {
      orientation: "h",
      y: -0.35,
    },
    xaxis: {
      gridcolor: "#f1f5f9",
      automargin: true,
    },
    yaxis: {
      gridcolor: "#e2e8f0",
      zeroline: false,
      automargin: true,
    },
  };

  const plotConfig = {
    responsive: true,
    displaylogo: false,
  };

  // -------------------------------------------------
  // FIVE COMPARISON VISUALIZATIONS
  // -------------------------------------------------

  const charts = [
    {
      title: "1. Historical Adjusted Stock Prices",
      description:
        "Dividend- and split-adjusted closing price (USD)",
      xaxis: "Trading Date",
      yaxis: "Adjusted Price (USD)",
      data: datasets.map((company) => ({
        x: company.dates,
        y: company.prices,
        type: "scatter",
        mode: "lines",
        name: company.ticker,
        line: {
          color: company.color,
          width: 2.5,
        },
        hovertemplate:
          "%{x}<br>$%{y:.2f}<extra>%{fullData.name}</extra>",
      })),
    },

    {
      title: "2. Cumulative Stock Returns",
      description:
        "Percentage performance relative to the first observation",
      xaxis: "Trading Date",
      yaxis: "Cumulative Return (%)",
      data: datasets.map((company) => ({
        x: company.dates,
        y: company.cumulative,
        type: "scatter",
        mode: "lines",
        name: company.ticker,
        line: {
          color: company.color,
          width: 2.5,
        },
        hovertemplate:
          "%{x}<br>%{y:.2f}%<extra>%{fullData.name}</extra>",
      })),
    },

    {
      title: "3. Monthly Stock Returns",
      description:
        "Completed calendar months only; month-end adjusted-price returns",
      xaxis: "Month",
      yaxis: "Monthly Return (%)",
      barmode: "group",
      data: datasets.map((company) => ({
        x: company.monthly.map(
          (month) => month.date
        ),
        y: company.monthly.map(
          (month) => month.value
        ),
        type: "bar",
        name: company.ticker,
        marker: {
          color: company.color,
        },
        hovertemplate:
          "%{x}<br>%{y:.2f}%<extra>%{fullData.name}</extra>",
      })),
    },

    {
      title: "4. Daily Return Distribution",
      description:
        "Box plot of daily percentage returns and outliers",
      xaxis: "Company",
      yaxis: "Daily Return (%)",
      data: datasets.map((company) => ({
        y: company.returns,
        type: "box",
        name: company.ticker,
        marker: {
          color: company.color,
        },
        line: {
          color: company.color,
        },
        boxpoints: "outliers",
      })),
    },

    {
      title: "5. Risk vs. Annualized Return",
      description:
        "Historical annualized volatility versus annualized return",
      xaxis: "Annualized Volatility (%)",
      yaxis: "Annualized Return (%)",
      data: datasets.map((company) => ({
        x: [company.volatility],
        y: [company.annualReturn],
        type: "scatter",
        mode: "markers+text",
        text: [company.ticker],
        textposition: "top center",
        name: company.ticker,
        marker: {
          color: company.color,
          size: 19,
        },
        hovertemplate:
          "Volatility: %{x:.2f}%<br>" +
          "Annualized Return: %{y:.2f}%" +
          "<extra>%{fullData.name}</extra>",
      })),
    },
  ];

  // -------------------------------------------------
  // AUTOMATIC KEY FINDINGS
  // -------------------------------------------------

  const best = datasets.length
    ? [...datasets].sort(
        (a, b) =>
          b.totalReturn - a.totalReturn
      )[0]
    : null;

  const highestRisk = datasets.length
    ? [...datasets].sort(
        (a, b) =>
          b.volatility - a.volatility
      )[0]
    : null;

  const lowestRisk = datasets.length
    ? [...datasets].sort(
        (a, b) =>
          a.volatility - b.volatility
      )[0]
    : null;

  const latestDate = datasets.length
    ? datasets
        .map((company) => company.latestDate)
        .filter(Boolean)
        .sort()
        .at(-1)
    : "Unavailable";

  // -------------------------------------------------
  // PAGE LAYOUT
  // -------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen flex-col lg:flex-row">

        {/* SIDEBAR */}
        <aside className="w-full bg-slate-950 p-7 text-white lg:w-72 lg:shrink-0">

          <div className="mb-10 flex items-center gap-3">
            <TrendingUp
              className="text-blue-400"
              size={30}
            />

            <div>
              <h1 className="text-xl font-bold">
                StockScope
              </h1>

              <p className="text-xs text-slate-400">
                Telecommunications Analytics
              </p>
            </div>
          </div>

          {/* COMPANY FILTER */}
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <BarChart3 size={17} />
              Compare Companies
            </div>

            {COMPANIES.map((company) => (
              <label
                key={company.ticker}
                className="mb-3 flex cursor-pointer items-center gap-3 rounded-lg bg-slate-900 p-3"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(
                    company.ticker
                  )}
                  onChange={() =>
                    toggleCompany(company.ticker)
                  }
                  className="h-4 w-4"
                />

                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    backgroundColor: company.color,
                  }}
                />

                <span className="text-sm">
                  {company.name} ({company.ticker})
                </span>
              </label>
            ))}

            <p className="text-xs text-slate-400">
              Select one or more companies.
            </p>
          </div>

          {/* DATE FILTER */}
          <div>
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <CalendarDays size={17} />
              Date Range
            </div>

            <div className="flex flex-wrap gap-2">
              {PERIODS.map((option) => (
                <button
                  key={option}
                  onClick={() => setPeriod(option)}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    period === option
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {/* REFRESH BUTTON */}
          <button
            onClick={() =>
              setRefreshKey((value) => value + 1)
            }
            disabled={loading}
            className="mt-8 flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={16} />
            Refresh Stock Data
          </button>

          <div className="mt-12 border-t border-slate-700 pt-6 text-xs text-slate-400">
            <p>David Vasquez</p>
            <p className="mt-1">
              Developed for CPS*5745
            </p>
          </div>
        </aside>

        {/* MAIN DASHBOARD */}
        <main className="min-w-0 flex-1 p-5 lg:p-9">

          {/* HEADER */}
          <div className="mb-6">
            <p className="mb-1 text-sm font-medium text-blue-600">
              Financial Analytics Dashboard
            </p>

            <h2 className="text-3xl font-bold">
              U.S. Telecommunications Stock Comparison
              - by David Vasquez for CPS*5745
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              T-Mobile · Verizon · AT&T
            </p>
          </div>

          {/* DATA SOURCE */}
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="flex items-center gap-2 font-semibold">
              <Info size={17} />
              Real Historical Stock Data
            </div>

            <p className="mt-1">
              Source: Yahoo Finance via Python yfinance.
              Prices are adjusted for corporate actions.
              Market information may be delayed.
            </p>

            <p className="mt-1">
              Latest available trading date:{" "}
              <strong>
                {loading
                  ? "Loading..."
                  : latestDate}
              </strong>
            </p>
          </div>

          {/* ERROR DISPLAY */}
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-5 text-red-800">
              <AlertCircle size={21} />

              <div>
                <h3 className="font-semibold">
                  Unable to retrieve stock data
                </h3>

                <p className="mt-1 text-sm">
                  {error}
                </p>

                <p className="mt-2 text-sm">
                  Verify the Python API is running
                  and the API URL is correct.
                </p>
              </div>
            </div>
          )}

          {/* SUMMARY INDICATORS */}
          <div className="mb-7 grid gap-4 md:grid-cols-3">
            {[
              {
                label: "Companies Selected",
                value: selected.length,
              },
              {
                label: "Date Range",
                value: period,
              },
              {
                label: "Comparison Charts",
                value: 5,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm text-slate-500">
                  {stat.label}
                </p>

                <p className="mt-2 text-3xl font-bold">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* LOADING */}
          {loading && (
            <div className="rounded-xl bg-white p-12 text-center shadow-sm">
              <RefreshCw
                size={30}
                className="mx-auto mb-4 animate-spin text-blue-600"
              />

              <p className="font-semibold">
                Retrieving market data...
              </p>

              <p className="mt-2 text-sm text-slate-500">
                Loading adjusted stock prices
                and calculating comparisons.
              </p>
            </div>
          )}

          {/* INTERACTIVE CHARTS */}
          {!loading &&
            !error &&
            datasets.length > 0 && (
              <>
                <div className="grid gap-5 xl:grid-cols-2">
                  {charts.map((chart, index) => (
                    <ChartCard
                      key={chart.title}
                      chart={chart}
                      index={index}
                      layout={commonLayout}
                      config={plotConfig}
                    />
                  ))}
                </div>

                {/* KEY FINDINGS */}
                <div className="mt-7 rounded-xl border border-slate-200 bg-white p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <Activity
                      size={20}
                      className="text-blue-600"
                    />

                    <h3 className="text-lg font-bold">
                      Key Findings
                    </h3>
                  </div>

                  <div className="space-y-3 text-sm leading-7 text-slate-600">
                    <p>
                      <strong>
                        Best historical performance:
                      </strong>{" "}
                      {best.name} ({best.ticker})
                      recorded an adjusted-price
                      cumulative return of{" "}
                      {best.totalReturn.toFixed(2)}%
                      during the selected period.
                    </p>

                    <p>
                      <strong>
                        Highest volatility:
                      </strong>{" "}
                      {highestRisk.name} (
                      {highestRisk.ticker})
                      had an annualized daily-return
                      volatility of{" "}
                      {highestRisk.volatility.toFixed(2)}%.
                    </p>

                    <p>
                      <strong>
                        Lowest volatility:
                      </strong>{" "}
                      {lowestRisk.name} (
                      {lowestRisk.ticker})
                      had an annualized daily-return
                      volatility of{" "}
                      {lowestRisk.volatility.toFixed(2)}%.
                    </p>

                    <p>
                      These measurements describe
                      historical adjusted-price
                      performance and risk.
                      They do not predict future returns.
                    </p>
                  </div>
                </div>
              </>
            )}

          {/* FOOTER */}
          <footer className="py-7 text-center text-sm text-slate-500">
            David Vasquez — Developed for CPS*5745
          </footer>
        </main>
      </div>
    </div>
  );
}
