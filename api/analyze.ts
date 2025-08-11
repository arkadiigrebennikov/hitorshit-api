// ВСТАВЬ свой домен Vercel (без завершающего /)
const API_BASE = "https://hitorshit-api.vercel.app";

figma.showUI(__html__, { width: 460, height: 680 });

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== "analyze") return;

  var format = msg.format === "json" ? "json" : "text";
  var node = figma.currentPage.selection[0];

  if (!node || typeof node.exportAsync !== "function") {
    figma.ui.postMessage({ type: "error", message: "Выдели фрейм/узел, который можно экспортировать." });
    return;
  }

  try {
    // 1) Экспорт узла в PNG-байты
    var bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });

    // 2) Конверт в base64 БЕЗ префикса data:
    var u8 = new Uint8Array(bytes);
    var bin = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < u8.length; i += CHUNK) {
      var sub = u8.subarray(i, i + CHUNK);
      bin += String.fromCharCode.apply(null, Array.from(sub));
    }
    var base64 = btoa(bin); // без "data:image/png;base64,"

    // 3) Сборка URL без двойных слэшей
    const base = API_BASE.replace(/\/+$/, "");
    const endpoint = base + "/api/analyze" + (format === "json" ? "?format=json" : "");

    // 4) Отправка в API (JSON)
    var res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-File-Name": encodeURIComponent(node.name || "frame.png")
      },
      body: JSON.stringify({ imageBase64: base64 }) // без 'data:image/png;base64,'
    });

    if (!res.ok) {
      var txt = "";
      try { txt = await res.text(); } catch (_e) {}
      throw new Error("API " + res.status + (txt ? (": " + txt) : ""));
    }

    if (format === "json") {
      // Сервер отдаёт JSON-строку (message.content) ИЛИ уже объект — нормализуем
      var text = await res.text();
      var data = null;
      try { data = JSON.parse(text); } catch (_e) {}
      if (data) {
        figma.ui.postMessage({ type: "json", data: data });
      } else {
        figma.ui.postMessage({ type: "text", text: text });
      }
    } else {
      var report = await res.text();
      figma.ui.postMessage({ type: "text", text: report });
    }
  } catch (e) {
    var m = (e && e.message) ? e.message : String(e);
    figma.ui.postMessage({ type: "error", message: m });
  }
};
