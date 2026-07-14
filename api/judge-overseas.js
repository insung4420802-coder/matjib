// 해외 임슐랭 판정: 구글 평점 + 한국인 블로그 후기 종합
// 입력(POST): { places:[{ id, rating, ratingCount, rawRelevanceScore, reviews:[{title,description,date}] }], maxRelevanceScore }
// 출력: { results:[{ id, stars, score100, googleRating, googleRatingCount, breakdown, realCount, realReviews, adCount }] }

import { evaluateOverseasPlace } from "./lib/score.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  const { places, maxRelevanceScore } = req.body || {};
  if (!Array.isArray(places)) return res.status(400).json({ error: "places 배열이 필요합니다." });

  const maxRel = maxRelevanceScore || Math.max(1, ...places.map((p) => p.rawRelevanceScore || 0));
  const now = Date.now();

  const results = places.map((p) => {
    const evalResult = evaluateOverseasPlace({ ...p, maxRelevanceScore: maxRel }, now);
    return { id: p.id, ...evalResult };
  });

  return res.status(200).json({ results });
}
