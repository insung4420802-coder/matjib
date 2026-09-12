// 공통 API 보호 도구. APP_ACCESS_KEY는 선택 사항이며, 설정하면 지인에게만
// 공유하는 간단한 접근 코드로 API 비용의 무단 사용을 줄일 수 있다.

function guardAccess(req, res) {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) return true;
  const supplied = req.headers["x-imm-key"];
  if (typeof supplied === "string" && supplied === expected) return true;
  res.status(401).json({ error: "접근 코드가 필요합니다.", code: "ACCESS_KEY_REQUIRED" });
  return false;
}

function cleanText(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export { guardAccess, cleanText, fetchWithTimeout };
