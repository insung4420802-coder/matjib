// Keep the model deadline inside the handler, hosting and browser deadlines.
// Longer waiting does not add model calls or increase the output-token budget.
export const MENU_ANALYSIS_TIMEOUT_MS = 120_000;
export const MENU_HANDLER_DEADLINE_MS = 130_000;
export const MENU_CLIENT_TIMEOUT_MS = 165_000;
export const MENU_MAX_OUTPUT_TOKENS = 6_000;
export const MENU_ANALYSIS_VERSION = 24;

export function menuAnalysisProgress(elapsedMs, photoCount) {
  const seconds = Math.max(0, Number(elapsedMs) || 0) / 1000;
  const count = Math.max(1, Math.min(5, Math.floor(Number(photoCount) || 1)));
  if (seconds < 30) return `사진 ${count}장의 메뉴명·가격과 쉬운 한국어 설명을 정리하고 있어요. 글자가 많으면 최대 약 2분 걸릴 수 있어요.`;
  if (seconds < 75) return '메뉴가 많으면 판독과 번역에 시간이 더 필요해요. 이 탭을 열어 두고 기다려 주세요.';
  if (seconds < 120) return '아직 분석 응답을 기다리고 있어요. 다시 누르거나 새로고침하면 비용이 중복될 수 있어요.';
  return '서버 응답을 확인하고 있어요. 선택한 사진은 그대로 유지됩니다. 자동 재시도는 하지 않아요.';
}
