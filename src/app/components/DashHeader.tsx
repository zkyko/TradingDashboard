import type { ReactNode } from "react";

export default function DashHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm opacity-60">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "error" | "warning" | "primary" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "warning"
          ? "text-warning"
          : tone === "primary"
            ? "text-primary"
            : "";
  return (
    <div className="card bg-base-200 border border-base-300 shadow-sm">
      <div className="card-body gap-1 p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-50">{label}</div>
        <div className={`text-2xl font-extrabold tracking-tight sm:text-3xl ${toneClass}`}>{value}</div>
        {hint ? <div className="text-xs opacity-60">{hint}</div> : null}
      </div>
    </div>
  );
}
