import { describe, expect, it } from "vitest";
import { planSchema, plannedRisk, validateLevelLogic } from "./validation";

const valid = {
  tradePlanId: "", ticker: "tqqq", direction: "BULL", playbookId: "1", decisionType: "ENTRY",
  thesis: "Trend continuation from accepted value area low.", marketContext: "Daily uptrend remains intact.",
  evidence: "Acceptance above VAL with supportive volume.", val: "70", vah: "80", entry: "71", target: "79",
  invalidation: "68", quantity: "10", accountEquity: "10000", holdUntil: "2099-01-01T16:00", triggerPrice: "",
};

describe("decision validation", () => {
  it("normalizes ticker and optional values", () => {
    const parsed = planSchema.parse(valid);
    expect(parsed.ticker).toBe("TQQQ");
    expect(parsed.tradePlanId).toBeNull();
    expect(parsed.triggerPrice).toBeNull();
  });
  it("calculates planned loss without imposing a percentage", () => {
    expect(plannedRisk(71, 68, 10)).toBe(30);
  });
  it("rejects inverted value areas", () => {
    const parsed = planSchema.parse({ ...valid, val: "82" });
    expect(validateLevelLogic(parsed)).toContain("VAL must be below VAH.");
  });
  it("rejects invalid bullish invalidation", () => {
    const parsed = planSchema.parse({ ...valid, invalidation: "72" });
    expect(validateLevelLogic(parsed)).toContain("A bullish invalidation must be below entry.");
  });
});
