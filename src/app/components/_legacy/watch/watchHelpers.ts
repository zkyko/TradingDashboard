"use client";

export const PRESETS = ["AAPL", "TSLA", "GOOGL", "MSFT", "NVDA", "AMZN", "META", "SOXL", "TQQQ", "SQQQ"] as const;

export type Interval = "day" | "hour" | "10minute" | "5minute";
export type VpMode = "daily" | "session" | "visible";

export function stateTone(state: string | undefined): "win" | "loss" | "flat" | "" {
  if (!state) return "";
  if (["overbought", "above", "hist_pos", "high", "above_upper"].includes(state)) return "win";
  if (["oversold", "below", "hist_neg", "low", "below_lower"].includes(state)) return "loss";
  return "flat";
}

export function stateLabel(key: string, state: string | undefined): string {
  if (!state || state === "neutral" || state === "normal") return "—";
  const map: Record<string, string> = {
    overbought: "Overbought zone",
    oversold: "Oversold zone",
    above: "Above SMA20",
    below: "Below SMA20",
    hist_pos: "MACD hist +",
    hist_neg: "MACD hist −",
    high: "High vs avg vol",
    low: "Low vs avg vol",
    above_upper: "Above BB upper",
    below_lower: "Below BB lower",
  };
  return map[state] || `${key}: ${state}`;
}
