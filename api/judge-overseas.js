// 해외 임슐랭 판정: 구글 평점 + 한국인 블로그 후기 종합
// 입력(POST): { places:[{ id, rating, ratingCount, rawRelevanceScore, reviews:[{title,description,date}] }], maxRelevanceScore }
// 출력: { results:[{ id, stars, score100, googleRating, googleRatingCount, breakdown, realCount, realReviews, adCount }] }

import { evaluateOverseasPlace } from "./lib/score.js";
import { guardAccess, cleanText } from "./lib/guard.js";

function boundedNumber(value, max) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function reviewLink(value) {
  try {
    const url = new URL(cleanText(value, 700));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  if (!guardAccess(req, res)) return;
  const { places, maxRelevanceScore } = req.body || {};
  if (!Array.isArray(places)) return res.status(400).json({ error: "places 배열이 필요합니다." });
  if (places.length > 20) return res.status(400).json({ error: "한 번에 최대 20곳까지 판정할 수 있습니다." });

  const safePlaces = places.filter((p) => p && typeof p === "object" && !Array.isArray(p)).map((p) => ({
    id: cleanText(["string", "number"].includes(typeof p.id) ? String(p.id) : "", 160),
    placeName: cleanText(p.placeName, 160),
    rawRelevanceScore: boundedNumber(p.rawRelevanceScore, 100),
    absoluteRelevance: Number.isFinite(p.absoluteRelevance) ? Math.max(0, Math.min(1, p.absoluteRelevance)) : undefined,
    rating: boundedNumber(p.rating, 5),
    ratingCount: Math.floor(boundedNumber(p.ratingCount, 100000000)),
    reviews: (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 50)
      .filter((r) => r && typeof r === "object" && !Array.isArray(r)).map((r) => ({
      title: cleanText(r.title, 240),
      description: cleanText(r.description, 700),
      date: cleanText(r.date, 20),
      link: reviewLink(r.link),
      blogger: cleanText(r.blogger, 100),
    })),
  })).filter((p) => p.id);
  const maxRel = boundedNumber(maxRelevanceScore, 100) || Math.max(1, ...safePlaces.map((p) => p.rawRelevanceScore || 0));
  const now = Date.now();

  const results = safePlaces.map((p) => {
    const evalResult = evaluateOverseasPlace({ ...p, maxRelevanceScore: maxRel }, now);
    return { id: p.id, ...evalResult };
  });

  return res.status(200).json({ results });
}
