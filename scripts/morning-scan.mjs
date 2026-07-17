#!/usr/bin/env node
const baseUrl = process.env.THESIS_LOOP_URL || "http://127.0.0.1:3000";
const secret = process.env.SYNC_SECRET;
if (!secret) throw new Error("SYNC_SECRET is required.");

const response = await fetch(`${baseUrl}/api/cron/tick?morning=1&watch=1`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "x-thesis-loop-cron": "1",
    "content-type": "application/json",
  },
  body: JSON.stringify({ source: "launchd", mode: "morning" }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Morning scan failed (${response.status}): ${body}`);
console.log(body);
