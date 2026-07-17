import { Resend } from "resend";
import { dashboardData } from "./db";

export async function sendReviewDigest() {
  if (!process.env.RESEND_API_KEY || !process.env.REVIEW_EMAIL_TO) return { skipped: true, reason: "Resend is not configured." };
  const data = dashboardData();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const openPlans = data.openPlans as Array<Record<string, unknown>>;
  const exceptions = data.exceptions as Array<Record<string, unknown>>;
  const lines = openPlans.map((p) => `<li><strong>${p.ticker}</strong> — ${p.decision_type}; thesis review due ${p.hold_until}</li>`).join("");
  const alerts = exceptions.map((e) => `<li>${e.summary}</li>`).join("");
  return resend.emails.send({
    from: process.env.REVIEW_EMAIL_FROM || "Zkyko <onboarding@resend.dev>",
    to: process.env.REVIEW_EMAIL_TO,
    subject: `Zkyko: ${openPlans.length} open plans, ${exceptions.length} exceptions`,
    html: `<h1>Post-close accountability review</h1><h2>Open plans</h2><ul>${lines || "<li>None</li>"}</ul><h2>Unresolved activity</h2><ul>${alerts || "<li>None</li>"}</ul><p>Open your local Zkyko dashboard to complete the review.</p>`,
  });
}
