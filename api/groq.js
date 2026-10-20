// Vercel Edge Function: keeps the Groq API key on the server.
// In Vercel → Project → Settings → Environment Variables, add GROQ_API_KEY = your key (from console.groq.com/keys).
export const config = { runtime: "edge" };

const MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
// Models that can read photos (used only by "Solve exercises"). Groq allows up to 3 images per request.
const VISION = ["qwen/qwen3.8-27b", "meta-llama/llama-4-scout-17b-16e-instruct"];
const MAX_TEXT = 200000, MAX_WITH_IMAGES = 4500000, MAX_IMAGES = 3;
const countImages = msgs => (Array.isArray(msgs) ? msgs : []).reduce((n, m) => n + (Array.isArray(m && m.content) ? m.content.filter(p => p && p.type === "image_url").length : 0), 0);
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
  try {
    const text = await req.text();
    if (text.length > MAX_WITH_IMAGES) return json(413, "Request too large");
    body = JSON.parse(text);
    if (text.length > MAX_TEXT && !countImages(body.messages)) return json(413, "Request too large");
  } catch { return json(400, "Bad request"); }
  const images = countImages(body.messages);
  if (images > MAX_IMAGES) return json(413, "Too many images");
  for (const m of body.messages || []) if (Array.isArray(m.content)) for (const p of m.content) {
    if (p.type === "image_url" && !/^data:image\/(jpeg|png|webp);base64,/.test((p.image_url && p.image_url.url) || "")) return json(400, "Images must be sent as data URLs");
  }
  if (images) { if (!VISION.includes(body.model)) body.model = VISION[0]; }
  else if (!MODELS.includes(body.model)) body.model = MODELS[0];
  if (body.model.startsWith("qwen/")) { body.reasoning_format = "hidden"; if (!["none", "low", "medium", "high"].includes(body.reasoning_effort)) body.reasoning_effort = "medium"; }
  else { delete body.reasoning_format; delete body.reasoning_effort; }
  body.max_tokens = Math.min(Number(body.max_tokens) || 1024, 4000);
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body)
  });
  return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
}
