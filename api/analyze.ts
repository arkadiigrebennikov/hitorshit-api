export const runtime = 'edge';

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-File-Name",
  "Access-Control-Max-Age": "86400"
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")   return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "frame.png");
    
    // Исправляем парсинг тела запроса
    const body = await req.json();
    if (!body.imageBase64) {
      return json({ error: "Missing imageBase64 in request body" }, 400);
    }

    // Конвертируем base64 в Uint8Array
    const base64 = body.imageBase64;
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    if (!bytes.byteLength) return json({ error: "Empty image data" }, 400);

    // Lazy import after method checks
    const { UploadClient } = await import("@uploadcare/upload-client");

    // Проверяем наличие API ключа
    if (!process.env.UPLOADCARE_PUBLIC_KEY) {
      return json({ error: "Uploadcare public key not configured" }, 500);
    }

    // 1) Upload to Uploadcare (no permanent store)
    const uploadcare = new UploadClient({ publicKey: process.env.UPLOADCARE_PUBLIC_KEY });
    const up = await uploadcare.uploadFile(bytes, {
      fileName,
      contentType: "image/png",
      store: false
    });
    const imageUrl = up.cdnUrl;

    // 2) Prompt + schema
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

    // Проверяем наличие OpenAI API ключа
    if (!process.env.OPENAI_API_KEY) {
      return json({ error: "OpenAI API key not configured" }, 500);
    }

    // 3) OpenAI REST (Chat Completions)
    const openaiBody = {
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
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(openaiBody)
    });

    if (!r.ok) {
      const txt = await r.text();
      return json({ error: `OpenAI ${r.status}`, details: txt }, 502);
    }

    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";

    try {
      const parsed = JSON.parse(content);
      return json(parsed, 200);
    } catch (_) {
      return json({ error: "Model returned non-JSON", content }, 502);
    }
  } catch (err: any) {
    console.error("API Error:", err);
    return json({ error: err?.message || String(err) }, 500);
  }
}
