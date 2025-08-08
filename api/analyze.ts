import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const UPLOADCARE_PUBLIC_KEY = process.env.UPLOADCARE_PUBLIC_KEY;

// Подгружаем промпт из отдельного файла
import PROMPT from '../prompt';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "No image URL provided" });
    }

    const format = req.query.format || "text"; // text по умолчанию

    // Превращаем Uploadcare URL в прямой
    const dataUrl = imageUrl;

    const messages: any[] = [
      {
        role: "system",
        content: format === "json"
          ? `Ты опытный UX/UI дизайнер. Анализируй дизайн по критериям: UX, UI, типографика, композиция, цвет/контраст, доступность. 
             Верни результат строго в JSON с полями: summary, scores (по 10-балльной), issues (массив), quick_fixes, final_verdict.`
          : PROMPT // длинный промпт для текстового отчёта
      },
      {
        role: "user",
        content: [
          { type: "text", text: format === "json" ? "Проанализируй макет и верни JSON." : "Проанализируй макет и верни красиво оформленный отчёт на русском языке." },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ];

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        ...(format === "json"
          ? { response_format: { type: "json_schema", json_schema: { name: "DesignReview", schema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, scores: { type: "object", additionalProperties: { type: "integer" } }, issues: { type: "array", items: { type: "object", properties: { area: { type: "string" }, severity: { type: "string" }, what: { type: "string" }, why: { type: "string" }, fix: { type: "string" } }, additionalProperties: false } }, quick_fixes: { type: "array", items: { type: "string" } }, final_verdict: { type: "string" } }, required: ["summary", "scores", "issues", "quick_fixes", "final_verdict"] } } }
          : {})
      })
    });

    const data = await openaiRes.json();

    if (format === "json") {
      return res.status(200).json(data.choices[0].message.content);
    } else {
      return res.status(200).send(data.choices[0].message.content);
    }

  } catch (err: any) {
    console.error(err);
    return res.status(502).json({ error: err.message || "Unknown error" });
  }
}
