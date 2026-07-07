// 네이버 블로그 검색 프록시 (광고성 후기 필터링 포함)
// Vercel 환경변수 필요: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET

const AD_PATTERNS = [
  /협찬/, /원고료/, /제공\s*받/, /제공받아/, /체험단/, /소정의/,
  /지원\s*받/, /초청\s*받/, /무상\s*제공/, /광고\s*포함/, /파트너스/,
  /유료\s*광고/, /서포터즈/, /앰배서더/,
];

function stripTags(s) {
  return (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function looksLikeAd(item) {
  const text = stripTags(item.title) + " " + stripTags(item.description);
  return AD_PATTERNS.some((p) => p.test(text));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  const { query, display } = req.query;
  if (!query) {
    return res.status(400).json({ error: "query 파라미터가 필요합니다." });
  }

  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({
      error: "Vercel 환경변수에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 등록해 주세요.",
    });
  }

  try {
    // 광고 글이 걸러질 것을 감안해 넉넉히 받아온 뒤 필터링
    const url =
      "https://openapi.naver.com/v1/search/blog.json?query=" +
      encodeURIComponent(query) +
      "&display=20&sort=sim";

    const r = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": id,
        "X-Naver-Client-Secret": secret,
      },
    });

    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: "네이버 API 오류", detail: body });
    }

    const data = await r.json();
    const items = data.items || [];

    const clean = [];
    let adCount = 0;

    for (const item of items) {
      if (looksLikeAd(item)) {
        adCount++;
        continue;
      }
      clean.push({
        title: stripTags(item.title),
        description: stripTags(item.description),
        link: item.link,
        blogger: item.bloggername,
        date: item.postdate, // YYYYMMDD
      });
      if (clean.length >= Number(display || 3)) break;
    }

    return res.status(200).json({
      reviews: clean,
      adFiltered: adCount,
      total: items.length,
    });
  } catch (e) {
    return res.status(500).json({ error: "후기 검색 중 오류가 발생했습니다.", detail: String(e) });
  }
}
