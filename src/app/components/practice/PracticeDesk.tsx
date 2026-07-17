"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimEngine, randomSeed, type SimNews, type SimSnapshot } from "@/lib/sim/engine";
import { PaperBook } from "@/lib/sim/paper";
import SimChart from "@/app/components/practice/SimChart";
import { money, pnlClass } from "@/lib/review/format";

type Speed = 1 | 2 | 4;

function formatClock(t: number) {
  return new Date(t * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

export default function PracticeDesk() {
  const engineRef = useRef<SimEngine | null>(null);
  const paperRef = useRef(new PaperBook());
  const [snap, setSnap] = useState<SimSnapshot | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<Speed>(1);
  const [showVwap, setShowVwap] = useState(true);
  const [showWalls, setShowWalls] = useState(true);
  const [size, setSize] = useState(10);
  const [flash, setFlash] = useState<SimNews | null>(null);
  const [paperTick, setPaperTick] = useState(0);

  const boot = useCallback((seed?: number) => {
    const engine = new SimEngine({ seed: seed ?? randomSeed() });
    engineRef.current = engine;
    paperRef.current = new PaperBook();
    setSnap(engine.snapshot());
    setFlash(null);
    setPaperTick((n) => n + 1);
    setRunning(true);
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (!running) return;
    const ms = Math.max(40, 220 / speed);
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const ticks = speed;
      let news: SimNews | null = null;
      for (let i = 0; i < ticks; i++) {
        const r = engine.tick();
        if (r.news) news = r.news;
      }
      setSnap(engine.snapshot());
      if (news) setFlash(news);
      setPaperTick((n) => n + 1);
    }, ms);
    return () => window.clearInterval(id);
  }, [running, speed]);

  const paper = useMemo(() => {
    const mark = snap?.price ?? 0;
    return paperRef.current.state(mark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.price, paperTick]);

  const bars = useMemo(() => {
    if (!snap) return [];
    return engineRef.current?.chartBars() ?? snap.bars;
  }, [snap]);

  if (!snap) {
    return (
      <div className="card bg-base-200 border border-base-300">
        <div className="card-body">Booting simulated tape…</div>
      </div>
    );
  }

  function act(kind: "long" | "short" | "flat") {
    const engine = engineRef.current;
    if (!engine) return;
    const px = engine.snapshot().price;
    const t = engine.snapshot().time;
    const book = paperRef.current;
    if (kind === "long") book.long(size, px, t);
    if (kind === "short") book.short(size, px, t);
    if (kind === "flat") book.flat(px, t);
    setPaperTick((n) => n + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-extrabold tracking-tight">{snap.ticker}</h2>
            <span className="badge badge-primary badge-outline">SIM</span>
            <span className="badge badge-ghost font-mono text-xs">seed {snap.seed}</span>
          </div>
          <p className="text-sm opacity-60 mt-1">
            Synthetic tape — news, liquidity walls, bursty volume. Structure is yours to read.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Resume"}
          </button>
          <div className="join">
            {([1, 2, 4] as Speed[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-sm join-item ${speed === s ? "btn-active" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => boot()}>
            New session
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="stat bg-base-200 border border-base-300 rounded-box py-3">
          <div className="stat-title text-xs">Last</div>
          <div className="stat-value text-2xl tabular-nums">{snap.price.toFixed(2)}</div>
          <div className="stat-desc font-mono">
            {snap.bid.toFixed(2)} × {snap.ask.toFixed(2)}
          </div>
        </div>
        <div className="stat bg-base-200 border border-base-300 rounded-box py-3">
          <div className="stat-title text-xs">VWAP</div>
          <div className="stat-value text-2xl tabular-nums">{snap.vwap.toFixed(2)}</div>
          <div className="stat-desc">Session</div>
        </div>
        <div className="stat bg-base-200 border border-base-300 rounded-box py-3">
          <div className="stat-title text-xs">Volume</div>
          <div className="stat-value text-2xl tabular-nums">{snap.sessionVolume.toLocaleString()}</div>
          <div className="stat-desc">Last tick {snap.lastVolume}</div>
        </div>
        <div className="stat bg-base-200 border border-base-300 rounded-box py-3">
          <div className="stat-title text-xs">Unrealized</div>
          <div className={`stat-value text-2xl tabular-nums ${pnlClass(paper.unrealized)}`}>
            {money(paper.unrealized, 2)}
          </div>
          <div className="stat-desc">
            {paper.side === "flat"
              ? "Flat"
              : `${paper.side.toUpperCase()} ${paper.qty} @ ${paper.avgEntry.toFixed(2)}`}
          </div>
        </div>
        <div className="stat bg-base-200 border border-base-300 rounded-box py-3">
          <div className="stat-title text-xs">Realized</div>
          <div className={`stat-value text-2xl tabular-nums ${pnlClass(paper.realized)}`}>
            {money(paper.realized, 2)}
          </div>
          <div className="stat-desc">Session · {formatClock(snap.time)} UTC</div>
        </div>
      </div>

      {flash ? (
        <div
          className={`alert text-sm ${
            flash.bias === "bull" ? "alert-success" : flash.bias === "bear" ? "alert-error" : "alert-info"
          }`}
        >
          <span className="font-bold uppercase text-xs tracking-wide">{flash.bias}</span>
          <span>{flash.headline}</span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="card bg-base-200 border border-base-300 shadow-sm xl:col-span-3">
          <div className="card-body gap-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 className="font-bold tracking-tight">1m tape</h3>
              <div className="flex flex-wrap gap-3 text-xs">
                <label className="label cursor-pointer gap-2 py-0">
                  <input
                    type="checkbox"
                    className="toggle toggle-xs toggle-info"
                    checked={showVwap}
                    onChange={(e) => setShowVwap(e.target.checked)}
                  />
                  <span className="label-text text-xs">VWAP</span>
                </label>
                <label className="label cursor-pointer gap-2 py-0">
                  <input
                    type="checkbox"
                    className="toggle toggle-xs toggle-warning"
                    checked={showWalls}
                    onChange={(e) => setShowWalls(e.target.checked)}
                  />
                  <span className="label-text text-xs">Supply / demand</span>
                </label>
              </div>
            </div>
            <SimChart
              bars={bars}
              vwap={snap.vwap}
              walls={snap.walls}
              showVwap={showVwap}
              showWalls={showWalls}
            />
          </div>
        </section>

        <div className="xl:col-span-2 space-y-4">
          <section className="card bg-base-200 border border-base-300 shadow-sm">
            <div className="card-body gap-3 p-4">
              <h3 className="font-bold tracking-tight">Paper pad</h3>
              <label className="form-control w-full">
                <span className="label-text text-xs opacity-60 mb-1">Size (shares)</span>
                <input
                  type="number"
                  min={1}
                  className="input input-bordered input-sm w-full"
                  value={size}
                  onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="btn btn-success btn-sm" onClick={() => act("long")}>
                  Long
                </button>
                <button type="button" className="btn btn-error btn-sm" onClick={() => act("short")}>
                  Short
                </button>
                <button type="button" className="btn btn-ghost btn-sm border border-base-300" onClick={() => act("flat")}>
                  Flat
                </button>
              </div>
              <div className="overflow-x-auto max-h-40">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>Qty</th>
                      <th>Px</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {paper.fills.slice(0, 8).map((f) => (
                      <tr key={f.id}>
                        <td className={f.side === "buy" ? "text-success" : "text-error"}>{f.side}</td>
                        <td>{f.qty}</td>
                        <td className="tabular-nums">{f.price.toFixed(2)}</td>
                        <td className="opacity-50">{f.reason}</td>
                      </tr>
                    ))}
                    {!paper.fills.length ? (
                      <tr>
                        <td colSpan={4} className="opacity-50">
                          No fills yet
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="card bg-base-200 border border-base-300 shadow-sm">
            <div className="card-body gap-2 p-4">
              <h3 className="font-bold tracking-tight">News tape</h3>
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {snap.news.length ? (
                  [...snap.news].reverse().map((n) => (
                    <li
                      key={n.id}
                      className="rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`badge badge-xs ${
                            n.bias === "bull"
                              ? "badge-success"
                              : n.bias === "bear"
                                ? "badge-error"
                                : "badge-ghost"
                          }`}
                        >
                          {n.bias}
                        </span>
                        <span className="text-[11px] opacity-50 font-mono">{formatClock(n.t)}</span>
                      </div>
                      {n.headline}
                    </li>
                  ))
                ) : (
                  <li className="text-sm opacity-50">Waiting for headlines…</li>
                )}
              </ul>
            </div>
          </section>

          <section className="card bg-base-200 border border-base-300 shadow-sm">
            <div className="card-body gap-2 p-4">
              <h3 className="font-bold tracking-tight">Book walls</h3>
              <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Side</th>
                      <th>Price</th>
                      <th>Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...snap.walls]
                      .filter((w) => w.remaining > 0)
                      .sort((a, b) => b.price - a.price)
                      .slice(0, 8)
                      .map((w) => (
                        <tr key={w.id}>
                          <td className={w.side === "bid" ? "text-success" : "text-error"}>
                            {w.side === "bid" ? "demand" : "supply"}
                          </td>
                          <td className="tabular-nums font-semibold">{w.price.toFixed(2)}</td>
                          <td className="tabular-nums opacity-70">
                            {w.remaining}/{w.size}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
