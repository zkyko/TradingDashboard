"use client";

const ROWS = [
  { name: "RSI", purpose: "Momentum", interpretation: ">70 overbought zone · <30 oversold zone" },
  { name: "MACD", purpose: "Trend", interpretation: "Histogram polarity · signal crossovers" },
  { name: "Bollinger", purpose: "Volatility", interpretation: "Price vs upper/lower bands" },
  { name: "Moving averages", purpose: "Trend", interpretation: "Price vs SMA20 / SMA50 / SMA200" },
  { name: "Stochastic", purpose: "Momentum", interpretation: "%K / %D · >80 / <20 zones" },
  { name: "Volume", purpose: "Confirmation", interpretation: "Session volume vs 20-bar average" },
];

export default function IndicatorLegend() {
  return (
    <div className="indicator-legend">
      <p className="muted">Educational reference — zone labels, not trade advice.</p>
      <div className="mini-table">
        <div className="mini-row head"><span>Indicator</span><span>Purpose</span><span>Interpretation</span></div>
        {ROWS.map((row) => (
          <div className="mini-row legend-row" key={row.name}>
            <b>{row.name}</b>
            <span>{row.purpose}</span>
            <span>{row.interpretation}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
