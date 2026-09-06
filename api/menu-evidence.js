// Optional, citation-checked menu evidence. Failures never block restaurant search.
import { guardAccess } from "./lib/guard.js";
import { runMenuEvidence } from "./lib/menu-evidence.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원합니다." });
  if (!guardAccess(req, res)) return;
  res.setHeader?.("Cache-Control", "no-store");
  return res.status(200).json(await runMenuEvidence(req.body));
}
