const baseUrl = process.env.THESIS_LOOP_URL || "http://127.0.0.1:3000";
const secret = process.env.SYNC_SECRET;
if (!secret) throw new Error("SYNC_SECRET is required.");

const mode = process.argv[2] || "tick"; // tick | full | morning
const qs =
  mode === "full" ? "?full=1"
  : mode === "morning" ? "?morning=1&watch=1"
  : "?watch=1";

const response = await fetch(`${baseUrl}/api/cron/tick${qs}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "x-thesis-loop-cron": "1",
    "content-type": "application/json",
  },
  body: JSON.stringify({ source: "launchd", mode }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Cron tick failed (${response.status}): ${body}`);
console.log(body);
