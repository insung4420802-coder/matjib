// 후기 요약의 관찰 가능한 신호만 평가한다. Haiku는 메뉴 근거 검토에 사용한다.
import { evaluatePlace, filterReviewsForPlace } from "./lib/score.js";
import { guardAccess, cleanText } from "./lib/guard.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  if (!guardAccess(req, res)) return;
  const { places, maxRelevanceScore } = req.body || {};
  if (!Array.isArray(places) || places.length > 20) return res.status(400).json({ error: "최대 20곳의 places 배열이 필요합니다." });
  const safePlaces = places.filter((p) => p && typeof p === "object").map((p) => ({
    id: cleanText(p.id, 160), placeName: cleanText(p.placeName, 160),
    rawRelevanceScore: Math.max(0, Math.min(100, Number(p.rawRelevanceScore) || 0)),
    absoluteRelevance: Number.isFinite(p.absoluteRelevance) ? Math.max(0, Math.min(1, p.absoluteRelevance)) : undefined,
    reviews: filterReviewsForPlace((Array.isArray(p.reviews) ? p.reviews : []).slice(0, 50).map((r) => ({
      title: cleanText(r?.title, 240), description: cleanText(r?.description, 700),
      date: cleanText(r?.date, 20), link: cleanText(r?.link, 700), blogger: cleanText(r?.blogger, 100),
    })), cleanText(p.placeName, 160)),
  }));
  const maxRel = Math.max(1, Number(maxRelevanceScore) || 0, ...safePlaces.map((p) => p.rawRelevanceScore));
  return res.status(200).json({
    results: safePlaces.map((p) => ({ id: p.id, ...evaluatePlace({ ...p, maxRelevanceScore: maxRel }) })),
    refined: false,
  });
}
