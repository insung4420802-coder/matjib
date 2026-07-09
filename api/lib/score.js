// ────────────────────────────────────────────────────────────────
// 임슐랭 별점 엔진
// 4개 축을 논리적으로 결합해 0~100 점수 → 별 1~5개로 환산한다.
//
// 설계 원칙 (중요):
//  1) 진짜후기 밀도(authenticity)는 "가산점"이 아니라 "게이트(곱셈)"다.
//     광고밭이면 다른 점수가 아무리 높아도 별점이 오르면 안 된다.
//  2) 표본 수가 적으면 밀도를 신뢰할 수 없다 → 베이지안 축소(shrinkage)로
//     후기 3개짜리 100%가 후기 30개짜리 80%를 이기지 못하게 한다.
//  3) 키워드 적합도가 낮으면(엉뚱한 업종) 아예 후보에서 제외한다(별점 이전 단계).
//  4) 모든 축은 0~1로 정규화한 뒤 결합한다.
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
    const prob = adScore(text);
    return { ...r, adProb: prob, isAd: prob >= 0.5 };
  });
  const real = judged.filter((r) => !r.isAd);
  return { judged, real, adCount: judged.length - real.length };
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

// ── 최종 결합 ──
// authenticity를 게이트(곱셈)로, 나머지 3축을 가중 가산 품질점수로.
//   quality = 0.45*relevance + 0.35*volume + 0.20*recency   (0~1)
//   gate    = authenticity 를 0.55~1.0 구간으로 매핑
//             (밀도 0.5=중립이면 게이트 0.775, 밀도 1.0이면 1.0, 0이면 0.55)
//   score01 = quality * gate
// 이렇게 하면 광고밭(gate 낮음)은 상한이 눌리고,
// 적합하고 후기 많고 신선한 곳(quality 높음)이 위로 온다.
function combine({ authenticity, volume, recency, relevance }) {
  const quality = 0.45 * relevance + 0.35 * volume + 0.20 * recency;
  const gate = 0.55 + 0.45 * authenticity; // 0.55 ~ 1.0
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

// ── 한 장소에 대한 전체 평가 ──
// place: { rawRelevanceScore, maxRelevanceScore, reviews:[{title,description,date}] }
function evaluatePlace(place, now = Date.now()) {
  const reviews = place.reviews || [];
  const { judged, real, adCount } = classifyReviews(reviews);

  const authenticity = authenticityScore(real.length, judged.length);
  const volume = volumeScore(real.length);
  const recency = recencyScore(real, now);
  const relevance = relevanceScore(place.rawRelevanceScore || 0, place.maxRelevanceScore || 1);

  const { quality, gate, score100 } = combine({ authenticity, volume, recency, relevance });
  const stars = toStars(score100);

  const realPct = judged.length ? Math.round((real.length / judged.length) * 100) : 0;

  return {
    stars,
    score100,
    breakdown: {
      authenticity: +authenticity.toFixed(3),
      volume: +volume.toFixed(3),
      recency: +recency.toFixed(3),
      relevance: +relevance.toFixed(3),
      quality: +quality.toFixed(3),
      gate: +gate.toFixed(3),
    },
    realCount: real.length,
    totalReviews: judged.length,
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
  adScore, classifyReviews, recencyScore, volumeScore,
  authenticityScore, relevanceScore, combine, toStars, evaluatePlace,
  bayesianRating, evaluateOverseasPlace,
};
