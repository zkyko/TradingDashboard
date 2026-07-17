import { db, openExceptionCount } from "./db";
import { createChallenge, embedPlan, findMemories } from "./memory";
import type { Challenge, PlanInput } from "./types";
import { plannedRisk, validateLevelLogic } from "./validation";

export async function challengePlan(plan: PlanInput) {
  const levelErrors = validateLevelLogic(plan as Parameters<typeof validateLevelLogic>[0]);
  if (levelErrors.length) throw new Error(levelErrors.join(" "));
  if (plan.tradePlanId && !plan.changeReason?.trim()) throw new Error("A reason is required for every change to a committed plan.");
  const embedding = await embedPlan(plan);
  const memories = findMemories(plan, embedding);
  const challenge = await createChallenge(plan, memories);
  return { challenge, memories, embedding };
}

export function commitPlan(plan: PlanInput, challenge: Challenge, answers: string, embedding: number[] | null) {
  if (openExceptionCount() > 0) throw new Error("Resolve all unjournaled Robinhood activity before committing another decision.");
  if (answers.trim().length < 30) throw new Error("Answer the review questions first (30+ characters).");
  const transaction = db.transaction(() => {
    let tradePlanId = plan.tradePlanId ?? null;
    let version = 1;
    if (tradePlanId) {
      const existing = db.prepare("SELECT current_version, ticker FROM trade_plans WHERE id=? AND status='OPEN'").get(tradePlanId) as { current_version: number; ticker: string } | undefined;
      if (!existing) throw new Error("The selected open plan no longer exists.");
      if (existing.ticker !== plan.ticker) throw new Error("A plan change must keep the same ticker.");
      version = existing.current_version + 1;
    } else {
      const result = db.prepare("INSERT INTO trade_plans (ticker,direction,playbook_id) VALUES (?,?,?)").run(plan.ticker, plan.direction, plan.playbookId);
      tradePlanId = Number(result.lastInsertRowid);
    }
    const result = db.prepare(`INSERT INTO plan_versions
      (trade_plan_id,version,decision_type,thesis,market_context,evidence,val,vah,entry,target,invalidation,quantity,account_equity,planned_risk,hold_until,trigger_price,change_reason,challenge_json,answers,embedding_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      tradePlanId, version, plan.decisionType, plan.thesis, plan.marketContext, plan.evidence,
      plan.val, plan.vah, plan.entry, plan.target, plan.invalidation, plan.quantity, plan.accountEquity,
      plannedRisk(plan.entry, plan.invalidation, plan.quantity), plan.holdUntil, plan.triggerPrice ?? null,
      plan.changeReason ?? null, JSON.stringify(challenge), answers.trim(), embedding ? JSON.stringify(embedding) : null
    );
    db.prepare("UPDATE trade_plans SET current_version=?, direction=? WHERE id=?").run(version, plan.direction, tradePlanId);
    if (plan.decisionType === "EXIT") db.prepare("UPDATE trade_plans SET status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?").run(tradePlanId);
    return { tradePlanId, versionId: Number(result.lastInsertRowid), version };
  });
  return transaction();
}
