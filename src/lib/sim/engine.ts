/** Seeded PRNG (mulberry32) for replayable sessions */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) || 1) >>> 0;
}

const TICKERS = ["ZXLV", "NVOL", "QTRX", "BLNK", "ORBT", "KLYR", "PULS", "DRFT"];

export type SimBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SimNews = {
  id: string;
  t: number;
  headline: string;
  bias: "bull" | "bear" | "neutral";
  intensity: number;
};

export type LiquidityWall = {
  id: string;
  side: "bid" | "ask";
  price: number;
  size: number;
  remaining: number;
};

export type SimSnapshot = {
  ticker: string;
  seed: number;
  time: number;
  price: number;
  bid: number;
  ask: number;
  lastVolume: number;
  sessionVolume: number;
  vwap: number;
  bars: SimBar[];
  forming: SimBar | null;
  walls: LiquidityWall[];
  news: SimNews[];
  drift: number;
  vol: number;
};

type EngineOpts = {
  seed?: number;
  startPrice?: number;
  barSeconds?: number;
};

const NEWS_POOL: Array<{ headline: string; bias: SimNews["bias"]; intensity: number }> = [
  { headline: "Chip foundry delays reported — semis under pressure", bias: "bear", intensity: 1.4 },
  { headline: "AI spend guidance raised across cloud majors", bias: "bull", intensity: 1.6 },
  { headline: "Fed speakers lean hawkish into data week", bias: "bear", intensity: 1.1 },
  { headline: "Risk-on bid returns — leveraged products see inflows", bias: "bull", intensity: 1.3 },
  { headline: "Unexpected inventory build at distributors", bias: "bear", intensity: 1.2 },
  { headline: "Export restrictions talk cools — relief bounce", bias: "bull", intensity: 1.0 },
  { headline: "Macro desk: quiet tape, two-way flow", bias: "neutral", intensity: 0.4 },
  { headline: "Options expiry pin risk near round number", bias: "neutral", intensity: 0.6 },
  { headline: "Broker upgrade: sector overweight reinstated", bias: "bull", intensity: 1.2 },
  { headline: "Whisper of large seller in after-hours dark pool", bias: "bear", intensity: 1.5 },
  { headline: "Soft landing narrative firms — beta catch-up", bias: "bull", intensity: 1.1 },
  { headline: "Yield spike hits duration-sensitive growth", bias: "bear", intensity: 1.0 },
];

function pickTicker(rng: () => number) {
  return TICKERS[Math.floor(rng() * TICKERS.length)]!;
}

