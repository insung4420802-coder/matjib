// ────────────────────────────────────────────────────────────────
// 임슐랭 별점 엔진
// 광고 판별·후기 만족도·증거 신뢰도를 분리해 별점과 추천 순위를 만든다.
//
// 설계 원칙 (중요):
//  1) 진짜후기 밀도(authenticity)는 "가산점"이 아니라 "게이트(곱셈)"다.
//     광고밭이면 다른 점수가 아무리 높아도 별점이 오르면 안 된다.
//  2) 표본 수가 적으면 밀도를 신뢰할 수 없다 → 베이지안 축소(shrinkage)로
//     후기 3개짜리 100%가 후기 30개짜리 80%를 이기지 못하게 한다.
//  3) 키워드 적합도가 낮으면(엉뚱한 업종) 아예 후보에서 제외한다(별점 이전 단계).
//  4) 국내 별점은 진짜 후기 만족도에서만 만들고, 나머지 축은 추천 순위를 보조한다.
// ────────────────────────────────────────────────────────────────

// ── 광고/협찬 신호 (본문·제목 텍스트 기반 휴리스틱) ──
// 네이버 검색 API는 본문 전체를 안 주므로 title+description(요약)만으로 판정.
const AD_STRONG = [
  /협찬/, /원고료/, /제공\s*받아?/, /제공\s*받았/, /소정의\s*(원고료|수수료|고료)/,
  /체험단/, /서포터즈/, /앰배서더/, /유료\s*광고/, /광고\s*포함/, /업체\s*(제공|지원)/,
  /무상\s*제공/, /대가를?\s*받/, /파트너스\s*활동/, /수수료를?\s*받/,
];
const AD_WEAK = [
  /초대\s*받아?/, /초청\s*받/, /지원\s*받아?/, /방문\s*했어요/, /다녀왔어요/,
  /내돈내산\s*아닌/, /광고입니다/, /소개해\s*드릴게요/, /협업/,
];
// 진짜 후기에서 자주 보이는 신호 (내돈내산 톤)
const REAL_SIGNAL = [
  /내돈내산/, /제\s*돈\s*주고/, /솔직\s*후기/, /재방문/, /또\s*갈/, /단골/,
  /웨이팅/, /대기\s*(시간|줄)/, /줄\s*서서/, /아쉬웠/, /별로였/, /실망/,
  /가성비/, /혼밥/, /포장\s*해/, /직접\s*가/,
];

// 진짜 후기의 만족도 신호. 광고 여부와 맛 만족도는 서로 다른 문제이므로
// REAL_SIGNAL과 분리해서 계산한다. 추가 AI 호출 없이 네이버 요약문만 사용한다.
const POSITIVE_SIGNAL = [
  /맛있/, /훌륭/, /만족/, /최고/, /인생\s*(맛집|메뉴|음식)/, /강추/,
  /추천/, /재방문/, /또\s*갈/, /단골/, /친절/, /신선/, /푸짐/, /깔끔/,
];
const NEGATIVE_SIGNAL = [
  /맛없/, /별로였?/, /실망/, /최악/, /다시\s*안\s*갈/, /재방문\s*(의사|생각)\s*(없|X)/i,
  /추천\s*(하지|안)\s*(않|함|해)/, /친절하지\s*않/, /깔끔하지\s*않/,
  /불친절/, /비위생/, /너무\s*(짜|달|맵)/, /싱거/, /질기/, /냄새\s*(나|심)/,
  /가격\s*(대비|에\s*비해).*비싸/,
];
const NEGATIVE_WEAK_SIGNAL = [/아쉬웠?/, /조금\s*(짜|달|맵)/, /대기\s*(길|오래)/];

// 텍스트 하나(제목+요약)에 대한 광고 확률 판정 → 0(진짜)~1(광고)
// 강한 협찬 문구(제공받아/원고료/체험단 등)가 하나라도 있으면,
// 내돈내산 같은 진짜 신호가 섞여 있어도 광고 판정을 유지한다(floor 0.5).
function adScore(text) {
  let s = 0;
  let strong = 0;
  for (const p of AD_STRONG) if (p.test(text)) { s += 0.55; strong++; }
  for (const p of AD_WEAK) if (p.test(text)) s += 0.18;
  for (const p of REAL_SIGNAL) if (p.test(text)) s -= 0.22; // 진짜 신호는 광고 확률을 낮춤
  s = Math.max(0, Math.min(1, s));
  if (strong > 0) s = Math.max(s, 0.5); // 강한 협찬 신호는 진짜 신호로 상쇄 불가
  return s;
}

