"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "zk-money-hidden";

type MoneyPrivacyCtx = {
  hidden: boolean;
  toggle: () => void;
  setHidden: (v: boolean) => void;
  mask: (value: string) => string;
};

const Ctx = createContext<MoneyPrivacyCtx | null>(null);

export function MoneyPrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [hidden, ready]);

  const toggle = useCallback(() => setHidden((v) => !v), []);
  const mask = useCallback((value: string) => (hidden ? "••••" : value), [hidden]);

  const value = useMemo(
    () => ({ hidden, toggle, setHidden, mask }),
    [hidden, toggle, mask],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMoneyPrivacy() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      hidden: false,
      toggle: () => undefined,
      setHidden: (_v: boolean) => undefined,
      mask: (value: string) => value,
    };
  }
  return ctx;
}

/** Eye button — open = visible, closed = hidden. */
export function MoneyEyeButton({ className = "" }: { className?: string }) {
  const { hidden, toggle } = useMoneyPrivacy();
  return (
    <button
      type="button"
      className={`money-eye ${hidden ? "is-hidden" : ""} ${className}`.trim()}
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Show money amounts" : "Hide money amounts"}
      title={hidden ? "Show money" : "Hide money"}
    >
      {hidden ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" opacity=".35" />
          <path fill="currentColor" d="M3.3 3.3 20.7 20.7l-1.4 1.4L1.9 4.7 3.3 3.3Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 5c6.5 0 10 7 10 7s-3.5 7-10 7S2 12 2 12s3.5-7 10-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </svg>
      )}
    </button>
  );
}
