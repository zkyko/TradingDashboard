"use client";

import { useEffect, useState } from "react";
import LiveCandleChart from "@/app/components/watch/LiveCandleChart";
import type { LiveBar } from "@/lib/python-service";

/** Compact candle chart for morning/setup cards. Uses stored bars or lazy-loads from live board. */
export default function SetupTapeChart({
  symbol,
  bars,
  vpLevels,
  height = 200,
}: {
  symbol: string;
  bars?: LiveBar[];
  vpLevels?: { val?: number | null; poc?: number | null; vah?: number | null } | null;
  height?: number;
}) {
  const [tape, setTape] = useState<LiveBar[]>(bars || []);

  useEffect(() => {
    if (bars?.length) {
      setTape(bars);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/watchlist/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ interval: "15m", symbols: [symbol], includeMl: false }),
        });
        const body = await response.json();
        const row = body.symbols?.[0];
        if (!cancelled && row?.bars?.length) setTape(row.bars as LiveBar[]);
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, bars]);

  if (!tape.length) {
    return (
      <div className="setup-tape-chart setup-tape-empty muted" style={{ height }}>
        Chart…
      </div>
    );
  }

  return (
    <div className="setup-tape-chart" style={{ height }}>
      <LiveCandleChart bars={tape} vpLevels={vpLevels} height={height} />
    </div>
  );
}