// 후기 배열을 판정 → 각 후기에 isAd/adProb 부여, 진짜후기 수 집계
function classifyReviews(reviews) {
  const judged = reviews.map((r) => {
    const text = (r.title || "") + " " + (r.description || "");
    const forced = r.forcedVerdict || (r._forceAd ? "ad" : r._forceReal ? "real" : null);
    const prob = forced === "ad" ? 1 : forced === "real" ? 0 : adScore(text);
    return { ...r, adProb: prob, isAd: forced ? forced === "ad" : prob >= 0.5 };
  });
  const real = judged.filter((r) => !r.isAd);
  return { judged, real, adCount: judged.length - real.length };
}

// 동일 링크 또는 동일 블로거의 동일 제목은 표본을 부풀리지 않도록 한 건으로 센다.
function dedupeReviews(reviews) {
  const seen = new Set();
  const unique = [];
  for (const r of reviews || []) {
    let linkKey = "";
    try {
      const u = new URL(r.link || "");
      linkKey = u.hostname + u.pathname.replace(/\/$/, "");
    } catch (_) {}
    const textKey = `${r.blogger || ""}|${r.title || ""}`
      .toLowerCase().replace(/<[^>]+>/g, "").replace(/\s+/g, "").slice(0, 180);
    const key = linkKey || (textKey === "|" ? "" : textKey);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(r);
  }
  return unique;
}

function reviewSatisfaction(text) {
  let positive = 0, negative = 0, weakNegative = 0;
  for (const p of POSITIVE_SIGNAL) if (p.test(text)) positive++;
  for (const p of NEGATIVE_SIGNAL) if (p.test(text)) negative++;
  for (const p of NEGATIVE_WEAK_SIGNAL) if (p.test(text)) weakNegative++;
  if (positive === 0 && negative === 0 && weakNegative === 0) return 0.55;
  return Math.max(0.05, Math.min(0.95,
    0.55 + positive * 0.12 - negative * 0.24 - weakNegative * 0.10));
}

// 표본이 적을 때 과도한 호평·악평으로 쏠리지 않도록 중립보다 약간 긍정적인
// 사전값(0.55, 후기 3개 분량)으로 베이지안 축소한다.
function satisfactionScore(realReviews, prior = 0.55, k = 3) {
  if (!realReviews.length) return prior;
  const sum = realReviews.reduce((acc, r) =>
    acc + reviewSatisfaction((r.title || "") + " " + (r.description || "")), 0);
  return (sum + prior * k) / (realReviews.length + k);
}

