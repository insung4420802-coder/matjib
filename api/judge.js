// 임슐랭 판정 엔드포인트
// 입력: { places: [{ id, rawRelevanceScore, reviews:[{title,description,date,link,blogger}] }], maxRelevanceScore }
// 출력: { results: [{ id, stars, score100, realPct, adCount, totalReviews, realReviews, breakdown }] }
//
// 1) 휴리스틱(score.js)으로 전 장소를 즉시 평가 (무료·빠름)
// 2) ANTHROPIC_API_KEY가 있으면, 광고 확률이 애매한(0.3~0.7) 후기만 골라
//    Claude로 배치 재판정 → 정확도 향상. 없거나 실패해도 1)의 결과로 응답.

import { evaluatePlace, adScore } from "./lib/score.js";

const BORDERLINE_LOW = 0.3;
const BORDERLINE_HIGH = 0.7;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });

  const { places, maxRelevanceScore } = req.body || {};
  if (!Array.isArray(places)) return res.status(400).json({ error: "places 배열이 필요합니다." });

  const maxRel = maxRelevanceScore || Math.max(1, ...places.map((p) => p.rawRelevanceScore || 0));
  const now = Date.now();

  // ── 1) 휴리스틱 즉시 평가 ──
  const withRel = places.map((p) => ({ ...p, maxRelevanceScore: maxRel }));

  // ── 2) 애매한 후기만 Claude 재판정 (선택) ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let claudeVerdicts = null;
  if (apiKey) {
    const borderline = [];
    withRel.forEach((p, pi) => {
      (p.reviews || []).forEach((r, ri) => {
        const prob = adScore((r.title || "") + " " + (r.description || ""));
        if (prob > BORDERLINE_LOW && prob < BORDERLINE_HIGH) {
          borderline.push({ pi, ri, title: r.title, description: r.description });
        }
      });
    });
    // 너무 많으면 상위 40개만 (비용 방어)
    const batch = borderline.slice(0, 40);
    if (batch.length > 0) {
      claudeVerdicts = await judgeWithClaude(apiKey, batch).catch(() => null);
    }
  }

  // ── 3) Claude 판정을 반영해 후기 override 후 최종 평가 ──
  const results = withRel.map((p, pi) => {
    let reviews = p.reviews || [];
    if (claudeVerdicts) {
      reviews = reviews.map((r, ri) => {
        const key = `${pi}:${ri}`;
        if (key in claudeVerdicts) {
          return { ...r, _forceAd: claudeVerdicts[key] === "ad", _forceReal: claudeVerdicts[key] === "real" };
        }
        return r;
      });
    }
    const evalResult = evaluatePlaceWithOverride({ ...p, reviews }, now);
    return { id: p.id, ...evalResult };
  });

  return res.status(200).json({ results, refined: !!claudeVerdicts });
}

// score.js의 evaluatePlace를 쓰되, Claude가 강제 판정한 후기를 반영
function evaluatePlaceWithOverride(place, now) {
  // _forceAd/_forceReal이 있으면 해당 후기의 판정을 덮어쓰기 위해
  // description에 신호를 주입하지 않고, evaluatePlace 내부 재판정을 우회한다.
  // 간단히: 강제 광고는 제목/요약을 협찬 문구로 치환, 강제 진짜는 진짜 신호 주입.
  const patched = {
    ...place,
    reviews: (place.reviews || []).map((r) => {
      if (r._forceAd) return { ...r, description: (r.description || "") + " 협찬 제공받아" };
      if (r._forceReal) return { ...r, description: (r.description || "") + " 내돈내산 솔직후기" };
      return r;
    }),
  };
  return evaluatePlace(patched, now);
}

async function judgeWithClaude(apiKey, batch) {
  const list = batch
    .map((b, i) => `${i}. 제목: ${b.title}\n   요약: ${b.description}`)
    .join("\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 500,
      system:
        "너는 네이버 블로그 맛집 후기가 '광고/협찬'인지 '진짜 내돈내산 후기'인지 판별하는 전문가다. " +
        "각 항목을 ad(광고성/협찬) 또는 real(진짜후기)로 분류한다. " +
        "판단 근거: 협찬/제공/체험단/원고료 언급, 지나치게 홍보성인 톤, 단점이 전혀 없음 → ad. " +
        "구체적 경험, 솔직한 단점, 재방문/웨이팅 언급, 개인적 감상 → real. " +
        '반드시 JSON 객체만 출력: {"0":"ad","1":"real",...}. 다른 텍스트 금지.',
      messages: [{ role: "user", content: list }],
    }),
  });
  if (!r.ok) throw new Error("claude fail");
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.replace(/```json|```/g, "").trim().match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : "{}");

  // 인덱스 → "pi:ri" 키로 변환
  const verdicts = {};
  batch.forEach((b, i) => {
    const v = parsed[String(i)];
    if (v === "ad" || v === "real") verdicts[`${b.pi}:${b.ri}`] = v;
  });
  return verdicts;
}
