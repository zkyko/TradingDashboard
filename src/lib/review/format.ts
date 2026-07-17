import type { TiltState } from "@/lib/review/types";

export function money(n: number, digits = 0): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function pct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function pnlClass(n: number): string {
  if (n > 0) return "pnl-pos";
  if (n < 0) return "pnl-neg";
  return "pnl-flat";
}

export function tiltLabel(state: TiltState): string {
  switch (state) {
    case "calm":
      return "Calm";
    case "on_streak":
      return "On streak";
    case "chopping":
      return "Chopping";
    case "revenge_sizing":
      return "Revenge sizing";
    case "overnight_hungover":
      return "Overnight hungover";
    case "cooling_off":
      return "Cooling off";
    default:
      return state;
  }
}

export function tiltTone(state: TiltState): "ok" | "warn" | "bad" | "good" {
  switch (state) {
    case "calm":
      return "ok";
    case "on_streak":
      return "good";
    case "chopping":
    case "cooling_off":
      return "warn";
    case "revenge_sizing":
    case "overnight_hungover":
      return "bad";
    default:
      return "ok";
  }
}
