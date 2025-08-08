export const runtime = 'edge';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const openai = !!process.env.OPENAI_API_KEY;
    const uploadcare = !!process.env.UPLOADCARE_PUBLIC_KEY;

    // пробуем импорты (лениво)
    let ucOk = false, oaOk = false;
    try { const { UploadClient } = await import("@uploadcare/upload-client"); ucOk = !!UploadClient; } catch {}
    try { oaOk = true; } catch {}

    return new Response(JSON.stringify({
      env: { OPENAI_API_KEY: openai, UPLOADCARE_PUBLIC_KEY: uploadcare },
      imports: { uploadcare: ucOk, openai: oaOk }
    }), { headers: { "Content-Type": "application/json", ...CORS }});
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
}
