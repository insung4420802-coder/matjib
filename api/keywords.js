// 감성 검색어 → 카카오맵에서 실제 통하는 검색 키워드 + 매칭용 단어 변환 (Claude 사용)
// Vercel 환경변수: ANTHROPIC_API_KEY (필수), ANTHROPIC_MODEL (선택, 기본 claude-haiku-4-5)
// 실패 시 클라이언트가 원문 그대로 검색하므로 앱 자체는 계속 동작합니다.

const SYSTEM_PROMPT = `너는 카카오맵 검색 전문가다. 사용자의 감성적/추상적 음식 표현을 카카오맵 검색창에서 실제로 통하는 키워드로 번역한다.

핵심 원칙: 카카오맵 키워드 검색은 [가게 이름 / 업종 카테고리 / 대표 메뉴]에 있는 단어로만 작동한다.
"키즈 친화 음식", "분위기 좋은", "어린이식당" 같은 추상 표현은 검색이 안 되거나 엉뚱한 가게가 나온다.
따라서 사용자의 의도를 파악한 뒤, 그 의도를 만족하는 "실제 존재하는 구체적 메뉴명/업종명"으로 바꿔야 한다.

출력 형식 (JSON 객체 하나만, 다른 텍스트 절대 금지):
{"search":["키워드1",...],"match":["단어1",...],"food":["음식단어",...],"theme":["테마단어",...],"tiers":{"exact":"정확메뉴","broad":"상위카테고리","broader":"더큰분류"},"region":""}

테마 처리 규칙 (중요):
- "바다가 보이는", "분위기 좋은", "아이랑 가기 좋은" 같은 테마가 있으면, 지도/후기에서 실제로 쓰이는 말로 변환한다:
  바다가 보이는→오션뷰/바다뷰, 야경→루프탑/야경, 전통적인→한옥/노포, 조용한→룸/프라이빗
- search에는 "테마+음식" 2단어 조합 키워드를 포함할 수 있다. 예: "오션뷰 횟집"
- food: 음식/업종 단어만 (필수 조건 매칭용). theme: 테마 단어만 (가산점 매칭용, 후기 제목에 쓰이는 표현 위주)
- 테마가 없으면 theme은 빈 배열

region 규칙:
- 검색어에 지역명(도시/역/동네, 예: 판교, 강남역, 성수동)이 섞여 있으면 그 지역명만 region에 담는다. 없으면 "".
- search/match/food/theme에는 지역명을 절대 넣지 않는다.
- 예: "판교 스테이크" → region:"판교", search:["스테이크","스테이크하우스"]

search 규칙 (2~5개):
- 각각이 카카오맵 검색창에 쳤을 때 실제 가게가 나오는 단어여야 한다 (구체적 메뉴명 또는 업종명)
- 금지: 형용사/감성어("얼큰한","맛있는"), 추상 개념("키즈 친화","가성비"), "맛집"/"식당" 단독, 지역명
- 추상적 요청은 그 의도에 맞는 대표 메뉴 여러 개로 풀어낸다

match 규칙 (5~12개):
- 결과 검증용. 가게명/카테고리/블로그 후기 제목과 대조할 단어들
- 구체적 메뉴명 + 후기 제목에 자주 등장하는 관련 표현("아이랑","해장","키즈")을 섞는다

tiers 규칙 (계층 매칭용, 각 1개씩):
- exact: 사용자가 원한 가장 구체적인 메뉴 (예: "오징어짬뽕")
- broad: 그 메뉴가 속한 한 단계 위 분류 (예: "짬뽕")
- broader: 더 큰 음식 분류 (예: "중식")
- 이 3개는 결과를 "정확히 일치 / 비슷한 종류 / 같은 계열"로 나눠 보여주는 데 쓴다

예시 1
입력: 오징어 들어간 짬뽕
출력: {"search":["오징어짬뽕","해물짬뽕","짬뽕"],"match":["오징어짬뽕","짬뽕","오징어","해물","중식","중국집"],"tiers":{"exact":"오징어짬뽕","broad":"짬뽕","broader":"중식"}}

예시 2
입력: 아이가 좋아할만한 맛집
출력: {"search":["돈까스","김밥","우동","피자","파스타"],"match":["돈까스","김밥","우동","피자","파스타","아이랑","키즈","어린이"],"tiers":{"exact":"돈까스","broad":"분식","broader":"가족외식"}}

예시 3
입력: 시원하게 해장할 곳
출력: {"search":["해장국","콩나물국밥","북엇국","복국"],"match":["해장","해장국","국밥","콩나물국밥","북엇국"],"food":["해장국","콩나물국밥","북엇국","복국","국밥"],"theme":[],"tiers":{"exact":"해장국","broad":"국밥","broader":"한식"},"region":""}

예시 4 (테마 검색)
입력: 바다가 보이는 횟집
출력: {"search":["오션뷰 횟집","횟집","오션뷰 회"],"match":["횟집","회","물회","오션뷰","바다뷰","바다","뷰"],"food":["횟집","회","물회","사시미","해산물"],"theme":["오션뷰","바다뷰","바다","뷰"],"tiers":{"exact":"횟집","broad":"해산물","broader":"한식"},"region":""}`;

