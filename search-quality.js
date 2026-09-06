import { reviewMatchesPlace } from './review-identity.js';

export const normalize = (value) => String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const textOf = (review) => [review.title, review.description, review.text, review.textKo].filter(Boolean).join(' ');

// Keyword hits are a retrieval signal, never proof of current menu availability.
export function positiveMention(text, term) {
  const hay = normalize(text).replace(/(?:가|이)?들어간/g, ''), needle = normalize(term);
  if (!needle || needle.length < 2) return false;
  if (/^[a-z0-9\s-]+$/i.test(term)) {
    const word = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (!new RegExp('(?:^|[^a-z])' + word + '(?=$|[^a-z])', 'i').test(String(text))) return false;
  }
  let offset = hay.indexOf(needle);
  while (offset >= 0) {
    const around = hay.slice(Math.max(0, offset - 12), offset + needle.length + 22);
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const negative = new RegExp(escaped + '(?:은|는|이|가|을|를|도)?(?:메뉴)?(?:없|안팔|안하|하지않|판매(?:하지|안|중단|종료)|제공(?:하지|안|중단|종료)|품절|못먹|아닌|아니|말고|isnotavailable|isntavailable|isn’tavailable|notavailable|isnolongerserved)|(?:no|without|notserving|notserve|dontserve|doesntserve)' + escaped, 'i');
    const differentDish = ['소바', 'そば', 'soba'].includes(needle) && /(?:야키|焼き|yaki)$/.test(hay.slice(0, offset));
    if (!differentDish && !negative.test(around)) return true;
    offset = hay.indexOf(needle, offset + needle.length);
  }
  return false;
}

export function relevanceForPlace(place, conversion = {}, reviews = null) {
  const name = place.place_name || place.name || '';
  const category = place.category_name || place.category || '';
  const exact = [...new Set([conversion.tiers?.exact, ...(conversion.menuAliases || [])].filter(Boolean))];
  const broad = [conversion.tiers?.broad].filter(Boolean);
  const wider = [conversion.tiers?.broader].filter(Boolean);
  const blogs = (reviews || place._reviews || []).filter((r) => reviewMatchesPlace(r, name));
  const local = place.reviews || [];
  const texts = [...blogs, ...local].map(textOf);
  const has = (terms, text) => terms.some((term) => positiveMention(text, term));
  const exactName = has(exact, name), exactCategory = has(exact, category);
  const exactReviews = Math.min(3, texts.filter((text) => has(exact, text)).length);
  const broadHit = has(broad, name + ' ' + category) || texts.some((text) => has(broad, text));
  const widerHit = has(wider, name + ' ' + category);
  const absolute = exactName ? 0.9 : exactCategory ? 0.8 : exactReviews ? 0.55 + exactReviews * 0.1 : broadHit ? 0.4 : widerHit ? 0.15 : place._sourceLevel === 'exact' ? 0.1 : 0;
  return { score: Math.round(absolute * 20), absolute, tier: exactName || exactCategory || exactReviews ? 'exact' : broadHit ? 'broad' : 'broader' };
}

export function acceptedReviews(place) {
  const imm = place._imm;
  if (!imm || imm.verified === false) return place._reviews || [];
  return [...(imm.realReviews || []), ...(imm.uncertainReviews || [])];
}

export function evidenceSources(place, conversion = {}, mode = 'domestic') {
  const terms = [conversion.tiers?.exact, ...(conversion.menuAliases || [])].filter(Boolean);
  const name = place.place_name || place.name || '';
  const validUrl = (value) => {
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !/\s/.test(value); }
    catch (_) { return false; }
  };
  const validSource = (source) => source.text.trim() && validUrl(source.url);
  const blogs = acceptedReviews(place).filter((review) => reviewMatchesPlace(review, name)).map((review, i) => ({
    id: 'b' + i, title: String(review.title || ''), text: String(review.description || ''),
    url: String(review.link || ''), date: String(review.date || ''), kind: 'blog',
  })).filter(validSource);
  const google = mode === 'overseas' ? (place.reviews || []).map((review, i) => ({
    id: 'g' + i, title: review.author ? String(review.author) + ' · Google 후기' : 'Google 후기',
    text: String(review.text || review.textKo || ''), url: String(review.url || place.mapUrl || ''),
    date: String(review.publishTime || review.time || ''), kind: 'google',
  })).filter(validSource) : [];
  const rank = (a, b) => Number(terms.some((t) => normalize(b.text + b.title).includes(normalize(t)))) -
    Number(terms.some((t) => normalize(a.text + a.title).includes(normalize(t)))) || b.date.localeCompare(a.date);
  blogs.sort(rank); google.sort(rank);
  const pool = mode === 'overseas' ? [...google.slice(0, 2), ...blogs.slice(0, 1), ...google.slice(2), ...blogs.slice(1)] : blogs;
  const seen = new Set();
  return pool.filter((source) => {
    if (!validSource(source)) return false;
    const key = source.kind === 'blog' ? source.url : normalize(source.text);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 3).map((source) => ({ ...source, title: source.title.slice(0, 200), text: source.text.slice(0, 700) }));
}

export function evidenceConflict(place) {
  return place._evidence?.menuStatus === 'contradicted' || (place._evidence?.constraints || []).some((c) => c.status === 'contradicted');
}

export function compareRecommendations(a, b) {
  const evidenceRank = (p) => evidenceConflict(p) ? -1 : p._evidence?.menuStatus === 'supported' ? 1 : 0;
  const tierRank = { exact: 2, broad: 1, broader: 0 };
  return evidenceRank(b) - evidenceRank(a) ||
    (tierRank[b._tier] || 0) - (tierRank[a._tier] || 0) ||
    (b._imm?.score100 || 0) - (a._imm?.score100 || 0) ||
    (b._absoluteRel || 0) - (a._absoluteRel || 0) ||
    Number(a.distance || 0) - Number(b.distance || 0);
}
