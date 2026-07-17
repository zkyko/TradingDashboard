const baseUrl = process.env.THESIS_LOOP_URL || "http://localhost:3000";
const secret = process.env.SYNC_SECRET;
if (!secret) throw new Error("SYNC_SECRET is required.");

const response = await fetch(`${baseUrl}/api/sync`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
const body = await response.text();
if (!response.ok) throw new Error(`Sync failed (${response.status}): ${body}`);
console.log(body);
