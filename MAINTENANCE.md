# MAINTENANCE.md — 임슐랭 가이드 인수인계 문서

> 이 문서 하나를 붙여넣으면 어떤 AI 모델/개발자와 대화하든 프로젝트 전체 맥락이 전달되도록 작성됨.
> 최종 갱신: 2026-07 (v10 기준)

---

## 1. 프로젝트 개요

**임슐랭 가이드**: 감성 키워드("낙지 들어간 얼큰한 짬뽕", "바다가 보이는 횟집")로 검색하면,
**광고/협찬 후기를 걸러낸 진짜 후기만으로 자체 별점(1~5)** 을 매겨 맛집을 추천하는 가족용 웹앱.

- 국내 모드: 카카오 장소검색 + 네이버 블로그 후기 → 자체 별점
- 해외 모드: 구글 Places(평점·리뷰) + 네이버 블로그(한국인 후기) → 구글 평점 기반 별점
- 배포: GitHub → Vercel 자동 배포. 소유자는 터미널을 쓰지 않고 **GitHub 웹 UI에서만** 파일 관리.
- 사용자: 가족 (카톡 링크 공유 → 홈 화면 추가로 앱처럼 사용)

**핵심 차별점**: 네이버 검색과 달리 협찬 후기를 판별·제외하고, 별점의 근거(진짜후기 비율, 4축 그래프)를 투명하게 보여줌.

---

## 2. 파일 구조와 역할

```
├── index.html              # 앱 전체 (UI + 클라이언트 로직 + 카카오/구글맵 렌더)
├── README.md               # 설치/키 발급 가이드
├── MAINTENANCE.md          # 이 문서
└── api/                    # Vercel 서버리스 함수
    ├── keywords.js         # [Claude] 감성어 → 검색 키워드 변환 (국내/해외 프롬프트 분기)
    ├── blog.js             # 네이버 블로그 원시 후기 수집 (판정 안 함)
    ├── judge.js            # [Claude] 국내 별점 판정 (휴리스틱 + 애매한 후기만 Claude 재판정)
    ├── judge-overseas.js   # 해외 별점 판정 (구글 평점 기반)
    ├── gplaces.js          # 구글 Places: 검색/자동완성/상세/영업시간 (mode 파라미터로 분기)
    ├── summary.js          # [Claude] 1등 맛집 AI 심사평 (2문장)
    ├── order-helper.js     # [Claude] 해외 현지어 주문 문장 생성
    └── lib/score.js        # ★ 별점 엔진 (국내 evaluatePlace / 해외 evaluateOverseasPlace)
```

`index.html` 내 주요 함수:
- `runDomesticSearch` / `runOverseasSearch`: 모드별 검색 파이프라인
- `convertKeywords` / `convertKeywordsOverseas`: 키워드 변환 호출 (+localStorage 캐시)
- `scorePlace(p, foodTerms, themeTerms)`: 키워드 적합도. **음식=필수, 테마=가산**
- `classifyTier`: exact/broad/broader 계층 분류
- `pickChampion` / `championScore`: 1등 선정 (별점만으로 안 뽑음)
- `renderResults` / `renderPlace`: 결과·카드 렌더 (국내/해외 필드 정규화 포함)
- `renderResultMap`(카카오) / `renderResultMapOverseas`(구글): 지도 보기
- `showLocSuggestions`: 위치칸 인라인 후보 (국내=카카오, 해외=구글 자동완성)
- `loadHoursBadge`: 국내 영업시간 (구글 조회, 온디맨드)
- `sharePlace`: 공유 (국내=카카오맵 링크, 해외=구글맵 링크)

---

## 3. 핵심 설계 결정과 이유 (⚠️ 바꾸기 전에 반드시 읽을 것)

### 3-1. 별점 로직 (api/lib/score.js) — 앱의 심장
- **진짜후기 밀도는 가산점이 아니라 곱셈 게이트**: 광고밭이면 다른 점수가 높아도 별점 상한이 눌림.
- **베이지안 축소**: 후기 3개짜리 100%가 후기 30개짜리 80%를 못 이기게 표본 수로 신뢰도 보정.
- **강한 협찬 문구("제공받아","원고료","체험단")는 진짜 신호("재방문","내돈내산")로 상쇄 불가** (floor 0.5).
- 결합: `quality = 0.45·적합도 + 0.35·후기량 + 0.20·최신성`, `gate = 0.55 + 0.45·밀도`, 최종 = quality × gate.
- 별점 컷은 깐깐하게(78점↑=★5). 컷/가중치 조정 위치: `score.js`의 `toStars`, `combine`.
- 해외는 별도 함수 `evaluateOverseasPlace`: 구글 평점을 베이지안 보정(리뷰 5개짜리 4.9 = 관광객 함정 배제).

