// 네이버 블로그 검색 프록시 — 원시 후기를 넉넉히 반환 (광고 판정은 judge.js가 담당)
// Vercel 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET

function stripTags(s) {
  return (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "query 파라미터가 필요합니다." });

  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({ error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET을 등록해 주세요." });
  }

  try {
    const url = "https://openapi.naver.com/v1/search/blog.json?query=" +
      encodeURIComponent(query) + "&display=30&sort=sim";
    const r = await fetch(url, {
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: "네이버 API 오류", detail: body });
    }
    const data = await r.json();
    const items = (data.items || []).map((it) => ({
      title: stripTags(it.title),
      description: stripTags(it.description),
      link: it.link,
      blogger: it.bloggername,
      date: it.postdate,
    }));
    return res.status(200).json({ items, total: data.total || items.length });
  } catch (e) {
    return res.status(500).json({ error: "후기 검색 중 오류", detail: String(e) });
  }
}