// ── 최신성: 진짜 후기들의 날짜(YYYYMMDD) 분포 → 0~1 ──
// 최근 12개월 내 후기가 많을수록 높음. 죽은 맛집(옛날 후기만) 걸러냄.
function recencyScore(realReviews, now = Date.now()) {
  const dates = realReviews
    .map((r) => r.date)
    .filter((d) => /^\d{8}$/.test(d))
    .map((d) => new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`).getTime())
    .filter((t) => !isNaN(t));
  if (dates.length === 0) return 0.4; // 날짜 정보 없으면 중립보다 약간 아래

  const MONTH = 30 * 24 * 3600 * 1000;
  let fresh = 0;
  for (const t of dates) {
    const ageM = (now - t) / MONTH;
    if (ageM <= 6) fresh += 1;
    else if (ageM <= 12) fresh += 0.6;
    else if (ageM <= 24) fresh += 0.25;
  }
  return Math.max(0, Math.min(1, fresh / dates.length));
}

// ── 후기 양: 절대량을 로그 스케일로 0~1 ──
// 진짜 후기 기준. 1개=낮음, 8개 이상이면 충분히 높음.
function volumeScore(realCount) {
  if (realCount <= 0) return 0;
  return Math.min(1, Math.log2(realCount + 1) / Math.log2(9)); // realCount=8 → 1.0
}

// ── 진짜후기 밀도(베이지안 축소) ──
// 관측 밀도 = real / total. 표본이 적으면 사전값(prior=0.5) 쪽으로 당긴다.
// k = 사전 표본 강도. total이 k보다 훨씬 커야 관측 밀도를 그대로 신뢰.
function authenticityScore(realCount, totalCount, prior = 0.5, k = 4) {
  if (totalCount <= 0) return 0;
  return (realCount + prior * k) / (totalCount + k);
}

// ── 키워드 적합도(0~1) ──
// 클라이언트 scorePlace(원점수)를 넘겨받아 정규화. maxScore는 이번 검색 결과 중 최고점.
function relevanceScore(rawScore, maxScore) {
  if (maxScore <= 0) return 0;
  return Math.max(0, Math.min(1, rawScore / maxScore));
}

// ── 추천 순위용 결합 ──
// 만족도를 주축으로 적합도·후기량·최신성을 더하고 authenticity를 게이트로 쓴다.
// 별 아이콘은 이 종합점수가 아니라 만족도 자체에서 계산한다.
function combine({ authenticity, volume, recency, relevance, satisfaction = 0.55 }) {
  // 만족도를 주축으로 삼고, 적합도·증거량·최신성은 추천 순위를 보조한다.
  const quality =
    0.50 * satisfaction +
    0.20 * relevance +
    0.15 * volume +
    0.15 * recency;
  const gate = 0.45 + 0.55 * authenticity; // 광고 비중이 높으면 상한을 더 강하게 누름
  const score01 = quality * gate;
  return { quality, gate, score01, score100: Math.round(score01 * 100) };
}

// ── 별점 환산 (1~5, 0.5 단위) ──
// 임슐랭은 깐깐하게: 별을 후하게 주지 않는다. 컷을 높게 잡음.
function toStars(score100) {
  if (score100 >= 78) return 5;
  if (score100 >= 66) return 4.5;
  if (score100 >= 55) return 4;
  if (score100 >= 45) return 3.5;
  if (score100 >= 36) return 3;
  if (score100 >= 28) return 2.5;
  if (score100 >= 21) return 2;
  if (score100 >= 14) return 1.5;
  return 1;
}

// 국내 별점은 추천 종합점수가 아니라 진짜 후기의 만족도를 1~5로 표현한다.
function toSatisfactionStars(score01) {
  if (score01 >= 0.82) return 5;
  if (score01 >= 0.72) return 4.5;
  if (score01 >= 0.62) return 4;
  if (score01 >= 0.52) return 3.5;
  if (score01 >= 0.42) return 3;
  if (score01 >= 0.32) return 2.5;
  if (score01 >= 0.22) return 2;
  if (score01 >= 0.12) return 1.5;
  return 1;
}

// ── 한 장소에 대한 전체 평가 ──
// place: { rawRelevanceScore, maxRelevanceScore, reviews:[{title,description,date}] }
function evaluatePlace(place, now = Date.now()) {
  const sourceReviews = place.reviews || [];
  const reviews = dedupeReviews(sourceReviews);
  const { judged, real, adCount } = classifyReviews(reviews);

  const authenticity = authenticityScore(real.length, judged.length);
  const volume = volumeScore(real.length);
  const recency = recencyScore(real, now);
  const relevance = relevanceScore(place.rawRelevanceScore || 0, place.maxRelevanceScore || 1);
  const satisfaction = satisfactionScore(real);

  const { quality, gate, score100 } = combine({ authenticity, volume, recency, relevance, satisfaction });
  let stars = real.length >= 2 ? toSatisfactionStars(satisfaction) : null;
  // 표본이 적을 때 높은 별점만 먼저 튀는 현상을 막는다.
  if (real.length === 2 && stars != null) stars = Math.min(stars, 4);
  else if (real.length < 5 && stars != null) stars = Math.min(stars, 4.5);

  const realPct = judged.length ? Math.round((real.length / judged.length) * 100) : 0;

  return {
    stars,
    score100,
    verified: true,
    insufficient: real.length < 2,
    breakdown: {
      satisfaction: +satisfaction.toFixed(3),
      authenticity: +authenticity.toFixed(3),
      volume: +volume.toFixed(3),
      recency: +recency.toFixed(3),
      relevance: +relevance.toFixed(3),
      quality: +quality.toFixed(3),
      gate: +gate.toFixed(3),
    },
    realCount: real.length,
    totalReviews: judged.length,
    collectedReviews: sourceReviews.length,
    duplicateCount: sourceReviews.length - judged.length,
    adCount,
    realPct,
    realReviews: real, // UI에 진짜 후기만 노출
  };
}

// ────────────────────────────────────────────────────────────────
// 해외 모드 별점
// 국내와 데이터 출처가 다르다: 구글은 실제 평점·리뷰수를 준다.
// 따라서 억지 자체별점 대신 구글 평점을 주축으로, 한국인 블로그 후기를 보조로 쓴다.
//   축1) 구글 평점 (1~5) → 정규화
//   축2) 구글 리뷰 수 (신뢰도, 로그 스케일) — 리뷰 5개짜리 4.9는 못 믿는다
//   축3) 한국인 블로그 후기량 (한국인에게 유명한지)
//   축4) 키워드 적합도
// 구글 평점을 베이지안 축소: 리뷰 적으면 전체 평균(3.8) 쪽으로 당긴다.
// ────────────────────────────────────────────────────────────────
function bayesianRating(rating, count, prior = 3.8, k = 20) {
  if (!rating || !count) return prior;
  return (rating * count + prior * k) / (count + k);
}

function evaluateOverseasPlace(place, now = Date.now()) {
  const rating = place.rating || 0;              // 구글 평점 0~5
  const ratingCount = place.ratingCount || 0;    // 구글 리뷰 수
  const krReviews = place.reviews || [];         // 한국인 블로그 후기(원시)

  // 한국인 블로그도 광고 판정(국내 로직 재사용)
  const { real, adCount } = classifyReviews(krReviews);

  // 축1: 베이지안 보정 평점 → 0~1
  const adjRating = bayesianRating(rating, ratingCount);
  const ratingScore = Math.max(0, Math.min(1, (adjRating - 2.5) / 2.5)); // 2.5→0, 5.0→1

  // 축2: 리뷰 수 신뢰도 → 0~1 (리뷰 500개면 충분히 신뢰)
  const countScore = ratingCount > 0
    ? Math.min(1, Math.log10(ratingCount + 1) / Math.log10(501))
    : 0;

  // 축3: 한국인 후기량 → 0~1 (진짜 후기 5개면 "한국인에게 유명")
  const krScore = real.length > 0
    ? Math.min(1, Math.log2(real.length + 1) / Math.log2(6))
    : 0;

  // 축4: 적합도
  const relevance = relevanceScore(place.rawRelevanceScore || 0, place.maxRelevanceScore || 1);

  // 결합: 구글 평점이 주축(신뢰도로 게이트), 한국인 후기·적합도는 가산
  const gate = 0.6 + 0.4 * countScore; // 리뷰 수 적으면 상한 눌림
  const quality =
    0.50 * ratingScore +
    0.25 * relevance +
    0.25 * krScore;
  const score01 = quality * gate;
  const score100 = Math.round(score01 * 100);
  const stars = toStars(score100);

  return {
    stars,
    score100,
    verified: true,
    googleRating: rating ? +rating.toFixed(1) : null,
    googleRatingCount: ratingCount,
    breakdown: {
      rating: +ratingScore.toFixed(3),
      reviewCount: +countScore.toFixed(3),
      krBuzz: +krScore.toFixed(3),
      relevance: +relevance.toFixed(3),
    },
    realCount: real.length,
    totalReviews: krReviews.length,
    adCount,
    realReviews: real,
  };
}

export {
  adScore, classifyReviews, dedupeReviews, reviewSatisfaction, satisfactionScore,
  recencyScore, volumeScore,
  authenticityScore, relevanceScore, combine, toStars, evaluatePlace,
  toSatisfactionStars, bayesianRating, evaluateOverseasPlace,
};
