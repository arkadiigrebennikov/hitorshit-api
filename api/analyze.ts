// /api/analyze.ts  — Edge, CORS-first, с подробным stage-dump
export const runtime = 'edge';

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
  "Access-Control-Max-Age": "86400"
};

function j(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")   return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const stage: any = { at: "start" };

  try {
    // env
    stage.at = "check-env";
    const hasOA = !!process.env.OPENAI_API_KEY;
    const hasUC = !!process.env.UPLOADCARE_PUBLIC_KEY;
    if (!hasOA || !hasUC) return j({ error: "Missing env", stage, env: { OPENAI_API_KEY: hasOA, UPLOADCARE_PUBLIC_KEY: hasUC } }, 500);

    // read body
    stage.at = "read-bytes";
    const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "frame.png");
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return j({ error: "Empty body", stage }, 400);

    // import deps
    stage.at = "import-uploadcare";
    const { UploadClient } = await import("@uploadcare/upload-client");

    // upload to Uploadcare
    stage.at = "uploadcare-upload";
    const uc = new UploadClient({ publicKey: process.env.UPLOADCARE_PUBLIC_KEY! });
    const up = await uc.uploadFile(bytes, { fileName, contentType: "image/png", store: false });
    const imageUrl = up.cdnUrl;
    if (!imageUrl) return j({ error: "No cdnUrl returned from Uploadcare", stage, up }, 502);

    // build prompt + schema
    stage.at = "prepare-openai";
    const PROMPT = `Ты строгий, но конструктивный дизайн-критик.
Оцени экран по пунктам:
1) UX
2) UI
3) Типографика
4) Композиция
5) Цвет и контраст
6) Доступность
7) Иерархия
8) Сетка и отступы
9) Клик-таргеты
10) Состояния элементов

Дай оценки 0–10 и конкретные правки. Ответ строго JSON по схеме.`.trim();

    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        scores: {
          type: "object",
          properties: {
            ux: { type: "number" },
            ui: { type: "number" },
            typography: { type: "number" },
            composition: { type: "number" },
            color_contrast: { type: "number" },
            accessibility: { type: "number" },
            hierarchy: { type: "number" },
            spacing_grid: { type: "number" },
            tap_targets: { type: "number" },
            states: { type: "number" }
          },
          required: ["ux","ui","typography","composition","color_contrast","accessibility","hierarchy","spacing_grid","tap_targets","states"]
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              area: { type: "string" },
              severity: { type: "string" },
              what: { type: "string" },
              why: { type: "string" },
              fix: { type: "string" }
            },
            required: ["area","severity","what","why","fix"]
          }
        },
        quick_fixes: { type: "array", items: { type: "string" } },
        final_verdict: { type: "string" }
      },
      required: ["summary","scores","issues","quick_fixes","final_verdict"]
    };

    // call OpenAI (REST)
    stage.at = "openai-call";
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_schema", json_schema: { name: "DesignReview", schema, strict: true } },
        messages: [
          { role: "system", content: PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Проанализируй экран и верни строго JSON." },
              { type: "input_image", image_url: { url: imageUrl } }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return j({ error: `OpenAI ${r.status}`, stage, details: txt }, 502);
    }

    stage.at = "parse-openai";
    const jresp = await r.json();
    const content = jresp?.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return new Response(JSON.stringify(parsed), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
    } catch (e) {
      return j({ error: "Model returned non-JSON", stage, content }, 502);
    }
  } catch (e: any) {
    return j({ error: e?.message || String(e), stage }, 500);
  }
}