### 3-2. 광고 판별 2단계 (비용 통제)
1. 휴리스틱(정규식, 무료·즉시) → 2. 광고확률 0.3~0.7 애매한 후기만 Claude 배치 재판정(최대 40건 상한).
Claude 키 없거나 실패해도 1단계만으로 정상 동작 — **모든 Claude 호출은 실패 시 폴백이 있어야 함** (이 원칙 유지할 것).

### 3-3. 키워드 변환 (api/keywords.js)
- 카카오맵은 가게명/업종/메뉴 단어로만 검색됨. **"키즈 친화 음식" 같은 추상어는 절대 금지** — 프롬프트에 few-shot 예시 + 코드 레벨 안전망(BAD_SEARCH 정규식)이 이중으로 있음.
- 검색어 속 지역명("판교 스테이크", "발리 스테이크")은 `region`으로 분리 → 클라이언트가 위치로 자동 사용 + 안내 문구. 사용자가 잘못 써도 막지 말고 알아서 처리하는 것이 원칙.
- 테마("바다가 보이는")는 지도에서 통하는 말(오션뷰)로 변환, `food`(필수)/`theme`(가산) 분리 반환.
- tiers(exact/broad/broader)로 결과를 "정확히 일치/비슷한 종류/같은 계열" 그룹핑.

### 3-4. 1등 선정 (pickChampion)
별점 1위를 그냥 뽑으면 "후기 1개짜리 우연한 5점"이 1등이 됨. 챔피언 점수 = 별점 + 계층보너스(exact 우대) + 후기 증거량(진짜후기 2개 미만은 후보 제외) + 진짜후기 비율 + 적합도.

### 3-5. 구글 위치 검색 — ⚠️ 과거 대형 버그 2건
- **locationRestriction(circle)은 searchText에서 미지원** → 결과 0건 사건. 반드시 `locationBias`(circle) 사용.
- bias는 "부드러운 편향"이라 반경 밖 유명집이 섞임(텐진역 검색에 하카타) → **클라이언트에서 하버사인 거리 계산 후 반경×1.2 밖은 잘라냄** (3곳 미만이면 ×2 완화). 이 후처리 필터를 지우면 안 됨.
- 좌표가 있을 때는 텍스트 쿼리에 지역명을 넣지 않음(넓은 지역명이 결과를 오염시킴).

### 3-6. 카카오 SDK 주의점
- Places 인스턴스를 병렬 검색에 공유하면 응답이 섞임 → **검색마다 new kakao.maps.services.Places()**.
- 검색 세대 토큰(searchGen): 새 검색 시작 시 증가, 각 await 후 `gen !== searchGen`이면 중단(잔상 방지).
- CSS에서 `display:flex`는 `hidden` 속성을 무력화함 → 오버레이류는 `[hidden]{display:none}` 필수 (주소검색 팝업이 화면을 덮었던 사건).

### 3-7. UI 원칙
- 모드 전환(국내↔해외) 시 검색어/결과/필터 완전 초기화.
- 위치 선택은 후보 확인 방식(인라인 자동완성) — 첫 결과를 조용히 쓰지 않음.
- 캐시 키 버전 규칙: 키워드 응답 형식이 바뀌면 `kw5:`/`ovs3:` 버전 숫자를 올려 옛 캐시 무효화.

---

## 4. API 키 / 환경변수 맵

