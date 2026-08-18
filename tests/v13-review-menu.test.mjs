import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import keywordHandler from "../api/keywords.js";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const blog = fs.readFileSync(new URL("../api/blog.js", import.meta.url), "utf8");
const judge = fs.readFileSync(new URL("../api/judge.js", import.meta.url), "utf8");
const judgeOverseas = fs.readFileSync(new URL("../api/judge-overseas.js", import.meta.url), "utf8");
const gplaces = fs.readFileSync(new URL("../api/gplaces.js", import.meta.url), "utf8");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
  };
}

test("국내·해외 후기 수집과 화면 노출 상한은 v12의 두 배 이상이다", () => {
  assert.match(blog, /display=50/);
  assert.match(judge, /slice\(0, 50\)/);
  assert.match(judgeOverseas, /slice\(0, 50\)/);
  assert.match(gplaces, /reviews \|\| \[\]\)\.slice\(0, 5\)/);
  assert.match(html, /realReviews\.slice\(0, 6\)/);
  assert.match(html, /gReviews\.slice\(0, 4\)/);
  assert.match(html, /krRealReviews\.slice\(0, 4\)/);
  assert.match(html, /-webkit-line-clamp: 3/);
});

test("추상 검색어는 메뉴 후보와 직접 입력을 거쳐 한 메뉴로 집중 검색한다", () => {
  assert.match(html, /id="menuChoice"/);
  assert.match(html, /id="customMenu"/);
  assert.match(html, /function renderMenuChoice\(/);
  assert.match(html, /function focusedMenuConversion\(/);
  assert.match(html, /keywordPlan: \[\{ keyword: query, level: "exact" \}\]/);
  assert.match(html, /gquery: \[query\]/);
  assert.match(html, /menuCandidates \|\| \[\]\)\.slice\(0, 12\)/);
  assert.match(html, /selectedRegion \|\| base\.region \|\| ""/);
  assert.match(html, /preparedConversion\.region = options\.regionHint/);
});

test("키워드 API는 얼큰한 국물에 충분한 선택 후보를 반환한다", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const menuCandidates = [
    "해장국", "짬뽕", "마라탕", "콩나물국밥", "육개장",
    "순두부찌개", "김치찌개", "감자탕", "매운탕", "닭개장",
  ].map((label) => ({ label, query: label }));
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          search: ["해장국", "짬뽕", "마라탕"],
          match: ["해장국", "짬뽕", "마라탕", "국물"],
          food: ["해장국", "짬뽕", "마라탕"],
          theme: [],
          menuCandidates,
          requiresMenuChoice: true,
          tiers: { exact: "해장국", broad: "국물요리", broader: "한식" },
          region: "",
          confidence: 0.8,
          needsClarification: false,
        }),
      }],
    }),
  });

  try {
    const req = { method: "POST", headers: {}, body: { query: "얼큰한 국물" } };
    const res = responseRecorder();
    await keywordHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.requiresMenuChoice, true);
    assert.equal(res.body.menuCandidates.length, 10);
    assert.deepEqual(res.body.menuCandidates.slice(0, 3).map((item) => item.label), ["해장국", "짬뽕", "마라탕"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
