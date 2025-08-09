// Node Serverless Function (Vercel) — чистый smoke-test, без OpenAI
import type { VercelRequest, VercelResponse } from "@vercel/node";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    cors(res);

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    // Тело должно быть JSON: { imageBase64: "..." }
    const body = (req.body ?? {}) as any;
    const b64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    return res.status(200).json({
      ok: true,
      receivedBytes: b64.length ? Math.floor(b64.length * 3 / 4) : 0
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
