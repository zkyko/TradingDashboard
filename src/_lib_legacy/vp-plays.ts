import type { LiveSymbolTape, VpSnapshot } from "@/lib/python-service";

export type VpPlay = {
  id: string;
  name: string;
  status: "live" | "forming" | "fading";
  bias: "balance" | "initiative_up" | "initiative_down" | "mean_revert" | "breakout_watch";
  heat: number; // 1–100
  tfs: string[];
  thesis: string;
  watch: string;
  invalidation: string;
  tagline: string;
};

function pos(snap: VpSnapshot | undefined | null) {
  return snap?.position || "unknown";
}

function has(snap: VpSnapshot | undefined | null) {
  return Boolean(snap && snap.poc != null && snap.val != null && snap.vah != null);
}

function nearEdge(p: string) {
  return p === "at_val" || p === "at_vah" || p === "at_poc" || p === "below_val" || p === "above_vah";
}

/** Creative but descriptive VP playbook — watch conditions, not orders. */
export function deriveVpPlays(tape: LiveSymbolTape): VpPlay[] {
  const profiles = tape.profiles || {};
  const daily = profiles.daily;
  const weekly = profiles.weekly;
  const d1 = profiles["1d"];
  const m10 = profiles["10m"];
  const m15 = profiles["15m"];
  const m30 = profiles["30m"];
  const rsi = tape.analysis?.last?.rsi ?? null;
  const vol = tape.analysis?.last?.volRatio ?? null;
  const price = tape.last?.close ?? null;
  const plays: VpPlay[] = [];

  const dPos = pos(daily);
  const wPos = pos(weekly);
  const p1 = pos(d1);
  const iPos = pos(m15) !== "unknown" ? pos(m15) : pos(m30);

  // --- VAL spring / poor auction low ---
  if (has(daily) && (dPos === "at_val" || dPos === "below_val")) {
    const stacked = wPos === "at_val" || wPos === "below_val" || p1 === "at_val";
    plays.push({
      id: "val-spring",
      name: stacked ? "Stacked VAL Spring" : "Daily VAL Spring",
      status: dPos === "at_val" ? "live" : "forming",
      bias: "mean_revert",
      heat: stacked ? 88 : dPos === "at_val" ? 76 : 62,
      tfs: ["daily", ...(stacked ? ["weekly"] : []), ...(rsi != null && rsi < 35 ? ["rsi"] : [])],
      tagline: "Auction probing the low-volume shelf",
      thesis: stacked
        ? "Price is leaning on overlapping daily/weekly value-area lows — a classic place traders journal a responsive bounce thesis if the shelf holds."
        : "Price is at/under daily VAL. Responsive buyers often show up here; initiative sellers try to accept lower.",
      watch: "Reclaim of VAL with rising intraday volume, then rotation toward daily POC.",
      invalidation: "Session closes accepted below VAL with expanding volume (failed defense).",
    });
  }

  // --- VAH rejection / breakout ---
  if (has(daily) && (dPos === "at_vah" || dPos === "above_vah")) {
    const stretch = wPos === "above_vah" || p1 === "above_vah";
    plays.push({
      id: dPos === "above_vah" ? "vah-acceptance" : "vah-test",
      name: dPos === "above_vah"
        ? stretch ? "Multi-TF VAH Escape" : "Daily VAH Acceptance Watch"
        : "VAH Rejection Probe",
      status: dPos === "at_vah" ? "live" : stretch ? "live" : "forming",
      bias: dPos === "above_vah" ? "breakout_watch" : "mean_revert",
      heat: stretch ? 90 : dPos === "at_vah" ? 74 : 58,
      tfs: ["daily", ...(stretch ? ["weekly"] : [])],
      tagline: dPos === "above_vah" ? "Price discovering above value" : "Testing the upper edge of value",
      thesis: dPos === "above_vah"
        ? "Trading above VAH means the market left balance. The journal question is acceptance (hold above) vs failed auction (snap back into VA)."
        : "Touching VAH is where balance often rejects. Watch whether price gets rejected into the VA or punches through.",
      watch: dPos === "above_vah"
        ? "Hold above VAH on the next 15–30m closes; POC becomes magnet only if acceptance fails."
        : "Wick rejection at VAH + return inside VA toward POC.",
      invalidation: dPos === "above_vah"
        ? "Back inside the daily VA and lose POC."
        : "Clean acceptance above VAH with rising volume.",
    });
  }

  // --- POC magnet ---
  if (has(daily) && daily?.poc != null && price != null) {
    const vaWidth = Math.max(Math.abs((daily.vah ?? daily.poc) - (daily.val ?? daily.poc)), 1e-9);
    const dist = Math.abs(price - daily.poc) / vaWidth;
    if (dist > 0.35 && (dPos === "inside_va" || dPos === "at_vah" || dPos === "at_val")) {
      plays.push({
        id: "poc-magnet",
        name: "POC Magnet",
        status: dist > 0.55 ? "live" : "forming",
        bias: "mean_revert",
        heat: Math.min(92, Math.round(50 + dist * 50)),
        tfs: ["daily"],
        tagline: "Fair price gravity inside the profile",
        thesis: `Price is ~${(dist * 100).toFixed(0)}% of VA width away from daily POC. In balanced conditions, POC often acts like a magnet for unfinished business.`,
        watch: "Mean-reversion rotation from the VA edge back through mid toward POC.",
        invalidation: "Initiative drive that expands VA (new highs/lows with volume) instead of rotating.",
      });
    }
  }

  // --- Balance box / VA rotation ---
  if (dPos === "inside_va" && (iPos === "inside_va" || iPos === "at_poc")) {
    plays.push({
      id: "va-rotation",
      name: "Value-Area Rotation",
      status: "forming",
      bias: "balance",
      heat: vol != null && vol < 0.85 ? 55 : 48,
      tfs: ["daily", "15m"],
      tagline: "Balance — fades over breaks until proven otherwise",
      thesis: "Price is rotating inside daily value. This is inventory digestion territory: range ideas over trend until an edge breaks with volume.",
      watch: "Fade tests of VAL/VAH while mid-VA/POC holds as pivot.",
      invalidation: "Closing outside VA on rising vol — balance → imbalance.",
    });
  }

  // --- Weekly vs daily migration ---
  if (has(daily) && has(weekly) && daily.poc != null && weekly.poc != null) {
    if (dPos === "above_vah" && wPos !== "above_vah") {
      plays.push({
        id: "profile-migration-up",
        name: "Profile Migration ↑",
        status: "live",
        bias: "initiative_up",
        heat: 84,
        tfs: ["daily", "weekly"],
        tagline: "Daily left value while weekly hasn't confirmed",
        thesis: "Daily auction is ahead of the weekly profile — early migration. Either weekly catches up (trend continuation story) or daily fails back into the larger box.",
        watch: "Daily holds above its VAH while weekly profile climbs / price approaches weekly VAH.",
        invalidation: "Daily loses VAH and returns to weekly mid-value.",
      });
    }
    if (dPos === "below_val" && wPos !== "below_val") {
      plays.push({
        id: "profile-migration-down",
        name: "Profile Migration ↓",
        status: "live",
        bias: "initiative_down",
        heat: 84,
        tfs: ["daily", "weekly"],
        tagline: "Daily broke lower before weekly accepted",
        thesis: "Daily is advertising lower value before the weekly profile agrees. That's either the start of a weekly reprice or a trap under daily VAL.",
        watch: "Continuation under daily VAL toward weekly VAL, or swift reclaim (failed breakdown).",
        invalidation: "Reclaim daily VAL and reclaim daily POC same session.",
      });
    }
  }

  // --- Intraday / higher-TF confluence ---
  const edgeHits = [m10, m15, m30, daily, weekly].filter((s) => nearEdge(pos(s)));
  if (edgeHits.length >= 3) {
    const mostlyVal = [m15, daily, weekly].filter((s) => {
      const p = pos(s);
      return p === "at_val" || p === "below_val";
    }).length;
    const mostlyVah = [m15, daily, weekly].filter((s) => {
      const p = pos(s);
      return p === "at_vah" || p === "above_vah";
    }).length;
    plays.push({
      id: "tf-confluence",
      name: mostlyVal >= 2 ? "Confluence Shelf (VAL)" : mostlyVah >= 2 ? "Confluence Cap (VAH)" : "Multi-TF Edge Stack",
      status: "live",
      bias: mostlyVal >= 2 ? "mean_revert" : mostlyVah >= 2 ? "breakout_watch" : "balance",
      heat: 86 + Math.min(10, edgeHits.length),
      tfs: ["10m", "15m", "30m", "daily"].filter((tf) => nearEdge(pos(profiles[tf]))),
      tagline: "Several clocks ringing the same level family",
      thesis: "When intraday and higher-timeframe profiles stack at the same edge, the market is making a louder statement about that price. Journal which side is defending.",
      watch: "First reaction at the stacked edge, then whether the next profile period accepts or rejects.",
      invalidation: "Profiles desync — intraday leaves the edge while daily stays mid-VA.",
    });
  }

  // --- Excess / poor high-low vibe with RSI ---
  if ((dPos === "at_vah" || dPos === "above_vah") && rsi != null && rsi >= 70) {
    plays.push({
      id: "stretched-high",
      name: "Stretched Auction High",
      status: "forming",
      bias: "mean_revert",
      heat: 70,
      tfs: ["daily", "rsi"],
      tagline: "Upper edge + hot RSI",
      thesis: "VAH test with elevated RSI is a common place for unfinished excess — either a blow-off that sticks or a quick give-back into value.",
      watch: "Failure to hold above VAH on the next pullback low.",
      invalidation: "RSI cools while price remains accepted above VAH.",
    });
  }
  if ((dPos === "at_val" || dPos === "below_val") && rsi != null && rsi <= 30) {
    plays.push({
      id: "stretched-low",
      name: "Stretched Auction Low",
      status: "forming",
      bias: "mean_revert",
      heat: 70,
      tfs: ["daily", "rsi"],
      tagline: "Lower edge + washed RSI",
      thesis: "VAL + oversold RSI is the mirror image: responsive inventory often appears, but initiative can keep pressing if value is migrating down.",
      watch: "VAL reclaim candle with volume tapering on the sell.",
      invalidation: "New lows on expanding volume after the RSI dip.",
    });
  }

  // --- Single print / thin air above weekly (initiative) ---
  if (has(weekly) && has(daily) && wPos === "above_vah" && dPos === "above_vah") {
    plays.push({
      id: "thin-air",
      name: "Thin Air Above Value",
      status: "live",
      bias: "initiative_up",
      heat: 80,
      tfs: ["daily", "weekly"],
      tagline: "Both clocks outside the box",
      thesis: "Price is discovering outside both daily and weekly value. Trend days are born here — so are vicious reversions when the auction rejects the new territory.",
      watch: "Pullback that holds prior VAH as support (now a shelf).",
      invalidation: "Lose prior VAH and close back inside weekly VA.",
    });
  }

  // --- Overnight / session unfinished (intraday at POC while daily at edge) ---
  if (iPos === "at_poc" && (dPos === "at_val" || dPos === "at_vah")) {
    plays.push({
      id: "composite-pivot",
      name: "Composite Pivot",
      status: "forming",
      bias: "balance",
      heat: 64,
      tfs: ["15m", "daily"],
      tagline: "Intraday fair price vs daily edge",
      thesis: "Short-term POC is acting as a hinge while the daily edge frames the larger story. Good for journaling 'which timeframe am I actually trading?'",
      watch: "Whether 15m POC breaks in the direction of the daily edge or snaps back.",
      invalidation: "Intraday profile rebuilds mid-VA and daily edge goes quiet.",
    });
  }

  // Fallback narrative so every ticker has something useful
  if (!plays.length && has(daily)) {
    plays.push({
      id: "map-only",
      name: "Profile Map — No Edge Yet",
      status: "fading",
      bias: "balance",
      heat: 28,
      tfs: ["daily"],
      tagline: "Waiting for the auction to speak",
      thesis: "No sharp VAL/VAH/POC story right now. The useful work is marking daily VAL / POC / VAH and waiting for price to advertise an edge.",
      watch: "First touch of daily VAL or VAH with a volume spike.",
      invalidation: "n/a — stand down until an edge prints.",
    });
  }

  return plays.sort((a, b) => b.heat - a.heat).slice(0, 4);
}

export function boardPlayRadar(tapes: LiveSymbolTape[]) {
  const rows: Array<VpPlay & { symbol: string }> = [];
  for (const tape of tapes) {
    if (tape.error) continue;
    for (const play of deriveVpPlays(tape).slice(0, 2)) {
      rows.push({ ...play, symbol: tape.symbol });
    }
  }
  return rows.sort((a, b) => b.heat - a.heat).slice(0, 8);
}