function gaussian(rng: () => number) {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class SimEngine {
  readonly seed: number;
  readonly ticker: string;
  readonly barSeconds: number;

  private rng: () => number;
  private time: number;
  private price: number;
  private drift = 0;
  private vol = 0.0018;
  private shockUntil = 0;
  private sessionVolume = 0;
  private notionalSum = 0;
  private volumeSum = 0;
  private bars: SimBar[] = [];
  private forming: SimBar | null = null;
  private walls: LiquidityWall[] = [];
  private news: SimNews[] = [];
  private nextNewsAt: number;
  private lastVolume = 0;
  private wallSeq = 0;
  private newsSeq = 0;

  constructor(opts: EngineOpts = {}) {
    this.seed = opts.seed ?? randomSeed();
    this.rng = createRng(this.seed);
    this.ticker = pickTicker(this.rng);
    this.barSeconds = opts.barSeconds ?? 60;
    const start = opts.startPrice ?? 110 + this.rng() * 40;
    this.price = +start.toFixed(2);
    const day = Math.floor(Date.now() / 1000 / 86400) * 86400;
    this.time = day + 14 * 3600;
    this.nextNewsAt = this.time + 45 + Math.floor(this.rng() * 90);
    this.seedWalls();
    this.bootstrapBars(40);
  }

  private seedWalls() {
    this.walls = [];
    for (let i = 0; i < 4; i++) {
      const below = this.price * (0.985 - i * 0.008 - this.rng() * 0.004);
      const above = this.price * (1.015 + i * 0.008 + this.rng() * 0.004);
      this.walls.push({
        id: `bid-${++this.wallSeq}`,
        side: "bid",
        price: +below.toFixed(2),
        size: 800 + Math.floor(this.rng() * 2200),
        remaining: 0,
      });
      this.walls.push({
        id: `ask-${++this.wallSeq}`,
        side: "ask",
        price: +above.toFixed(2),
        size: 800 + Math.floor(this.rng() * 2200),
        remaining: 0,
      });
    }
    for (const w of this.walls) w.remaining = w.size;
  }

  private bootstrapBars(n: number) {
    let px = this.price;
    let t = this.time - n * this.barSeconds;
    for (let i = 0; i < n; i++) {
      const open = px;
      let high = open;
      let low = open;
      let close = open;
      let vol = 0;
      for (let k = 0; k < 12; k++) {
        const step = gaussian(this.rng) * this.vol * px * 0.35;
        close = Math.max(0.5, close + step);
        high = Math.max(high, close);
        low = Math.min(low, close);
        vol += 40 + Math.floor(this.rng() * 180);
      }
      this.bars.push({
        time: t,
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume: vol,
      });
      this.notionalSum += ((high + low + close) / 3) * vol;
      this.volumeSum += vol;
      this.sessionVolume += vol;
      px = close;
      t += this.barSeconds;
    }
    this.price = px;
    this.time = t;
    this.forming = {
      time: this.time,
      open: this.price,
      high: this.price,
      low: this.price,
      close: this.price,
      volume: 0,
    };
  }

  get vwap() {
    return this.volumeSum > 0 ? this.notionalSum / this.volumeSum : this.price;
  }

  snapshot(): SimSnapshot {
    const spread = Math.max(0.01, this.price * 0.00035);
    return {
      ticker: this.ticker,
      seed: this.seed,
      time: this.time,
      price: +this.price.toFixed(2),
      bid: +(this.price - spread / 2).toFixed(2),
      ask: +(this.price + spread / 2).toFixed(2),
      lastVolume: this.lastVolume,
      sessionVolume: this.sessionVolume,
      vwap: +this.vwap.toFixed(2),
      bars: [...this.bars],
      forming: this.forming ? { ...this.forming } : null,
      walls: this.walls.map((w) => ({ ...w })),
      news: [...this.news].slice(-12),
      drift: this.drift,
      vol: this.vol,
    };
  }

  tick(): { closed: boolean; news: SimNews | null } {
    let newsEvent: SimNews | null = null;
    if (this.time >= this.nextNewsAt) {
      newsEvent = this.fireNews();
      this.nextNewsAt = this.time + 50 + Math.floor(this.rng() * 140);
    }

    const vwap = this.vwap;
    const revert = ((vwap - this.price) / this.price) * 0.08;
    const noise = gaussian(this.rng) * this.vol;
    let movePct = this.drift + revert + noise;
    movePct = this.applyWalls(movePct);

    if (this.time > this.shockUntil) {
      this.drift *= 0.92;
      this.vol = 0.0018 + (this.vol - 0.0018) * 0.96;
    }

    const prev = this.price;
    this.price = Math.max(0.5, this.price * (1 + movePct));
    this.price = +this.price.toFixed(2);

    const tickVol = Math.max(
      1,
      Math.floor((30 + this.rng() * 220) * (1 + Math.abs(movePct) * 80) * (this.vol / 0.0018)),
    );
    this.lastVolume = tickVol;
    this.sessionVolume += tickVol;
    this.notionalSum += this.price * tickVol;
    this.volumeSum += tickVol;
    this.time += 1;

    let closed = false;
    if (!this.forming) {
      this.forming = {
        time: Math.floor(this.time / this.barSeconds) * this.barSeconds,
        open: prev,
        high: this.price,
        low: this.price,
        close: this.price,
        volume: tickVol,
      };
    } else {
      this.forming.high = Math.max(this.forming.high, this.price);
      this.forming.low = Math.min(this.forming.low, this.price);
      this.forming.close = this.price;
      this.forming.volume += tickVol;
      const barStart = Math.floor(this.time / this.barSeconds) * this.barSeconds;
      if (barStart > this.forming.time) {
        this.bars.push({ ...this.forming });
        if (this.bars.length > 400) this.bars.shift();
        this.forming = {
          time: barStart,
          open: this.price,
          high: this.price,
          low: this.price,
          close: this.price,
          volume: 0,
        };
        closed = true;
        this.maybeRefreshWalls();
      }
    }

    return { closed, news: newsEvent };
  }

  private applyWalls(movePct: number): number {
    const next = this.price * (1 + movePct);
    for (const wall of this.walls) {
      if (wall.remaining <= 0) continue;
      if (wall.side === "ask" && this.price < wall.price && next >= wall.price) {
        const hit = 40 + Math.floor(this.rng() * 120);
        wall.remaining = Math.max(0, wall.remaining - hit);
        if (wall.remaining > 0) return movePct * 0.15 - Math.abs(movePct) * 0.4;
        return movePct + 0.0025 * (0.5 + this.rng());
      }
      if (wall.side === "bid" && this.price > wall.price && next <= wall.price) {
        const hit = 40 + Math.floor(this.rng() * 120);
        wall.remaining = Math.max(0, wall.remaining - hit);
        if (wall.remaining > 0) return movePct * 0.15 + Math.abs(movePct) * 0.4;
        return movePct - 0.0025 * (0.5 + this.rng());
      }
    }
    return movePct;
  }

  private maybeRefreshWalls() {
    if (this.rng() > 0.35) return;
    const alive = this.walls.filter((w) => w.remaining > w.size * 0.15);
    if (alive.length >= 5) return;
    const side: "bid" | "ask" = this.rng() > 0.5 ? "bid" : "ask";
    const dist = 0.01 + this.rng() * 0.025;
    const price =
      side === "bid"
        ? +(this.price * (1 - dist)).toFixed(2)
        : +(this.price * (1 + dist)).toFixed(2);
    const size = 700 + Math.floor(this.rng() * 2400);
    this.walls.push({
      id: `${side}-${++this.wallSeq}`,
      side,
      price,
      size,
      remaining: size,
    });
    if (this.walls.length > 10) this.walls.shift();
  }

  private fireNews(): SimNews {
    const item = NEWS_POOL[Math.floor(this.rng() * NEWS_POOL.length)]!;
    const intensity = item.intensity * (0.7 + this.rng() * 0.6);
    const event: SimNews = {
      id: `n-${++this.newsSeq}`,
      t: this.time,
      headline: item.headline,
      bias: item.bias,
      intensity,
    };
    this.news.push(event);
    if (this.news.length > 30) this.news.shift();

    if (item.bias === "bull") this.drift = 0.0009 * intensity;
    else if (item.bias === "bear") this.drift = -0.0009 * intensity;
    else this.drift *= 0.5;

    this.vol = Math.min(0.006, 0.0018 * (1 + intensity));
    this.shockUntil = this.time + Math.floor(25 + intensity * 40);

    for (const w of this.walls) {
      if (this.rng() < 0.25 * intensity) w.remaining = Math.floor(w.remaining * 0.4);
    }
    return event;
  }

  chartBars(): SimBar[] {
    if (!this.forming) return this.bars;
    return [...this.bars, this.forming];
  }
}
