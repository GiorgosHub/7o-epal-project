// Vercel Edge Function: keeps the Groq API key on the server.
// In Vercel → Project → Settings → Environment Variables, add GROQ_API_KEY = your key (from console.groq.com/keys).
export const config = { runtime: "edge" };

const MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
const okOrigin = o => !o || o === "https://7o-epal-project.vercel.app" || /^https:\/\/7o-epal-project[-a-z0-9]*\.vercel\.app$/.test(o);

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const cors = { "Access-Control-Allow-Origin": okOrigin(origin) && origin ? origin : "https://7o-epal-project.vercel.app", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
  const json = (status, message) => new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(405, "Method not allowed");
  if (!okOrigin(origin)) return json(403, "Forbidden");
  const key = process.env.GROQ_API_KEY;
  if (!key) return json(500, "GROQ_API_KEY is not set on the server");
  let body;
  try { const text = await req.text(); if (text.length > 200000) return json(413, "Request too large"); body = JSON.parse(text); }
  catch { return json(400, "Bad request"); }
  if (!MODELS.includes(body.model)) body.model = MODELS[0];
  body.max_tokens = Math.min(Number(body.max_tokens) || 1024, 4000);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body)
  });
  return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
}
