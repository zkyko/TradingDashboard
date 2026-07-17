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
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { LiveBar, LivePoint } from "@/lib/python-service";

export type TimeZoom = { from: number; to: number };

export type VpLevels = {
  val?: number | null;
  poc?: number | null;
  vah?: number | null;
};

export default function LiveCandleChart({
  bars,
  sma20,
  vpLevels,
  height = 220,
  lockedZoom = null,
  onZoomLock,
}: {
  bars: LiveBar[];
  sma20?: LivePoint[];
  vpLevels?: VpLevels | null;
  height?: number;
  lockedZoom?: TimeZoom | null;
  onZoomLock?: (zoom: TimeZoom | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const applyingRef = useRef(false);
  const lockedRef = useRef<TimeZoom | null>(lockedZoom);
  const onZoomLockRef = useRef(onZoomLock);

  useEffect(() => {
    lockedRef.current = lockedZoom;
  }, [lockedZoom]);

  useEffect(() => {
    onZoomLockRef.current = onZoomLock;
  }, [onZoomLock]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || el.parentElement?.clientWidth || 320,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226, 232, 240, 0.72)",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: "#1e293b" },
        vertLine: { labelBackgroundColor: "#1e293b" },
      },
      autoSize: false,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const sma = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    candleRef.current = candle;
    smaRef.current = sma;

    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (applyingRef.current || !range) return;
      const from = typeof range.from === "number" ? range.from : null;
      const to = typeof range.to === "number" ? range.to : null;
      if (from == null || to == null) return;
      const zoom = { from, to };
      lockedRef.current = zoom;
      onZoomLockRef.current?.(zoom);
    });

    const syncSize = () => {
      if (!hostRef.current) return;
      const w = hostRef.current.clientWidth;
      const h = hostRef.current.clientHeight || height;
      if (w > 0) chart.applyOptions({ width: w, height: h });
    };
    const ro = new ResizeObserver(() => {
      syncSize();
    });
    ro.observe(el);
    // Layout may not be final on first paint (grid / tab panels).
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
      smaRef.current = null;
      linesRef.current = [];
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (lockedZoom) {
      lockedRef.current = lockedZoom;
      return;
    }
    lockedRef.current = null;
    applyingRef.current = true;
    chart.timeScale().fitContent();
    requestAnimationFrame(() => {
      applyingRef.current = false;
    });
  }, [lockedZoom]);

  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    const sma = smaRef.current;
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

    if (sma) {
      sma.setData(
        (sma20 || [])
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    }

    for (const line of linesRef.current) candle.removePriceLine(line);
    linesRef.current = [];
    const addLine = (price: number | null | undefined, color: string, title: string) => {
      if (price == null || !Number.isFinite(price)) return;
      linesRef.current.push(
        candle.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title,
        }),
      );
    };
    addLine(vpLevels?.val, "#38bdf8", "VAL");
    addLine(vpLevels?.poc, "#fbbf24", "POC");
    addLine(vpLevels?.vah, "#f472b6", "VAH");

    applyingRef.current = true;
    const lock = lockedRef.current;
    if (lock && candleData.length) {
      try {
        chart.timeScale().setVisibleRange({
          from: lock.from as Time,
          to: lock.to as Time,
        });
      } catch {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }
    requestAnimationFrame(() => {
      applyingRef.current = false;
    });
  }, [bars, sma20, vpLevels]);

  return <div className="live-chart" ref={hostRef} style={{ height, width: "100%" }} />;
}
