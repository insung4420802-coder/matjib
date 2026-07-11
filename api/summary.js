// 1등 맛집 AI 한줄평: 진짜 후기들을 읽고 2문장 요약
// 입력(POST): { name, reviews:[{title,description}] }
// 출력: { summary } (키 없거나 실패 시 summary:null — 앱은 계속 동작)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  const { name, reviews } = req.body || {};
  if (!name || !Array.isArray(reviews) || reviews.length === 0) {
    return res.status(200).json({ summary: null });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ summary: null });

  const list = reviews.slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.title || ""} — ${r.description || ""}`)
    .join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        max_tokens: 200,
        system:
          "너는 맛집 큐레이터다. 아래 실제 방문 후기들을 읽고 이 가게가 왜 좋은지 한국어 2문장 이내로 요약한다. " +
          "규칙: 후기에 실제 언급된 내용만 쓴다(맛/메뉴/분위기/재방문 등). 과장·추측 금지. " +
          "가게 이름 반복 금지. 존댓말 평서문. 요약 문장만 출력하고 다른 텍스트 금지.",
        messages: [{ role: "user", content: `가게: ${name}\n후기:\n${list}` }],
      }),
    });
    if (!r.ok) return res.status(200).json({ summary: null });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    return res.status(200).json({ summary: text.slice(0, 200) || null });
  } catch (_) {
    return res.status(200).json({ summary: null });
  }
}
