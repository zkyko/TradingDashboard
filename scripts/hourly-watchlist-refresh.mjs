const baseUrl = process.env.THESIS_LOOP_URL || "http://localhost:3000";
const secret = process.env.SYNC_SECRET;
if (!secret) throw new Error("SYNC_SECRET is required.");

const response = await fetch(`${baseUrl}/api/watchlist/refresh`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "x-thesis-loop-cron": "1",
    "content-type": "application/json",
  },
  body: JSON.stringify({ source: "hourly" }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Watchlist refresh failed (${response.status}): ${body}`);
console.log(body);
