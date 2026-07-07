# 맛집 레이더

감성 키워드("낙지 들어간 얼큰한 짬뽕")로 검색하면 근처 맛집을 광고 걸러낸 블로그 후기와 함께 보여주는 가족용 검색 도구.

## 구조

```
matjib/
├── index.html        # 앱 전체 (검색 UI + 카카오 장소 검색)
└── api/
    ├── keywords.js   # Claude Haiku로 감성 키워드 → 실제 메뉴 키워드 변환
    └── blog.js       # 네이버 블로그 검색 프록시 + 광고성 글 필터링
```

## 설정 순서

### 1. 카카오 (장소 검색)
1. [developers.kakao.com](https://developers.kakao.com) → 내 애플리케이션 → 애플리케이션 추가
2. 앱 키에서 **JavaScript 키** 복사 → `index.html` 상단 `KAKAO_JS_KEY`에 붙여넣기
3. 앱 설정 → 플랫폼 → **Web 플랫폼 등록** → 배포 도메인 입력 (예: `https://내앱.vercel.app`)
   - 이 도메인 등록이 없으면 SDK가 차단됩니다. 로컬 테스트용으로 `http://localhost:3000`도 함께 등록해두면 편합니다.

### 2. 네이버 (블로그 후기)
1. [developers.naver.com](https://developers.naver.com) → Application → 애플리케이션 등록
2. 사용 API: **검색** 선택, 환경: WEB 설정
3. 발급된 **Client ID / Client Secret**을 Vercel 환경변수로 등록 (아래 4번)

### 3. Claude (키워드 변환 — 선택)
- 보유한 Anthropic API 키를 Vercel 환경변수로 등록
- 키가 없거나 호출이 실패해도 앱은 원문 그대로 검색하며 정상 동작합니다

### 4. Vercel 배포
1. 이 폴더를 GitHub 저장소에 올리고 Vercel에서 Import (또는 vercel.com에서 폴더 직접 업로드)
2. Settings → Environment Variables에 등록:

| 이름 | 값 |
|---|---|
| `NAVER_CLIENT_ID` | 네이버 Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 Client Secret |
| `ANTHROPIC_API_KEY` | Anthropic API 키 (선택) |

3. 배포 후 나온 도메인을 카카오 콘솔 Web 플랫폼에 등록 (1-3번)

## 비용
- 카카오 로컬 / 네이버 검색 API: 무료 쿼터로 충분
- Claude Haiku: 검색 1회당 1원 미만. 같은 검색어는 localStorage에 캐시되어 재호출하지 않음
- Vercel: 무료 티어

## 참고
- 위치 권한을 거부했거나 GPS가 애매한 곳에서는 "직접 입력" 모드로 지역명/역 이름을 기준으로 검색하세요
- 광고 필터는 후기 제목·요약에 협찬/원고료/체험단 등 문구가 있으면 제외하는 방식이라 100%는 아닙니다 (본문 전체는 API로 제공되지 않음)
- 후기 API는 브라우저에서 직접 호출이 안 되므로, 로컬에서 파일만 열면 후기가 안 뜹니다. `npx vercel dev`로 실행하거나 배포 후 테스트하세요
