const { createHash } = require("node:crypto");
const prisma = require("../database/prisma");
const { publicVersion } = require("../controllers/blogController");
const { fail } = require("./blogValidation");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KINDS = [
  "article_view",
  "article_share",
  "trailer_play",
  "article_navigation",
];
const digest = (value) =>
  createHash("sha256")
    .update("netbox-blog-v1:" + value)
    .digest("hex");
const retentionDays = 365;

function validateEvent(body) {
  if (
    !body ||
    body.consent !== true ||
    !KINDS.includes(body.kind) ||
    !UUID.test(body.id || "") ||
    !UUID.test(body.visitorId || "") ||
    !UUID.test(body.sessionId || "")
  )
    fail("Evento ou consentimento inválido.");
  if (
    typeof body.articleId !== "string" ||
    !body.articleId ||
    body.articleId.length > 200
  )
    fail("Artigo inválido.");
  if (
    body.kind === "article_navigation" &&
    (typeof body.fromArticleId !== "string" ||
      !body.fromArticleId ||
      body.fromArticleId.length > 200 ||
      body.fromArticleId === body.articleId)
  )
    fail("Navegação inválida.");
  return {
    id: body.id,
    kind: body.kind,
    articleId: body.articleId,
    visitorHash: digest(body.visitorId),
    sessionHash: digest(body.sessionId),
    fromArticleId:
      body.kind === "article_navigation" ? body.fromArticleId : null,
  };
}
async function collectEvent(body) {
  const data = validateEvent(body);
  const record = await prisma.blogArticle.findFirst({
    where: {
      id: data.articleId,
      status: { in: ["published", "demo"] },
      publishedAt: { lte: new Date() },
    },
    include: { sources: true },
  });
  if (!record) fail("Artigo indisponível.", 404);
  if (data.kind === "article_navigation") {
    const previous = await prisma.blogAnalyticsEvent.findFirst({
      where: {
        articleId: data.fromArticleId,
        kind: "article_view",
        visitorHash: data.visitorHash,
        sessionHash: data.sessionHash,
        createdAt: { gte: new Date(Date.now() - 30 * 60000) },
      },
      select: { id: true },
    });
    if (!previous) return false;
  }
  const article = publicVersion(record);
  const result = await prisma.blogAnalyticsEvent.createMany({
    data: [
      {
        ...data,
        articleTitle: article.title,
        articleSlug: article.slug,
        articleCover: article.cover,
        category: article.category,
      },
    ],
    skipDuplicates: true,
  });
  return result.count > 0;
}
/** Retention is automatic in the server and can also be run as an explicit maintenance command. */
async function purgeAnalytics(now = new Date()) {
  return prisma.blogAnalyticsEvent.deleteMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - retentionDays * 86400000) },
    },
  });
}
function startAnalyticsRetention() {
  const run = () =>
    purgeAnalytics().catch((error) =>
      console.error(
        "Retenção de analytics do Blog:",
        error.code || error.message,
      ),
    );
  void run();
  const timer = setInterval(run, 86400000);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = {
  validateEvent,
  collectEvent,
  purgeAnalytics,
  startAnalyticsRetention,
  retentionDays,
};
