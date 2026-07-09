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
  const { query, lat, lng } = req.query;
  if (!query) return res.status(400).json({ error: "query가 필요합니다." });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY를 등록해 주세요." });

  try {
    const body = {
      textQuery: query,
      languageCode: "ko",       // 가능한 항목은 한국어로
      regionCode: "KR",
      maxResultCount: 15,
    };
    if (lat && lng) {
      body.locationBias = {
        circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: 20000 },
      };
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
