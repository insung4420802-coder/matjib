// 해외 모드: 구글 Places 텍스트 검색 (평점·리뷰수 포함) + 현지 리뷰 번역
// Vercel 환경변수: GOOGLE_MAPS_API_KEY (필수), ANTHROPIC_API_KEY (번역·선택)
//
// 입력(GET): ?query=오사카 소바&lat=..&lng=..  (lat/lng은 선택: 있으면 근처 우선)
// 출력: { places: [{ id, name, address, lat, lng, rating, ratingCount, category,
//                    mapUrl, reviews:[{author,text,textKo,rating,time}] }] }

const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.location", "places.rating", "places.userRatingCount",
  "places.primaryTypeDisplayName", "places.googleMapsUri",
  "places.reviews",
].join(",");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
  const { query, lat, lng, region, radius } = req.query;
  if (!query) return res.status(400).json({ error: "query가 필요합니다." });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY를 등록해 주세요." });

  try {
    // 기준 좌표 결정: 명시적 lat/lng > region 지오코딩
    let center = null;
    if (lat && lng) {
      center = { latitude: Number(lat), longitude: Number(lng) };
    } else if (region) {
      center = await geocode(region, key); // 지역명 → 좌표
    }

    // 텍스트 쿼리에 지역명을 직접 포함시키는 게 가장 확실하다.
    // (구글은 "soba in Tokyo Station" 같은 명시적 지역을 강하게 반영)
    let textQuery = query;
    if (region && !new RegExp(region.split(/\s+/)[0], "i").test(query)) {
      textQuery = query + " " + region;
    }

    const body = {
      textQuery,
      languageCode: "ko",
      maxResultCount: 15,
    };

    // locationBias(circle)로 좌표 근처를 우선. (searchText의 locationRestriction은
    // circle 미지원/불안정 → bias + 텍스트 지역명 조합이 가장 안정적)
    if (center) {
      const rad = Math.min(50000, Math.max(1000, Number(radius) || 15000));
      body.locationBias = { circle: { center, radius: rad } };
    } else if (!region) {
      body.regionCode = "KR"; // 지역 정보가 전혀 없을 때만 한국 폴백
    }

    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELDS,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: "구글 Places 오류", detail });
    }
    const data = await r.json();
    const places = (data.places || []).map((p) => ({
      id: p.id,
      name: p.displayName?.text || "",
      address: p.formattedAddress || "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating || 0,
      ratingCount: p.userRatingCount || 0,
      category: p.primaryTypeDisplayName?.text || "",
      mapUrl: p.googleMapsUri || "",
      reviews: (p.reviews || []).slice(0, 3).map((rv) => ({
        author: rv.authorAttribution?.displayName || "",
        text: rv.originalText?.text || rv.text?.text || "",
        lang: rv.originalText?.languageCode || rv.text?.languageCode || "",
        rating: rv.rating || null,
        time: rv.relativePublishTimeDescription || "",
      })),
    }));

    // 현지어 리뷰 번역 (Claude, 선택) — 한국어가 아닌 리뷰만 모아 배치 번역
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      const toTranslate = [];
      places.forEach((pl, pi) =>
        pl.reviews.forEach((rv, ri) => {
          if (rv.text && rv.lang && !rv.lang.startsWith("ko")) {
            toTranslate.push({ pi, ri, text: rv.text.slice(0, 300) });
          }
        })
      );
      if (toTranslate.length > 0) {
        const translated = await translateBatch(apiKey, toTranslate.slice(0, 30)).catch(() => null);
        if (translated) {
          toTranslate.slice(0, 30).forEach((t, i) => {
            if (translated[i]) places[t.pi].reviews[t.ri].textKo = translated[i];
          });
        }
      }
    }

    return res.status(200).json({ places });
  } catch (e) {
    return res.status(500).json({ error: "검색 중 오류", detail: String(e) });
  }
}

async function geocode(region, key) {
  // 별도 Geocoding API 활성화가 필요 없도록 Places searchText로 지역 좌표를 얻는다
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({ textQuery: region, maxResultCount: 1 }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const loc = data.places?.[0]?.location;
    if (loc) return { latitude: loc.latitude, longitude: loc.longitude };
    return null;
  } catch (_) {
    return null;
  }
}

async function translateBatch(apiKey, items) {
  const list = items.map((it, i) => `[${i}] ${it.text}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 1500,
      system:
        "너는 맛집 리뷰 번역가다. 각 리뷰를 자연스러운 한국어로 번역한다. " +
        '반드시 JSON 배열만 출력: ["번역1","번역2",...]. 입력 순서·개수를 유지하고 다른 텍스트 금지.',
      messages: [{ role: "user", content: list }],
    }),
  });
  if (!r.ok) throw new Error("translate fail");
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
  const arr = JSON.parse(m ? m[0] : "[]");
  return Array.isArray(arr) ? arr : null;
}
