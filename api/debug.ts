export const runtime = 'edge';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET")     return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const out: any = { env: {}, imports: {}, tests: {} };

  try {
    out.env.OPENAI_API_KEY = !!process.env.OPENAI_API_KEY;
    out.env.UPLOADCARE_PUBLIC_KEY = !!process.env.UPLOADCARE_PUBLIC_KEY;

    try {
      const { UploadClient } = await import("@uploadcare/upload-client");
      out.imports.uploadcare = !!UploadClient;

      // мини-тест uploadcare (1x1 png)
      const uc = new UploadClient({ publicKey: process.env.UPLOADCARE_PUBLIC_KEY! });
      const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,12,73,68,65,84,120,156,99,96,0,0,0,2,0,1,226,33,188,33,0,0,0,0,73,69,78,68,174,66,96,130]);
      const up = await uc.uploadFile(png, { fileName: "1x1.png", contentType: "image/png", store: false });
      out.tests.uploadcare = { ok: true, cdnUrl: up.cdnUrl ? up.cdnUrl.slice(0, 80) : null };
    } catch (e: any) {
      out.tests.uploadcare = { ok: false, error: e?.message || String(e) };
    }

    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e), out }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
}
