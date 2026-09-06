import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { rescoreWithRelevance } from "../ranking.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\s+type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join("\n");
function functionSource(name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(script);
  assert.ok(start, `${name} 함수가 있어야 한다`);
  const after = script.slice(start.index);
  const next = /\n(?:async )?function \w+\(/.exec(after);
  return next ? after.slice(0, next.index) : after;
}
const count = (text, expression) => [...text.matchAll(expression)].length;

function evidenceHarness(fetcher, generation = 1) {
  const context = vm.createContext({
    searchMode: "overseas", searchGen: generation, evidenceRun: { checked: 0, refined: false },
    els: { loading: { innerHTML: "" }, query: { value: "소바" } },
    isPlaceHidden: (place) => place.hidden === true,
    evidenceSources: (place) => place.availableSources || [],
    evidenceConflict: (place) => place._evidence?.menuStatus === "contradicted",
    rescoreWithRelevance,
    apiFetch: fetcher,
  });
  vm.runInContext(functionSource("reviewMenuEvidence"), context);
  return context;
}

test("메뉴 증거 검토는 국내·해외 파이프라인 끝에서 한 번씩 실행하고 렌더에는 붙이지 않는다", () => {
  assert.ok(script.includes("from './search-quality.js'"));
  assert.ok(script.includes("from './ranking.js'"));
  assert.equal(count(script, /apiFetch\("\/api\/menu-evidence"/g), 1);
  for (const name of ["runDomesticSearch", "runOverseasSearch"]) {
    const body = functionSource(name);
    assert.equal(count(body, /await reviewMenuEvidence\(/g), 1);
    assert.ok(body.indexOf("await reviewMenuEvidence(") < body.indexOf("champion = pickChampion("));
    assert.ok(body.indexOf("champion = pickChampion(") < body.lastIndexOf("renderResults()"));
  }
  for (const name of ["renderResults", "renderPlace", "renderMenuEvidence"]) {
    assert.equal(count(functionSource(name), /(?:reviewMenuEvidence\(|apiFetch\("\/api\/menu-evidence")/g), 0);
  }
});

test("옛 한줄평 함수가 남아 있어도 자동 렌더에서 추가 요약 API를 호출하지 않는다", () => {
  const definitions = count(script, /(?:async )?function loadChampionSummary\s*\(/g);
  const mentions = count(script, /\bloadChampionSummary\s*\(/g);
  assert.equal(mentions, definitions, "함수 선언 외 호출이 없어야 한다");
  for (const name of ["runDomesticSearch", "runOverseasSearch", "renderResults", "renderPlace"]) {
    const body = functionSource(name);
    assert.ok(!body.includes('"/api/summary"'));
    assert.ok(!body.includes("loadChampionSummary("));
  }
});

test("두 모드 모두 광고 판정 뒤 채택한 후기로 적합도와 최종 점수를 다시 계산한다", () => {
  for (const [name, judge, conversion, overseas] of [["runDomesticSearch", "judgePlaces", "conversion", false], ["runOverseasSearch", "judgeOverseas", "conv", true]]) {
    const body = functionSource(name);
    const cleanCall = `relevanceForPlace(p, ${conversion}, acceptedReviews(p))`;
    assert.ok(body.indexOf(`await ${judge}(`) < body.indexOf(cleanCall));
    assert.ok(body.includes(`rescoreWithRelevance(p._imm, clean.absolute${overseas ? ", true" : ""})`));
    assert.ok(body.indexOf(cleanCall) < body.indexOf("await reviewMenuEvidence("));
    assert.match(body, /await reviewMenuEvidence\([^;]+;\s*if \(gen !== searchGen\) return;/);
  }
});

test("증거 요청은 원문·조건을 보존해 유효 후보 최대 5곳을 한 요청으로 보낸다", async () => {
  const calls = [];
  const context = evidenceHarness(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ refined: true, results: [] }) };
  });
  const source = { id: "g0", title: "실제 후기", text: "Soba was excellent", url: "https://example.com/review" };
  const places = Array.from({ length: 8 }, (_, index) => ({ id: index, name: `식당${index}`, availableSources: [source] }));
  places[0].hidden = true;
  places[1].availableSources = [];
  await context.reviewMenuEvidence(places, { tiers: { exact: "소바" }, constraints: ["해산물 제외", "주차 가능"] }, "해산물 없는 소바, 주차 가능", 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/menu-evidence");
  assert.equal(calls[0].body.places.length, 5);
  assert.deepEqual(calls[0].body.places.map(({ id }) => id), ["2", "3", "4", "5", "6"]);
  assert.equal(calls[0].body.query, "해산물 없는 소바, 주차 가능");
  assert.deepEqual(calls[0].body.constraints, ["해산물 제외", "주차 가능"]);
  assert.equal(calls[0].body.menu, "소바");
  assert.equal(calls[0].body.mode, "overseas");
  assert.equal(context.evidenceRun.checked, 5);
});

test("출처가 없는 후보만 있으면 증거 API를 호출하지 않는다", async () => {
  let calls = 0;
  const context = evidenceHarness(async () => { calls++; throw new Error("호출되면 안 됨"); });
  await context.reviewMenuEvidence([{ id: 1, name: "식당" }], { tiers: { exact: "소바" } }, "소바", 1);
  assert.equal(calls, 0);
  assert.equal(context.evidenceRun.checked, 0);
});

test("오션뷰·룸 같은 기존 테마도 메뉴 검토 조건에서 누락하지 않는다", () => {
  const run = functionSource("runSearch");
  const line = run.split('\n').find((line) => line.includes('preparedConversion.constraints ='));
  const context = vm.createContext({ preparedConversion: { constraints: ['주차 가능'], theme: ['오션뷰'] }, options: { preservedConstraints: ['해산물 제외'] } });
  vm.runInContext(line, context);
  assert.deepEqual(Array.from(context.preparedConversion.constraints), ['주차 가능', '해산물 제외', '오션뷰']);
});

test("메뉴 판매 종료 근거는 표시뿐 아니라 메뉴 적합도·실제 점수도 낮춘다", async () => {
  const context = evidenceHarness(async () => ({ ok: true, json: async () => ({ refined: true,
    results: [{ id: 'closed-menu', menuStatus: 'contradicted', constraints: [] }] }) }));
  const place = { id: 'closed-menu', name: '식당', availableSources: [{ id: 'g0', text: 'Soba is no longer served.', url: 'https://example.com/r' }],
    _absoluteRel: 0.9, _tier: 'exact', _imm: { verified: true, score100: 90, stars: 5, breakdown: { rating: 0.9, reviewCount: 0.9, krBuzz: 0.5, relevance: 0.9 } } };
  await context.reviewMenuEvidence([place], { tiers: { exact: '소바' } }, '소바', 1);
  assert.equal(place._tier, 'broader');
  assert.equal(place._absoluteRel, 0);
  assert.equal(place._imm.breakdown.relevance, 0);
  assert.ok(place._imm.score100 < 90);
});

test("늦게 도착한 이전 검색의 증거 성공·실패 응답은 새 검색 상태를 바꾸지 않는다", async () => {
  for (const failure of [false, true]) {
    let settle;
    const context = evidenceHarness(() => new Promise((resolve, reject) => { settle = failure ? reject : resolve; }));
    const place = { id: "old", name: "이전 식당", availableSources: [{ id: "g0", text: "soba", url: "https://example.com/r" }] };
    const running = context.reviewMenuEvidence([place], { tiers: { exact: "소바" } }, "소바", 1);
    context.searchGen = 2;
    if (failure) settle(new Error("이전 요청 실패"));
    else settle({ ok: true, json: async () => ({ refined: true, results: [{ id: "old", menuStatus: "supported" }] }) });
    await running;
    assert.equal(place._evidence, undefined);
    assert.equal(context.evidenceRun.checked, 0);
  }
});

test("오래된 국내 검색의 위치나 오류 메시지를 현재 검색에 덮어쓰지 않는다", () => {
  const domestic = functionSource("runDomesticSearch");
  const afterPlaces = domestic.slice(domestic.indexOf("await searchPlaces("));
  assert.ok(afterPlaces.indexOf("if (gen !== searchGen) return;") < afterPlaces.indexOf("lastSearchCenter ="), "지도 중심 변경 전 세대 검사 필요");
  const run = functionSource("runSearch");
  const error = run.slice(run.indexOf("} catch (e) {"), run.indexOf("} finally {"));
  assert.ok(error.indexOf("gen !== searchGen") >= 0, "이전 요청 오류 무시 필요");
  assert.ok(error.indexOf("gen !== searchGen") < error.indexOf("showState(null)"));
});

test("화면은 검토 상태·원출처·확인 시점·조건 미검증을 구분해서 안내한다", () => {
  const body = functionSource("renderMenuEvidence");
  assert.ok(body.includes("메뉴 근거 미검토"));
  assert.ok(body.includes("현재 확보한 자료로 메뉴 검토를 완료하지 못했어요"));
  assert.ok(body.includes("일부 후기 기준"));
  assert.ok(body.includes("현재 판매 여부와 필요한 조건은 매장에 확인"));
  assert.ok(body.includes("evaluatedAt"));
  assert.ok(body.includes("requestedConstraints"));
  assert.ok(body.includes("확인할 자료 부족"));
  assert.match(body, /find\(\(s\) => s\.id === item\.sourceId\)/);
  assert.match(body, /if \(!source \|\| !item\.quote\) return;/);
  assert.match(body, /quote\.textContent = item\.quote/);
  assert.match(body, /safeHttpUrl\(source\.url/);
});

test("1등 후보는 메뉴 근거가 확인되고 반대 근거가 없는 곳에서만 선정한다", () => {
  const body = functionSource("pickChampion");
  assert.ok(body.includes('p._evidence?.menuStatus !== "supported"'));
  assert.ok(body.includes("evidenceConflict(p)"));
  assert.ok(body.includes("imm.verified === false"));
  assert.ok(body.includes("if (!eligible.length) return null"));
});
