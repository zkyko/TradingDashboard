import { money, pnlClass } from "@/lib/review/format";
import { formatHold, type EdgeProfile as EdgeProfileData, type SleeveStats } from "@/lib/review/edge";

function SleeveBlock({ sleeve, highlight }: { sleeve: SleeveStats; highlight?: boolean }) {
  const maxAbs = Math.max(1, ...sleeve.buckets.map((b) => Math.abs(b.pnl)));
  return (
    <div className={`edge-sleeve ${highlight ? "accent" : ""}`}>
      <div className="edge-sleeve-head">
        <div>
          <span className="score-label">{sleeve.label}</span>
          <strong className={pnlClass(sleeve.pnl)}>{money(sleeve.pnl, 0)}</strong>
          <em>
            {sleeve.n} closes · WR {sleeve.winPct.toFixed(0)}% · exp{" "}
            <span className={pnlClass(sleeve.expectancy)}>{money(sleeve.expectancy, 2)}</span>
            /trade
          </em>
        </div>
        <div className="edge-hold-stats">
          <span>
            med hold <b>{formatHold(sleeve.medHoldMin)}</b>
          </span>
          <span>
            win med <b>{sleeve.winMedHoldMin != null ? formatHold(sleeve.winMedHoldMin) : "—"}</b>
          </span>
          <span>
            loss med <b>{sleeve.lossMedHoldMin != null ? formatHold(sleeve.lossMedHoldMin) : "—"}</b>
          </span>
          <span>
            avg W/L{" "}
            <b className={pnlClass(sleeve.avgWin)}>{money(sleeve.avgWin, 0)}</b>
            {" / "}
            <b className={pnlClass(sleeve.avgLoss)}>{money(sleeve.avgLoss, 0)}</b>
          </span>
        </div>
      </div>

      <div className="edge-table-wrap">
        <table className="edge-table">
          <thead>
            <tr>
              <th>Hold</th>
              <th>n</th>
              <th>WR</th>
              <th>PnL</th>
              <th>Exp</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sleeve.buckets.map((b) => (
              <tr key={b.id}>
                <td>{b.label}</td>
                <td>{b.n}</td>
                <td>{b.winPct.toFixed(0)}%</td>
                <td className={pnlClass(b.pnl)}>{money(b.pnl, 0)}</td>
                <td className={pnlClass(b.expectancy)}>{money(b.expectancy, 2)}</td>
                <td>
                  <i
                    className={`edge-bar ${b.pnl >= 0 ? "up" : "down"}`}
                    style={{ width: `${(Math.abs(b.pnl) / maxAbs) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="edge-styles">
        {sleeve.styles.map((s) => (
          <div key={s.id} className={`edge-style-chip ${s.expectancy >= 0 ? "ok" : "leak"}`}>
            <strong>{s.label}</strong>
            <span>
              {s.n} · {money(s.pnl, 0)} · exp {money(s.expectancy, 2)} · med {formatHold(s.medHoldMin)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EdgeProfileCard({ edge }: { edge: EdgeProfileData }) {
  return (
    <section className="card bg-base-200 border border-base-300 shadow-sm review-panel edge-panel">
      <div className="card-body gap-4 p-5">
      <div className="edge-head">
        <div>
          <h2 className="card-title text-base tracking-tight">Hold-time edge</h2>
          <p className="score-meta">
            Measured from your closes ({edge.label}) — strength vs leak by how long you actually held.
            No assumed style.
          </p>
        </div>
      </div>

      <ul className="edge-verdict">
        <li>{edge.verdict.strength}</li>
        <li>{edge.verdict.holdWindow}</li>
        <li>{edge.verdict.leak}</li>
        <li className="rule">{edge.verdict.rule}</li>
      </ul>

      <div className={`edge-grid ${edge.soxl ? "" : "single"}`}>
        {edge.soxl ? <SleeveBlock sleeve={edge.soxl} highlight /> : null}
        <SleeveBlock sleeve={edge.all} />
      </div>

      {edge.nonSoxl ? (
        <div className="edge-nonsoxl">
          <SleeveBlock sleeve={edge.nonSoxl} />
        </div>
      ) : null}

      <div className="edge-hits">
        {(edge.soxl ?? edge.all).best.length ? (
          <div>
            <span className="score-label">Best closes (edge sleeve)</span>
            <ul>
              {(edge.soxl ?? edge.all).best.map((t, i) => (
                <li key={`b-${i}`}>
                  <b>{t.ticker}</b>{" "}
                  <span className={pnlClass(t.pnl)}>{money(t.pnl, 0)}</span>
                  <em>
                    {formatHold(t.holdMinutes)} · {t.closedAt.slice(0, 10)}
                  </em>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(edge.soxl ?? edge.all).worst.length ? (
          <div>
            <span className="score-label">Worst closes (edge sleeve)</span>
            <ul>
              {(edge.soxl ?? edge.all).worst.map((t, i) => (
                <li key={`w-${i}`}>
                  <b>{t.ticker}</b>{" "}
                  <span className={pnlClass(t.pnl)}>{money(t.pnl, 0)}</span>
                  <em>
                    {formatHold(t.holdMinutes)} · {t.closedAt.slice(0, 10)}
                  </em>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      </div>
    </section>
  );
}
