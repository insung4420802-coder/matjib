// 감성 검색어 → 실제 메뉴 키워드 변환 (Claude Haiku 사용)
// Vercel 환경변수 필요: ANTHROPIC_API_KEY
// 실패 시 클라이언트가 원문 그대로 검색하므로 앱 자체는 계속 동작합니다.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  const { query } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query가 필요합니다." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 키가 없어도 앱이 죽지 않도록 원문을 그대로 돌려준다
    return res.status(200).json({ keywords: [query.trim()], converted: false });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        system:
          "너는 한국 음식점 검색 도우미다. 사용자의 감성적인 음식 표현을 " +
          "카카오맵/네이버지도에서 실제로 검색되는 구체적인 메뉴/업종 키워드로 변환한다. " +
          '반드시 JSON 배열만 출력한다. 예: ["낙지짬뽕","해물짬뽕"] ' +
          "규칙: 1~3개의 키워드. 각 키워드는 2~8글자의 실제 메뉴명 또는 음식 종류. " +
          "지역명은 절대 포함하지 않는다. 설명, 마크다운, 다른 텍스트 금지.",
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!r.ok) {
      return res.status(200).json({ keywords: [query.trim()], converted: false });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const cleaned = text.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : cleaned);

    const keywords = (Array.isArray(parsed) ? parsed : [])
      .filter((k) => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim())
      .slice(0, 3);

    if (keywords.length === 0) {
      return res.status(200).json({ keywords: [query.trim()], converted: false });
    }

    return res.status(200).json({ keywords, converted: true });
  } catch (e) {
    return res.status(200).json({ keywords: [query.trim()], converted: false });
  }
}
