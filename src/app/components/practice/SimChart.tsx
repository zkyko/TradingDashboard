"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { LiquidityWall, SimBar } from "@/lib/sim/engine";

export default function SimChart({
  bars,
  vwap,
  walls,
  showVwap,
  showWalls,
  height = 440,
}: {
  bars: SimBar[];
  vwap: number;
  walls: LiquidityWall[];
  showVwap: boolean;
  showWalls: boolean;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 640,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(148, 163, 184, 0.85)",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: "#334155" },
        vertLine: { labelBackgroundColor: "#334155" },
      },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const vwapLine = chart.addSeries(LineSeries, {
      color: "#38bdf8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleRef.current = candle;
    vwapRef.current = vwapLine;

    const syncSize = () => {
      if (!hostRef.current) return;
      const w = hostRef.current.clientWidth;
      if (w > 0) chart.applyOptions({ width: w, height });
    };
    const ro = new ResizeObserver(syncSize);
    ro.observe(el);
    syncSize();
    requestAnimationFrame(() => {
      syncSize();
      chart.timeScale().fitContent();
    });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      vwapRef.current = null;
      linesRef.current = [];
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const vwapSeries = vwapRef.current;
    if (!chart || !candle) return;

    const candleData = bars
      .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close))
      .map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    candle.setData(candleData);

    if (vwapSeries) {
      if (showVwap && candleData.length) {
        vwapSeries.setData(
          candleData.map((b) => ({
            time: b.time,
            value: vwap,
          })),
        );
      } else {
        vwapSeries.setData([]);
      }
    }

    for (const line of linesRef.current) candle.removePriceLine(line);
    linesRef.current = [];
    if (showWalls) {
      for (const wall of walls.filter((w) => w.remaining > 0).slice(0, 8)) {
        linesRef.current.push(
          candle.createPriceLine({
            price: wall.price,
            color: wall.side === "bid" ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: wall.side === "bid" ? "DEMAND" : "SUPPLY",
          }),
        );
      }
    }

    chart.timeScale().scrollToRealTime();
  }, [bars, vwap, walls, showVwap, showWalls]);

  return <div ref={hostRef} className="w-full rounded-box" style={{ height }} />;
}
