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
  "places.priceLevel", "places.currentOpeningHours",
  "places.reviews",
].join(",");

// 영업시간 요약: openNow + 오늘 휴무 여부 + 오늘 영업시간 텍스트
function hoursInfo(coh) {
  if (!coh) return { openNow: null, closedToday: null, todayHours: null };
  const openNow = coh.openNow === true;
  let todayHours = null, closedToday = null;
  const desc = coh.weekdayDescriptions;
  if (Array.isArray(desc) && desc.length === 7) {
    const idx = (new Date().getDay() + 6) % 7; // Google 배열은 월요일 시작
    todayHours = desc[idx] || null;
    if (todayHours) closedToday = /휴무|closed/i.test(todayHours);
  }
  return { openNow: coh.openNow === undefined ? null : openNow, closedToday, todayHours };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
  const { query, lat, lng, region, radius, mode } = req.query;
  if (!query) return res.status(400).json({ error: "query가 필요합니다." });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY를 등록해 주세요." });

  // 영업시간 단건 조회(국내 카드용): 가게명+주소로 구글에서 찾아 오늘 영업 상태 반환
  if (mode === "hours") {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.displayName,places.currentOpeningHours",
        },
        body: JSON.stringify({ textQuery: query, languageCode: "ko", regionCode: "KR", maxResultCount: 1 }),
      });
      if (!r.ok) return res.status(r.status).json({ error: "구글 오류", detail: await r.text() });
      const data = await r.json();
      const p = (data.places || [])[0];
      if (!p) return res.status(200).json({ found: false });
      return res.status(200).json({
        found: true,
        matchedName: p.displayName?.text || "",
        ...hoursInfo(p.currentOpeningHours),
      });
    } catch (e) {
      return res.status(500).json({ error: "영업시간 조회 오류", detail: String(e) });
    }
  }

  // 자동완성(주소 검색 오버레이용): 타이핑 중 후보 반환 (한국어 입력 → 현지 장소 매칭)
  if (mode === "autocomplete") {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
        body: JSON.stringify({ input: query, languageCode: "ko" }),
      });
      if (!r.ok) return res.status(r.status).json({ error: "구글 오류", detail: await r.text() });
      const data = await r.json();
      const suggestions = (data.suggestions || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
        .slice(0, 6)
        .map((p) => ({
          placeId: p.placeId,
          main: p.structuredFormat?.mainText?.text || p.text?.text || "",
          secondary: p.structuredFormat?.secondaryText?.text || "",
        }));
      return res.status(200).json({ suggestions });
    } catch (e) {
      return res.status(500).json({ error: "자동완성 오류", detail: String(e) });
    }
  }

  // 장소 상세(자동완성 선택 후 좌표 조회)
  if (mode === "detail") {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(query), {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
        },
      });
      if (!r.ok) return res.status(r.status).json({ error: "구글 오류", detail: await r.text() });
      const p = await r.json();
      return res.status(200).json({
        place: {
          id: p.id, name: p.displayName?.text || "",
          address: p.formattedAddress || "",
          lat: p.location?.latitude, lng: p.location?.longitude,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: "상세 조회 오류", detail: String(e) });
    }
  }

  // 장소 찾기 전용(주소 검색 오버레이용): 이름/주소/좌표만 가볍게 반환
  if (mode === "locate") {
    try {
      const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({ textQuery: query, languageCode: "ko", maxResultCount: 6 }),
      });
      if (!r.ok) return res.status(r.status).json({ error: "구글 오류", detail: await r.text() });
      const data = await r.json();
      const places = (data.places || []).map((p) => ({
        id: p.id, name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        lat: p.location?.latitude, lng: p.location?.longitude,
      }));
      return res.status(200).json({ places });
    } catch (e) {
      return res.status(500).json({ error: "검색 오류", detail: String(e) });
    }
  }

  try {
    // 기준 좌표 결정: 명시적 lat/lng > region 지오코딩
    let center = null;
    if (lat && lng) {
      center = { latitude: Number(lat), longitude: Number(lng) };
    } else if (region) {
      center = await geocode(region, key); // 지역명 → 좌표
    }

    // 좌표가 있으면 텍스트에 지역명을 넣지 않는다.
    // ("후쿠오카"가 텍스트에 들어가면 구글이 하카타 유명집을 끼워넣는 원인)
    // 좌표가 없을 때만(지오코딩 실패) 지역명을 텍스트로 폴백.
    let textQuery = query;
    if (!center && region && !new RegExp(region.split(/\s+/)[0], "i").test(query)) {
      textQuery = query + " " + region;
    }

    const rad = Math.min(50000, Math.max(1000, Number(radius) || 15000));
    const body = {
      textQuery,
      languageCode: "ko",
      maxResultCount: 20,
    };

    if (center) {
      body.locationBias = { circle: { center, radius: rad } };
      // 반경이 좁으면 가까운 순으로 (1km 검색인데 3km 밖 유명집이 위로 오는 것 방지)
      if (rad <= 5000) body.rankPreference = "DISTANCE";
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
      priceLevel: p.priceLevel || null, // PRICE_LEVEL_INEXPENSIVE ~ VERY_EXPENSIVE
      ...hoursInfo(p.currentOpeningHours),
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

    return res.status(200).json({
      places,
      center: center ? { lat: center.latitude, lng: center.longitude } : null,
    });
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
