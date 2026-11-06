const express = require("express");
const { requireAuth, requireManager } = require("../middleware/auth");
const { createHash } = require("node:crypto");
const { collectEvent } = require("../services/blogAnalyticsCollection");
const { analyticsReport } = require("../services/blogAnalyticsReport");
const router = express.Router();
const limits = new Map();
function allowedOrigins() {
  const origins = (process.env.BLOG_ANALYTICS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    origins.push(
      new URL(process.env.BLOG_SITE_URL || "https://netbox.net.br").origin,
    );
  } catch {}
  if (process.env.NODE_ENV !== "production")
    origins.push("http://localhost:3002", "http://127.0.0.1:3002");
  return origins;
}
router.post("/blog/analytics/events", async (req, res) => {
  try {
    if (!allowedOrigins().includes(req.get("origin")))
      return res.status(403).json({ error: "Origem não permitida." });
    if (
      req.get("dnt") === "1" ||
      req.get("sec-gpc") === "1" ||
      /bot|crawler|spider|headless/i.test(req.get("user-agent") || "")
    )
      return res.status(204).end();
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 8192)
      return res.status(413).json({ error: "Evento muito grande." });
    const now = Date.now(),
      key = createHash("sha256")
        .update((req.ip || "") + ":" + String(req.body?.visitorId || ""))
        .digest("hex");
    if (limits.size > 5000)
      for (const [id, bucket] of limits)
        if (bucket.until <= now) limits.delete(id);
    const bucket = limits.get(key);
    const next =
      bucket && bucket.until > now ? bucket : { count: 0, until: now + 60000 };
    if (limits.size >= 5000 && !limits.has(key))
      return res
        .status(429)
        .json({ error: "Coleta temporariamente limitada." });
    if (++next.count > 120)
      return res.status(429).json({ error: "Limite de eventos atingido." });
    limits.set(key, next);
    const accepted = await collectEvent(req.body);
    return res.status(202).json({ accepted });
  } catch (error) {
    return res
      .status(error.status || 503)
      .json({
        error: error.status
          ? error.message
          : "Coleta de analytics indisponível.",
      });
  }
});
router.get(
  "/admin/blog/analytics",
  requireAuth,
  requireManager,
  async (req, res) => {
    try {
      res
        .set("Cache-Control", "no-store")
        .json(await analyticsReport(req.query));
    } catch (error) {
      res
        .status(error.status || 503)
        .json({
          error: error.status
            ? error.message
            : "Analytics indisponível. Verifique a migração do módulo no backend.",
        });
    }
  },
);
module.exports = router;
