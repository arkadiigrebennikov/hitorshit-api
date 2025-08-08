export const config = { runtime: 'edge' };

// динамические CORS для прохождения любого preflight
function corsHeaders(req: Request, extra: Record<string, string> = {}) {
  const acrh = req.headers.get("access-control-request-headers");
  const acrm = req.headers.get("access-control-request-method");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": acrm || "POST, OPTIONS",
    "Access-Control-Allow-Headers": acrh || "Content-Type, X-File-Name",
    "Access-Control-Max-Age": "86400",
    ...extra
  };
}
function json(req: Request, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) }
  });
}

// безопасный доступ к ключу без типов Node
const OPENAI_API_KEY =
  (globalThis as any)?.process?.env?.OPENAI_API_KEY ||
  (globalThis as any)?.OPENAI_API_KEY ||
  "";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (url.pathname !== "/api/analyze") return new Response("Not found", { status: 404, headers: corsHeaders(req) });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(req) });
  if (!OPENAI_API_KEY) return json(req, { error: "Missing OPENAI_API_KEY" }, 500);

  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength) return json(req, { error: "Empty body" }, 400);

    // bytes -> data:image/png;base64
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const dataUrl = `data:image/png;base64,${btoa(bin)}`;

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

    // ВАЖНО: additionalProperties: false на всех object
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        scores: {
          type: "object",
          additionalProperties: false,
          properties: {
            ux: { type: "number", minimum: 0, maximum: 10 },
            ui: { type: "number", minimum: 0, maximum: 10 },
            typography: { type: "number", minimum: 0, maximum: 10 },
            composition: { type: "number", minimum: 0, maximum: 10 },
            color_contrast: { type: "number", minimum: 0, maximum: 10 },
            accessibility: { type: "number", minimum: 0, maximum: 10 },
            hierarchy: { type: "number", minimum: 0, maximum: 10 },
            spacing_grid: { type: "number", minimum: 0, maximum: 10 },
            tap_targets: { type: "number", minimum: 0, maximum: 10 },
            states: { type: "number", minimum: 0, maximum: 10 }
          },
          required: ["ux","ui","typography","composition","color_contrast","accessibility","hierarchy","spacing_grid","tap_targets","states"]
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
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

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `
Ты опытный UX/UI дизайнер. 
Анализируй предоставленный скриншот макета и давай оценку по пунктам: UX, UI, типографика, композиция, цвета/контраст, доступность, и т.д.
Отвечай на русском языке.
Выводи результат в читаемом виде с заголовками, подзаголовками, абзацами и маркированными списками.
Не используй JSON и фигурные скобки, пиши как для отчёта клиенту.
`
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Проанализируй этот экран." },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  })
});


    if (!r.ok) {
      const txt = await r.text();
      return json(req, { error: `OpenAI ${r.status}`, details: txt }, 502);
    }

    const jresp = await r.json();
    const content = jresp?.choices?.[0]?.message?.content || "{}";

    // Контент уже должен быть валидным JSON по схеме
    try {
      const parsed = JSON.parse(content);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) }
      });
    } catch {
      return json(req, { error: "Model returned non-JSON", content }, 502);
    }
  } catch (e: any) {
    return json(req, { error: e?.message || String(e) }, 500);
  }
}
