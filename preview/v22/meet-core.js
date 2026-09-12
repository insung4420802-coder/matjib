// Pure geometry for the preview. Distances are straight-line distances, not routes.
const EARTH_RADIUS_KM = 6371.0088;
const rad = degrees => degrees * Math.PI / 180;
const deg = radians => radians * 180 / Math.PI;

export function normalizePoint(point, label = '위치') {
  if (!point || typeof point !== 'object') throw new Error(`${label} 정보를 입력해 주세요.`);
  const rawLat = point.lat;
  const rawLng = point.lng;
  const missing = value => !['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim());
  if (missing(rawLat) || missing(rawLng)) {
    throw new Error(`${label}의 위도와 경도를 모두 입력해 주세요.`);
  }
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`${label}의 위도는 -90~90 사이여야 합니다.`);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`${label}의 경도는 -180~180 사이여야 합니다.`);
  const name = String(point.name || label).trim().slice(0, 80) || label;
  return { ...point, name, lat, lng };
}

export function distanceKm(a, b) {
  const p = normalizePoint(a);
  const q = normalizePoint(b);
  const dLat = rad(q.lat - p.lat);
  const dLng = rad(q.lng - p.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, h));
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

export function validateOrigins(origins) {
  if (!Array.isArray(origins) || origins.length < 2 || origins.length > 6) throw new Error('출발지는 2~6개를 입력해 주세요.');
  return origins.map((origin, i) => normalizePoint(origin, `출발지 ${i + 1}`));
}

// A spherical centroid stays near ±180° when points cross the date line.
// Antipodal sets have no unique centroid; a medoid is an explicit fallback.
export function referenceCenter(origins) {
  const points = validateOrigins(origins);
  const vector = points.reduce((sum, point) => {
    const lat = rad(point.lat);
    const lng = rad(point.lng);
    return [sum[0] + Math.cos(lat) * Math.cos(lng), sum[1] + Math.cos(lat) * Math.sin(lng), sum[2] + Math.sin(lat)];
  }, [0, 0, 0]);
  const length = Math.hypot(...vector);
  if (length < 1e-10) {
    const medoid = points.map((point, index) => ({ point, index, sum: points.reduce((sum, other) => sum + distanceKm(point, other), 0) }))
      .sort((a, b) => a.sum - b.sum || a.index - b.index)[0].point;
    return { lat: medoid.lat, lng: medoid.lng, method: 'medoid', name: '참고 중심점' };
  }
  return { lat: deg(Math.atan2(vector[2], Math.hypot(vector[0], vector[1]))), lng: deg(Math.atan2(vector[1], vector[0])), method: 'centroid', name: '참고 중심점' };
}

export function rankCandidates(origins, candidates) {
  const points = validateOrigins(origins);
  if (!Array.isArray(candidates)) throw new Error('후보 목록을 확인해 주세요.');
  if (candidates.length > 50) throw new Error('후보는 최대 50곳까지 비교할 수 있습니다.');
  return candidates.map((candidate, index) => {
    const place = normalizePoint(candidate, `후보 ${index + 1}`);
    const distances = points.map(origin => ({ name: origin.name, km: distanceKm(origin, place) }));
    const values = distances.map(item => item.km);
    const maximumKm = Math.max(...values);
    const minimumKm = Math.min(...values);
    return { ...place, id: String(place.id || `candidate-${index}`), distances, maximumKm, minimumKm, spreadKm: maximumKm - minimumKm, averageKm: values.reduce((sum, value) => sum + value, 0) / values.length, originalIndex: index };
  }).sort((a, b) => a.maximumKm - b.maximumKm || a.spreadKm - b.spreadKm || a.averageKm - b.averageKm || a.originalIndex - b.originalIndex);
}

export function mapUrl(point) {
  const valid = normalizePoint(point);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${valid.lat},${valid.lng}`)}`;
}
