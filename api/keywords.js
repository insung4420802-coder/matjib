// 감성 검색어 → 카카오맵에서 실제 통하는 검색 키워드 + 매칭용 단어 변환 (Claude 사용)
// Vercel 환경변수: ANTHROPIC_API_KEY (필수), ANTHROPIC_MODEL (선택, 기본 claude-haiku-4-5)
// 실패 시 클라이언트가 원문 그대로 검색하므로 앱 자체는 계속 동작합니다.

const SYSTEM_PROMPT = `너는 카카오맵 검색 전문가다. 사용자의 감성적/추상적 음식 표현을 카카오맵 검색창에서 실제로 통하는 키워드로 번역한다.

핵심 원칙: 카카오맵 키워드 검색은 [가게 이름 / 업종 카테고리 / 대표 메뉴]에 있는 단어로만 작동한다.
"키즈 친화 음식", "분위기 좋은", "어린이식당" 같은 추상 표현은 검색이 안 되거나 엉뚱한 가게가 나온다.
따라서 사용자의 의도를 파악한 뒤, 그 의도를 만족하는 "실제 존재하는 구체적 메뉴명/업종명"으로 바꿔야 한다.

출력 형식 (JSON 객체 하나만, 다른 텍스트 절대 금지):
{"search":["키워드1",...],"match":["단어1",...]}

search 규칙 (2~5개):
- 각각이 카카오맵 검색창에 쳤을 때 실제 가게가 나오는 단어여야 한다 (구체적 메뉴명 또는 업종명)
- 금지: 형용사/감성어("얼큰한","맛있는"), 추상 개념("키즈 친화","가성비"), "맛집"/"식당" 단독, 지역명
- 추상적 요청은 그 의도에 맞는 대표 메뉴 여러 개로 풀어낸다

match 규칙 (5~12개):
- 결과 검증용. 가게명/카테고리/블로그 후기 제목과 대조할 단어들
- 구체적 메뉴명 + 후기 제목에 자주 등장하는 관련 표현("아이랑","해장","키즈")을 섞는다
- 여기는 감성어가 아닌, 후기 제목에 실제로 쓰이는 단어만

예시 1
입력: 낙지 들어간 얼큰한 짬뽕
출력: {"search":["낙지짬뽕","해물짬뽕","짬뽕"],"match":["낙지짬뽕","짬뽕","낙지","해물","중식당","중국집"]}

예시 2
입력: 아이가 좋아할만한 맛집
출력: {"search":["돈까스","김밥","우동","피자","파스타"],"match":["돈까스","김밥","우동","피자","파스타","아이랑","아이와","키즈","어린이","가족"]}

예시 3
입력: 시원하게 해장할 곳
출력: {"search":["해장국","콩나물국밥","북엇국","복국"],"match":["해장","해장국","국밥","콩나물국밥","북엇국","복국","뼈해장국"]}

예시 4
입력: 부모님 모시고 가기 좋은 점심
출력: {"search":["한정식","갈비탕","솥밥","보리굴비"],"match":["한정식","갈비탕","솥밥","보리굴비","부모님","가족모임","상견례","코스"]}`;

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
        max_tokens: 400,
        system: SYSTEM_PROMPT,
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

    const BAD_SEARCH = /(맛집|식당|음식점|음식|요리|친화|분위기|가성비|좋은|추천)$/;
    const norm = (arr, max, filterBad) =>
      (Array.isArray(arr) ? arr : [])
        .filter((k) => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim())
        .filter((k) => !filterBad || !BAD_SEARCH.test(k)) // 안전망: 추상 키워드 제거
        .slice(0, max);

    const keywords = norm(parsed.search, 5, true);
    const match = norm(parsed.match, 12, false);

    if (keywords.length === 0) return res.status(200).json(fallback);
    for (const k of keywords) if (!match.includes(k)) match.push(k);

    return res.status(200).json({ keywords, match: match.slice(0, 14), converted: true });
  } catch (e) {
    return res.status(200).json(fallback);
  }
}
