export const config = { runtime: 'edge' };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

const OPENAI_API_KEY =
  (globalThis as any)?.process?.env?.OPENAI_API_KEY ||
  (globalThis as any)?.OPENAI_API_KEY ||
  "";

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET")     return new Response("Method Not Allowed", { status: 405, headers: CORS });

  return new Response(JSON.stringify({
    env: { OPENAI_API_KEY: !!OPENAI_API_KEY }
  }), { headers: { "Content-Type": "application/json", ...CORS }});
}
