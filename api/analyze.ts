// Vercel Serverless Function (Node) — CORS + imageBase64 -> OpenAI
import type { VercelRequest, VercelResponse } from "@vercel/node";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function setCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    // плагин присылает { imageBase64: "<...>" } БЕЗ префикса data:
    if (!req.body || typeof req.body.imageBase64 !== "string") {
      return res.status(400).json({ error: "Body must be JSON with { imageBase64: <base64> }" });
    }

    const imageBase64 = req.body.imageBase64;
    const dataUrl = `data:image/png;base64,${imageBase64}`;

    const format = (req.query?.format === "json") ? "json" : "text";

    const PROMPT_TEXT =
`Ты опытный UX/UI дизайнер.
Проанализируй предоставленный скриншот макета.
Отвечай на русском.
Если формат=текст — выдай красиво оформленный отчёт (Markdown: заголовки, списки, абзацы), без JSON.
Если формат=json — верни строго JSON со структурами:
{
  "summary": string,
  "scores": { "ux":0-10, "ui":0-10, "typography":0-10, "composition":0-10, "color_contrast":0-10, "accessibility":0-10, "hierarchy":0-10, "spacing_grid":0-10, "tap_targets":0-10, "states":0-10 },
  "issues":[{ "area":string,"severity":string,"what":string,"why":string,"fix":string }],
  "quick_fixes": string[],
  "final_verdict": string
}`;

    // собираем запрос к OpenAI
    const body: any = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: PROMPT_TEXT },
        {
          role: "user",
          content: [
            { type: "text", text: format === "json" ? "Верни строго JSON." : "Верни красиво оформленный отчёт (Markdown)." },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    };

    if (format === "json") {
      // Жёсткая схема, как требовал OpenAI: additionalProperties:false
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "DesignReview",
          schema: {
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
          },
          strict: true
        }
      };
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(502).json({ error: `OpenAI ${r.status}`, details: errText.slice(0, 8000) });
    }

    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "";

    if (format === "json") {
      // content — это строка JSON, вернём как объект если получится
      try {
        const parsed = JSON.parse(content);
        return res.status(200).json(parsed);
      } catch {
        return res.status(502).json({ error: "Model returned non-JSON", content });
      }
    } else {
      // Текстовый отчёт (Markdown/текст)
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(content);
    }
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