| 키 | 위치 | 제한 설정 | 용도 |
|---|---|---|---|
| 카카오 JavaScript 키 | `index.html` 상단 `KAKAO_JS_KEY` | 카카오 콘솔 Web 도메인 등록 | 장소검색·지도 |
| 네이버 Client ID/Secret | Vercel 환경변수 | — | 블로그 후기 |
| Anthropic API 키 | Vercel 환경변수 `ANTHROPIC_API_KEY` | — | 키워드/판정/심사평/번역/주문 |
| (선택) `ANTHROPIC_MODEL` | Vercel 환경변수 | — | 기본 claude-haiku-4-5, Sonnet 교체용 |
| 구글 **서버용** 키 | Vercel 환경변수 `GOOGLE_MAPS_API_KEY` | **제한 없음** + API제한=Places API(New)만 | 해외 검색/영업시간 |
| 구글 **브라우저용** 키 | `index.html` 상단 `GOOGLE_MAPS_JS_KEY` | **웹사이트 제한**(도메인/*) + API제한=Maps JavaScript API만 | 해외 지도 보기 |

⚠️ **서버 키에 웹사이트 제한을 걸면 Vercel 함수가 차단됨** (과거 사고). 서버=제한없음, 브라우저=웹사이트제한. 두 키를 절대 하나로 합치지 말 것.
⚠️ GitHub에서 `index.html`을 통째로 교체하면 **카카오 키와 구글 JS 키가 초기화됨** — 교체 후 반드시 두 키 재입력 (Cmd+F로 `KAKAO_JS_KEY`, `GOOGLE_MAPS_JS_KEY` 검색).

---

## 5. 비용 구조 (월 기준, 가족용 사용량)

- 카카오/네이버: 무료 쿼터로 충분
- Claude(Haiku): 검색당 2~4원 수준 (키워드 변환 + 애매후기 판정). localStorage 캐시로 재검색 무료. 심사평은 1등 1곳만, 주문도우미는 버튼 눌렀을 때만.
- 구글: 해외 검색당 3~4회 호출 + 국내 영업시간(1등 자동 + 버튼 온디맨드) + 지도(버튼 눌렀을 때만 로드). 월 $200 무료 크레딧으로 여유. **국내 전 카드 영업시간 자동조회 같은 기능을 추가하면 크레딧을 빠르게 소진하니 온디맨드 원칙 유지.**

---

## 6. 자주 하는 유지보수 작업

### 파일 교체 절차 (표준)
GitHub 저장소 → 파일 클릭 → 연필 아이콘 → Cmd+A 삭제 → 새 내용 붙여넣기 → Commit → Vercel 자동 재배포(~1분).
`index.html` 교체 시 키 2개 재입력 필수 (4장 참고).

### 별점이 후하다/짜다
`api/lib/score.js`의 `toStars` 컷 조정. 국내 축 가중치는 `combine`, 해외는 `evaluateOverseasPlace` 내 가중치.

### 키워드 변환이 이상하다 (엉뚱한 업종이 나옴)
`api/keywords.js`의 SYSTEM_PROMPT에 실패 사례를 few-shot 예시로 추가. 추상어가 새면 `BAD_SEARCH` 정규식에 어미 추가. **프롬프트 형식(JSON 필드)을 바꾸면 캐시 키 버전(kw5→kw6) 올릴 것.**

### 광고 판별이 부정확하다
`score.js` 상단 `AD_STRONG`/`AD_WEAK`/`REAL_SIGNAL` 정규식 배열에 패턴 추가.

### 자주 쓰는 장소 칩 변경
`index.html`의 `QUICK_DOMESTIC` / `QUICK_OVERSEAS` 배열.

### 모델 업그레이드 (Haiku→Sonnet)
Vercel 환경변수 `ANTHROPIC_MODEL=claude-sonnet-4-6` 추가 → Redeploy. 코드 수정 불필요. 비용 ~10배(그래도 검색당 수십 원).

### 새 Claude 기능 추가 시 원칙
(1) 실패 시 폴백으로 앱이 계속 동작, (2) 온디맨드 또는 대상 1곳 한정, (3) localStorage 캐시, (4) max_tokens 상한.

---

## 7. 트러블슈팅 히스토리 (재발 방지)

| 증상 | 원인 | 해결 |
|---|---|---|
| 해외 검색이 캐나다 등 엉뚱한 나라 결과 | 지역 정보 없이 텍스트만 + regionCode:KR | 지역 지오코딩 + locationBias |
| 해외 검색 결과 0건 | locationRestriction circle이 searchText 미지원 | locationBias로 교체 |
| 텐진역 1km 검색에 하카타(1.8km) 등장 | bias는 소프트 + 텍스트의 넓은 지역명 | 하버사인 후처리 필터 + 좌표 있으면 지역명 텍스트 미주입 |
| 구글 검색 호출 전부 실패 | 서버 키에 "웹사이트" 제한을 걸어버림 | 서버 키=제한없음, 브라우저 키 별도 생성 |
| 주소검색 팝업이 처음부터 화면을 덮음 | `.pc-overlay{display:flex}`가 hidden 무력화 | `[hidden]{display:none}` 추가 |
| 이전 검색 결과가 섞여 나옴(잔상) | Places 인스턴스 공유 + 늦은 응답 | 인스턴스 검색별 생성 + searchGen 토큰 |
| "아이 맛집" 검색에 스시집 | LLM이 추상 키워드 출력 + 매칭어도 추상 | few-shot 강화 + BAD_SEARCH 안전망 + 재랭킹 |
| "묵은지 감자탕"에 족발집 | 카카오가 같이 파는 업종 혼입 | food 필수 매칭(재랭킹 0점 제외) |

---

## 8. 테스트

로직 변경 시 시나리오 재현 테스트를 권장 (개발 대화에서 매번 수행했음):
별점 엔진(광고밭 vs 진짜맛집, 죽은맛집, 관광객함정), 재랭킹(족발/스시 제외, 테마 가산),
1등 선정(후기 1개짜리 5점 탈락), 키워드 파싱(추상어 필터, region/tiers/food/theme, 폴백).
새 AI 대화에서 "이 함수 테스트 시나리오 돌려줘"라고 요청하면 됨.