// 해외 모드: 지역명을 분리하고, 구글 텍스트 검색용 쿼리를 만든다.
const SYSTEM_PROMPT_OVERSEAS = `너는 해외 맛집 검색 전문가다. 한국인이 입력한 "지역+메뉴" 표현을 구글맵 텍스트 검색용으로 변환한다.
한국어로 입력하든 영어로 입력하든 동일하게 처리한다.

출력 형식 (JSON 객체 하나만, 다른 텍스트 절대 금지):
{"region":"도시/지역 영문명","gquery":["구글검색어1","구글검색어2"],"krquery":"네이버 블로그 검색어","match":["매칭단어",...],"tiers":{"exact":"정확메뉴","broad":"상위","broader":"계열"}}

규칙:
- region: 검색 지역의 영문 표기 (예: "Osaka, Japan"). 지역이 불명확하면 "".
- gquery: 구글맵에 던질 "메뉴+지역" 검색어 1~3개. 현지어와 영어를 섞어도 좋다.
  예: 오사카 소바 → ["soba Osaka","そば 大阪"]
- krquery: 한국인 블로그(네이버)에서 찾을 검색어. 보통 "지역 메뉴 맛집" 한국어.
  예: "오사카 소바 맛집"
- match: 결과 검증용 단어(한/영/현지어 메뉴명). 예: ["소바","soba","そば"]
- 테마가 있으면("바다가 보이는 횟집") gquery에 자연어로 포함시킨다: "ocean view seafood restaurant Okinawa".
  match에도 테마 단어(오션뷰, ocean view 등)를 추가한다. 구글은 자연어 테마를 잘 이해한다.
- tiers: exact(정확메뉴)/broad(상위분류)/broader(계열). 현지어·영어 포함 가능.

예시 1
입력: 오사카 소바 맛집
출력: {"region":"Osaka, Japan","gquery":["soba Osaka","そば 大阪"],"krquery":"오사카 소바 맛집","match":["소바","soba","そば","면"],"tiers":{"exact":"소바","broad":"면요리","broader":"일식"}}

예시 2
입력: best ramen in tokyo shibuya
출력: {"region":"Shibuya, Tokyo, Japan","gquery":["ramen Shibuya Tokyo","ラーメン 渋谷"],"krquery":"도쿄 시부야 라멘 맛집","match":["라멘","ramen","ラーメン"],"tiers":{"exact":"라멘","broad":"면요리","broader":"일식"}}

예시 3
입력: 다낭 반쎄오 맛집
출력: {"region":"Da Nang, Vietnam","gquery":["banh xeo Da Nang","bánh xèo Đà Nẵng"],"krquery":"다낭 반쎄오 맛집","match":["반쎄오","banh xeo","bánh xèo"],"tiers":{"exact":"반쎄오","broad":"베트남음식","broader":"동남아"}}`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  }

  const { query, mode } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "query가 필요합니다." });
  }
  const overseas = mode === "overseas";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallback = overseas
    ? { region: "", gquery: [query.trim()], krquery: query.trim(), match: [query.trim()], tiers: { exact: query.trim(), broad: "", broader: "" }, converted: false }
    : { keywords: [query.trim()], match: [query.trim()], tiers: { exact: query.trim(), broad: "", broader: "" }, converted: false };
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
        system: overseas ? SYSTEM_PROMPT_OVERSEAS : SYSTEM_PROMPT,
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

    const tierOf = (p) => {
      const t = p.tiers || {};
      return {
        exact: (t.exact || "").trim(),
        broad: (t.broad || "").trim(),
        broader: (t.broader || "").trim(),
      };
    };

    if (overseas) {
      const gquery = norm(parsed.gquery, 3, false);
      const match = norm(parsed.match, 12, false);
      const krquery = (parsed.krquery || query).trim();
      const region = (parsed.region || "").trim();
      const tiers = tierOf(parsed);
      if (!tiers.exact) tiers.exact = gquery[0] || query.trim();
      if (gquery.length === 0) return res.status(200).json(fallback);
      return res.status(200).json({ region, gquery, krquery, match: match.slice(0, 14), tiers, converted: true });
    }

    const keywords = norm(parsed.search, 5, true);
    const match = norm(parsed.match, 12, false);

    if (keywords.length === 0) return res.status(200).json(fallback);
    for (const k of keywords) if (!match.includes(k)) match.push(k);

    const food = norm(parsed.food, 8, false);
    const theme = norm(parsed.theme, 6, false);

    const tiers = tierOf(parsed);
    if (!tiers.exact) tiers.exact = keywords[0] || "";

    const detectedRegion = (parsed.region || "").trim();
    return res.status(200).json({
      keywords, match: match.slice(0, 14),
      food: food.length ? food : match.slice(0, 8), // food 없으면 match로 대체(하위호환)
      theme,
      tiers, region: detectedRegion, converted: true,
    });
  } catch (e) {
    return res.status(200).json(fallback);
  }
}
