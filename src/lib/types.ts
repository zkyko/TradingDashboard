export const DECISION_TYPES = ["ENTRY", "ADD", "REDUCE", "EXIT", "STOP_CHANGE", "TARGET_CHANGE", "HOLD_EXTENSION"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export type PlanInput = {
  tradePlanId?: number | null;
  ticker: string;
  direction: "BULL" | "BEAR";
  playbookId: number;
  decisionType: DecisionType;
  thesis: string;
  marketContext: string;
  evidence: string;
  val: number;
  vah: number;
  entry: number;
  target: number;
  invalidation: number;
  quantity: number;
  accountEquity: number;
  holdUntil: string;
  triggerPrice?: number | null;
  changeReason?: string | null;
};

export type MemoryMatch = {
  id: number;
  ticker: string;
  decisionType: string;
  thesis: string;
  outcome?: string | null;
  similarity: number;
};

export type Challenge = {
  summary: string;
  contradictions: string[];
  questions: string[];
  memoryIds: number[];
  fallback?: boolean;
};

export type RobinhoodSnapshot = {
  capturedAt: string;
  accountEquity: number;
  accounts: Array<Record<string, unknown>>;
  portfolios: Array<{ accountNumber: string; data: Record<string, unknown> }>;
  positions: Array<{ ticker: string; quantity: number; averagePrice?: number }>;
  orders: Array<Record<string, unknown>>;
  optionOrders: Array<Record<string, unknown>>;
  executions: Array<{
    externalId: string;
    ticker: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    executedAt: string;
  }>;
};
