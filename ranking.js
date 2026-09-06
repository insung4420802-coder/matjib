// Shared scoring formulas for server evaluation and client-side cleaned relevance.
export function combine({ authenticity, volume, recency, relevance, satisfaction = 0.55 }) {
  const quality = 0.50 * satisfaction + 0.20 * relevance + 0.15 * volume + 0.15 * recency;
  const gate = 0.45 + 0.55 * authenticity;
  const score01 = quality * gate;
  return { quality, gate, score01, score100: Math.round(score01 * 100) };
}

export function combineOverseas({ rating, relevance, krBuzz, reviewCount }) {
  const quality = 0.60 * rating + 0.35 * relevance + 0.05 * krBuzz;
  const gate = 0.6 + 0.4 * reviewCount;
  const score01 = quality * gate;
  return { quality, gate, score01, score100: Math.round(score01 * 100) };
}

export function toStars(score100) {
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

// A cleaned menu score must update the whole ranking, not only its displayed breakdown.
// Domestic stars describe satisfaction and therefore remain independent of relevance.
export function rescoreWithRelevance(imm, absoluteRelevance, overseas = false) {
  if (!imm || imm.verified === false || !imm.breakdown ||
      !Number.isFinite(imm.score100) || !Number.isFinite(absoluteRelevance)) return imm;
  const fields = overseas ? ['rating', 'krBuzz', 'reviewCount'] : ['authenticity', 'volume', 'recency', 'satisfaction'];
  if (!fields.every((key) => Number.isFinite(imm.breakdown[key]))) return imm;
  const relevance = Math.max(0, Math.min(1, absoluteRelevance));
  const breakdown = { ...imm.breakdown, relevance };
  const result = overseas ? combineOverseas(breakdown) : combine(breakdown);
  return {
    ...imm,
    score100: result.score100,
    stars: overseas ? toStars(result.score100) : imm.stars,
    breakdown: { ...breakdown, relevance: +relevance.toFixed(3),
      quality: +result.quality.toFixed(3), gate: +result.gate.toFixed(3) },
  };
}
