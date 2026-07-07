// 감성 검색어 → 실제 메뉴 키워드 + 매칭용 동의어 변환 (Claude 사용)
// Vercel 환경변수: ANTHROPIC_API_KEY (필수), ANTHROPIC_MODEL (선택, 기본 claude-haiku-4-5)
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
  const fallback = { keywords: [query.trim()], match: [query.trim()], converted: false };
  if (!apiKey) return res.status(200).json(fallback);

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
        max_tokens: 300,
        system:
          "너는 한국 음식점 검색 도우미다. 사용자의 감성적인 음식 표현을 분석해 JSON 객체 하나만 출력한다.\n" +
          '형식: {"search":["검색키워드1","검색키워드2"],"match":["매칭단어1","매칭단어2",...]}\n' +
          "규칙:\n" +
          "- search: 카카오맵에서 직접 검색할 구체적인 메뉴명 1~3개. 반드시 구체적 음식명이어야 하며 " +
          '"양식","한식","중식" 같은 넓은 카테고리는 절대 금지. 예: "봉골레" → ["봉골레","봉골레파스타"]\n' +
          "- match: 그 음식과 직접 관련된 동의어/유사 표기 3~8개. 후기 제목 매칭에 쓰인다. " +
          '예: 봉골레 → ["봉골레","파스타","스파게티","오일파스타","이탈리안"]\n' +
          "- 지역명은 절대 포함하지 않는다. JSON 외 다른 텍스트, 마크다운 금지.",
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!r.ok) return res.status(200).json(fallback);

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const cleaned = text.replace(/```json|```/g, "").trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);

    const norm = (arr, max) =>
      (Array.isArray(arr) ? arr : [])
        .filter((k) => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim())
        .slice(0, max);

    const keywords = norm(parsed.search, 3);
    const match = norm(parsed.match, 8);

    if (keywords.length === 0) return res.status(200).json(fallback);
    if (match.length === 0) match.push(...keywords);

    return res.status(200).json({ keywords, match, converted: true });
  } catch (e) {
    return res.status(200).json(fallback);
  }
}
