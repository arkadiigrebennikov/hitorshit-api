// api/analyze.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch from "node-fetch";
import FormData from "form-data";

// CORS-хелпер
function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Name");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: "No image provided" });
  }

  try {
    // 1. Загрузка в Uploadcare
    const uploadcareUrl = "https://upload.uploadcare.com/base64/";
    const form = new FormData();
    form.append("UPLOADCARE_PUB_KEY", process.env.UPLOADCARE_PUBLIC_KEY || "");
    form.append("UPLOADCARE_STORE", "1");
    form.append("file", imageBase64);

    const uploadResp = await fetch(uploadcareUrl, {
      method: "POST",
      body: form as any
    });

    const uploadData = await uploadResp.json();
    if (!uploadData || !uploadData.file) {
      throw new Error("Uploadcare upload failed");
    }

    const imageUrl = `https://ucarecdn.com/${uploadData.file}/`;

    // 2. Запрос в OpenAI GPT-4o
    const prompt = `
Ты — опытный UX/UI дизайнер. 
Проанализируй макет по изображению: ${imageUrl}
Дай разбор на русском языке с выделенными заголовками, подзаголовками и абзацами. 
Без JSON, только чистый текст с Markdown.
    `;

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Ты эксперт по дизайну." },
          { role: "user", content: prompt }
        ]
      })
    });

    const aiData = await aiResp.json();
    if (!aiData.choices?.[0]?.message?.content) {
      throw new Error("OpenAI response error");
    }

    res.status(200).json({
      analysis: aiData.choices[0].message.content.trim()
    });

  } catch (err: any) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: String(err) });
  }
}
