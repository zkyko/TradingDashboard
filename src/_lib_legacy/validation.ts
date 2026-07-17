import { z } from "zod";
import { DECISION_TYPES } from "./types";

const numberFromForm = z.coerce.number().finite();

export const planSchema = z.object({
  tradePlanId: z.union([z.coerce.number().int().positive(), z.literal(""), z.undefined()]).transform((v) => v === "" || v === undefined ? null : v),
  ticker: z.string().trim().min(1).max(10).transform((v) => v.toUpperCase()),
  direction: z.enum(["BULL", "BEAR"]),
  playbookId: z.coerce.number().int().positive(),
  decisionType: z.enum(DECISION_TYPES),
  thesis: z.string().trim().min(20, "Explain the thesis in at least 20 characters."),
  marketContext: z.string().trim().min(10),
  evidence: z.string().trim().min(10),
  val: numberFromForm.positive(),
  vah: numberFromForm.positive(),
  entry: numberFromForm.positive(),
  target: numberFromForm.positive(),
  invalidation: numberFromForm.positive(),
  quantity: numberFromForm.positive(),
  accountEquity: numberFromForm.positive(),
  holdUntil: z.string().min(1),
  triggerPrice: z.union([numberFromForm.positive(), z.literal(""), z.undefined()]).transform((v) => v === "" || v === undefined ? null : v),
  changeReason: z.string().trim().optional().nullable(),
});

export function plannedRisk(entry: number, invalidation: number, quantity: number) {
  return Math.abs(entry - invalidation) * quantity;
}

export function validateLevelLogic(data: z.infer<typeof planSchema>) {
  const errors: string[] = [];
  if (data.val >= data.vah) errors.push("VAL must be below VAH.");
  if (data.direction === "BULL" && data.invalidation >= data.entry) errors.push("A bullish invalidation must be below entry.");
  if (data.direction === "BEAR" && data.invalidation <= data.entry) errors.push("A bearish invalidation must be above entry.");
  if (new Date(data.holdUntil).getTime() <= Date.now()) errors.push("The planned review/hold date must be in the future.");
  return errors;
}
