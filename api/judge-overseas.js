// 해외 임슐랭 판정: 구글 평점 + 한국인 블로그 후기 종합
// 입력(POST): { places:[{ id, rating, ratingCount, rawRelevanceScore, reviews:[{title,description,date}] }], maxRelevanceScore }
// 출력: { results:[{ id, stars, score100, googleRating, googleRatingCount, breakdown, realCount, realReviews, adCount }] }

import { evaluateOverseasPlace } from "./lib/score.js";
import { guardAccess } from "./lib/guard.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  if (!guardAccess(req, res)) return;
  const { places, maxRelevanceScore } = req.body || {};
  if (!Array.isArray(places)) return res.status(400).json({ error: "places 배열이 필요합니다." });
  if (places.length > 20) return res.status(400).json({ error: "한 번에 최대 20곳까지 판정할 수 있습니다." });

  const safePlaces = places.map((p) => ({
    ...p,
    id: String(p.id || "").slice(0, 160),
    rating: Math.max(0, Math.min(5, Number(p.rating) || 0)),
    ratingCount: Math.max(0, Math.min(100000000, Number(p.ratingCount) || 0)),
    reviews: (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 30).map((r) => ({
      ...r,
      title: String(r.title || "").slice(0, 240),
      description: String(r.description || "").slice(0, 700),
    })),
  }));
  const maxRel = maxRelevanceScore || Math.max(1, ...safePlaces.map((p) => p.rawRelevanceScore || 0));
  const now = Date.now();

  const results = safePlaces.map((p) => {
    const evalResult = evaluateOverseasPlace({ ...p, maxRelevanceScore: maxRel }, now);
    return { id: p.id, ...evalResult };
  });

  return res.status(200).json({ results });
}
