// Vercel Functions (Framework: Other) — Edge runtime
export const config = { runtime: 'edge' };

// CORS
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
  "Access-Control-Max-Age": "86400"
};

// Безопасно достаём ключ без типов Node/TS:
const OPENAI_API_KEY =
  (globalThis as any)?.process?.env?.OPENAI_API_KEY ||
  (globalThis as any)?.OPENAI_API_KEY ||
  "";

function j(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export default async function handler(req: Request): Promise<Response> {
  // Preflight for CORS
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")   return new Response("Method Not Allowed", { status: 405, headers: CORS });

  if (!OPENAI_API_KEY) return j({ error: "Missing OPENAI_API_KEY" }, 500);

  try {
    // 1) читаем PNG-байты из Фигмы
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return j({ error: "Empty body" }, 400);

    // 2) конверт в data: URL (без Uploadcare)
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const dataUrl = `data:image/png;base64,${btoa(bin)}`;

    // 3) промпт + схема
    const PROMPT = `
Ты строгий, но конструктивный дизайн-критик.
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

Дай оценки 0–10 и конкретные правки. Ответ строго JSON по схеме.
`.trim();

    const schema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        scores: { type: "object", properties: {
          ux:{type:"number"}, ui:{type:"number"}, typography:{type:"number"},
          composition:{type:"number"}, color_contrast:{type:"number"},
          accessibility:{type:"number"}, hierarchy:{type:"number"},
          spacing_grid:{type:"number"}, tap_targets:{type:"number"}, states:{type:"number"}
        }, required:["ux","ui","typography","composition","color_contrast","accessibility","hierarchy","spacing_grid","tap_targets","states"]},
        issues: { type:"array", items:{ type:"object", properties:{
          area:{type:"string"}, severity:{type:"string"}, what:{type:"string"}, why:{type:"string"}, fix:{type:"string"}
        }, required:["area","severity","what","why","fix"]}},
        quick_fixes:{ type:"array", items:{ type:"string" } },
        final_verdict:{ type:"string" }
      },
      required:["summary","scores","issues","quick_fixes","final_verdict"]
    };

    // 4) запрос к OpenAI (REST)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
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
              // NB: в Chat Completions тип изображения — "input_image"
              { type: "input_image", image_url: { url: dataUrl } }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return j({ error: `OpenAI ${r.status}`, details: txt }, 502);
    }

    const jresp = await r.json();
    const content = jresp?.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return j(parsed, 200);
    } catch {
      return j({ error: "Model returned non-JSON", content }, 502);
    }
  } catch (e: any) {
    return j({ error: e?.message || String(e) }, 500);
  }
}
