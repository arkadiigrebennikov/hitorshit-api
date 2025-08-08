export const config = { runtime: 'edge' };

// универсальный конструктор CORS-ответов
function corsHeaders(req: Request, extra: Record<string, string> = {}) {
  const acrh = req.headers.get("access-control-request-headers");
  const methods = req.headers.get("access-control-request-method");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods || "POST, OPTIONS",
    "Access-Control-Allow-Headers": acrh || "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...extra
  };
}

function j(req: Request, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) }
  });
}

// безопасно достаём ключ (без типов Node)
const OPENAI_API_KEY =
  (globalThis as any)?.process?.env?.OPENAI_API_KEY ||
  (globalThis as any)?.OPENAI_API_KEY ||
  "";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  // маршрут
  if (url.pathname !== "/api/analyze") {
    return new Response("Not found", { status: 404, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(req) });
  }

  if (!OPENAI_API_KEY) return j(req, { error: "Missing OPENAI_API_KEY" }, 500);

  try {
    // читаем PNG-байты
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return j(req, { error: "Empty body" }, 400);

    // конвертим в data URL (порционно)
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const dataUrl = `data:image/png;base64,${btoa(bin)}`;

    // промпт + JSON-схема
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

    // запрос к OpenAI (правильный тип изображения — image_url)
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
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ]
      })
    });

    if (!r.ok) {
      const txt = await r.text();
      return j(req, { error: `OpenAI ${r.status}`, details: txt }, 502);
    }

    const jresp = await r.json();
    const content = jresp?.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) }
      });
    } catch {
      return j(req, { error: "Model returned non-JSON", content }, 502);
    }
  } catch (e: any) {
    return j(req, { error: e?.message || String(e) }, 500);
  }
}
