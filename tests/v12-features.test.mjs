import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("비교함은 최대 3곳으로 제한되고 후보 공유 기능을 제공한다", () => {
  assert.match(html, /id="compareDock"/);
  assert.match(html, /compareIds\.size >= 3/);
  assert.match(html, /function openCompareModal\(/);
  assert.match(html, /function buildCandidateShareText\(/);
  assert.match(html, /slice\(0, 3\)/);
});

test("즐겨찾기는 기존 항목과 호환되는 폴더·방문·메모 필드를 저장한다", () => {
  assert.match(html, /const FFOLDER_KEY = "imm_fav_folders"/);
  assert.match(html, /folder: "기본"/);
  assert.match(html, /visited: false/);
  assert.match(html, /note: ""/);
  assert.match(html, /function appendFavTools\(/);
  assert.match(html, /note\.maxLength = 300/);
});
