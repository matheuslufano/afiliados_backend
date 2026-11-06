const { Prisma } = require("@prisma/client");
const prisma = require("../database/prisma");
const { analyticsPeriod, shiftDate } = require("./blogAnalyticsPeriod");
const { retentionDays } = require("./blogAnalyticsCollection");
const { fail } = require("./blogValidation");

const number = (value) => Number(value || 0);
const counters = (row) => ({
  visitors: number(row?.visitors),
  views: number(row?.views),
  shares: number(row?.shares),
  trailers: number(row?.trailers),
  multiReaders: number(row?.multiReaders),
  continuations: number(row?.continuations),
});
function metric(value, previous) {
  return {
    value,
    previous,
    change: previous ? ((value - previous) / previous) * 100 : value ? null : 0,
  };
}

/** Indexed SQL aggregates return counts, never raw visitor/session identifiers to the dashboard. */
async function analyticsReport(query, now = new Date()) {
  const period = analyticsPeriod(query, now);
  const selected = query.articleId || null;
  const scope = Prisma.sql`(${selected}::text IS NULL OR e."articleId" = ${selected})`;
  const base = Prisma.sql`WITH base AS (
    SELECT *, CASE WHEN "createdAt" >= ${period.from} THEN 'current' ELSE 'previous' END AS period,
      ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Araguaina')::date AS day
    FROM "BlogAnalyticsEvent" WHERE "createdAt" >= ${period.previousFrom} AND "createdAt" < ${period.until}
  )`;
  const totalsQuery = Prisma.sql`${base}, readers AS (
    SELECT period, "visitorHash", COUNT(DISTINCT "articleId") AS articles FROM base WHERE kind='article_view' GROUP BY period,"visitorHash"
  ) SELECT e.period,
    COUNT(DISTINCT e."visitorHash") FILTER (WHERE e.kind='article_view' AND ${scope}) AS visitors,
    COUNT(*) FILTER (WHERE e.kind='article_view' AND ${scope}) AS views,
    COUNT(*) FILTER (WHERE e.kind='article_share' AND ${scope}) AS shares,
    COUNT(*) FILTER (WHERE e.kind='trailer_play' AND ${scope}) AS trailers,
    COUNT(DISTINCT e."visitorHash") FILTER (WHERE e.kind='article_view' AND r.articles >= 2 AND ${scope}) AS "multiReaders",
    COUNT(DISTINCT e."visitorHash") FILTER (WHERE e.kind='article_navigation' AND (${selected}::text IS NULL OR e."fromArticleId"=${selected})) AS continuations
    FROM base e LEFT JOIN readers r ON r.period=e.period AND r."visitorHash"=e."visitorHash" GROUP BY e.period`;
  const dailyQuery = Prisma.sql`${base}, readers AS (
    SELECT day,"visitorHash",COUNT(DISTINCT "articleId") AS articles FROM base WHERE period='current' AND kind='article_view' GROUP BY day,"visitorHash"
  ) SELECT e.day,
    COUNT(DISTINCT e."visitorHash") FILTER (WHERE e.kind='article_view' AND ${scope}) AS visitors,
    COUNT(*) FILTER (WHERE e.kind='article_view' AND ${scope}) AS views,
    COUNT(*) FILTER (WHERE e.kind='article_share' AND ${scope}) AS shares,
    COUNT(*) FILTER (WHERE e.kind='trailer_play' AND ${scope}) AS trailers,
    COUNT(DISTINCT e."visitorHash") FILTER (WHERE e.kind='article_view' AND r.articles >= 2 AND ${scope}) AS "multiReaders"
    FROM base e LEFT JOIN readers r ON r.day=e.day AND r."visitorHash"=e."visitorHash" WHERE e.period='current' GROUP BY e.day ORDER BY e.day`;
  const categoryQuery = Prisma.sql`SELECT e.category, COUNT(*) AS value FROM "BlogAnalyticsEvent" e WHERE e."createdAt">=${period.from} AND e."createdAt"<${period.until} AND e.kind='article_view' AND ${scope} GROUP BY e.category ORDER BY value DESC`;
  const articlesQuery = Prisma.sql`WITH ranged AS (SELECT * FROM "BlogAnalyticsEvent" WHERE "createdAt">=${period.from} AND "createdAt"<${period.until}),
    a AS (SELECT "articleId",COUNT(DISTINCT "visitorHash") FILTER(WHERE kind='article_view') AS visitors,COUNT(*) FILTER(WHERE kind='article_view') AS views,COUNT(*) FILTER(WHERE kind='article_share') AS shares,COUNT(*) FILTER(WHERE kind='trailer_play') AS trailers FROM ranged GROUP BY "articleId"),
    n AS (SELECT "fromArticleId" AS "articleId",COUNT(DISTINCT "visitorHash") AS continuations FROM ranged WHERE kind='article_navigation' GROUP BY "fromArticleId"),
    meta AS (SELECT DISTINCT ON("articleId") "articleId","articleTitle","articleSlug","articleCover",category FROM ranged ORDER BY "articleId","createdAt" DESC)
    SELECT COALESCE(a."articleId",n."articleId") AS id,a.visitors,a.views,a.shares,a.trailers,n.continuations,m."articleTitle",m."articleSlug",m."articleCover",m.category FROM a FULL JOIN n ON n."articleId"=a."articleId" LEFT JOIN meta m ON m."articleId"=COALESCE(a."articleId",n."articleId")`;
  const navigationQuery = Prisma.sql`SELECT "articleId" AS id,COUNT(*) AS events,COUNT(DISTINCT "visitorHash") AS visitors FROM "BlogAnalyticsEvent" WHERE "createdAt">=${period.from} AND "createdAt"<${period.until} AND kind='article_navigation' AND "fromArticleId"=${selected} GROUP BY "articleId" ORDER BY events DESC`;
  const [
    totals,
    days,
    categoryRows,
    articleRows,
    destinations,
    records,
    categories,
    first,
  ] = await prisma.$transaction(
    [
      prisma.$queryRaw(totalsQuery),
      prisma.$queryRaw(dailyQuery),
      prisma.$queryRaw(categoryQuery),
      prisma.$queryRaw(articlesQuery),
      prisma.$queryRaw(navigationQuery),
      prisma.blogArticle.findMany({
        select: {
          id: true,
          title: true,
          slug: true,
          cover: true,
          category: true,
          status: true,
          publishedAt: true,
          updatedAt: true,
          publicSnapshot: true,
        },
      }),
      prisma.blogCategory.findMany({ select: { slug: true, name: true } }),
      prisma.blogAnalyticsEvent.aggregate({ _min: { createdAt: true } }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const current = counters(totals.find((row) => row.period === "current")),
    previous = counters(totals.find((row) => row.period === "previous"));
  current.multiRate = current.visitors
    ? (current.multiReaders / current.visitors) * 100
    : 0;
  previous.multiRate = previous.visitors
    ? (previous.multiReaders / previous.visitors) * 100
    : 0;
  const categoryNames = new Map(categories.map((row) => [row.slug, row.name]));
  const historical = new Map(
    articleRows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.articleTitle || "Artigo removido",
        slug: row.articleSlug || "",
        cover: row.articleCover || "",
        category: row.category || "",
        updatedAt: null,
      },
    ]),
  );
  for (const record of records) {
    if (
      !historical.has(record.id) &&
      record.id !== selected &&
      (!["published", "demo"].includes(record.status) ||
        record.publishedAt > now)
    )
      continue;
    const published = record.publicSnapshot || record;
    historical.set(record.id, {
      id: record.id,
      title: published.title,
      slug: published.slug,
      cover: published.cover,
      category: published.category,
      updatedAt: published.updatedAt || record.updatedAt.toISOString(),
    });
  }
  const articleCounts = new Map(
    articleRows.map((row) => [row.id, counters(row)]),
  );
  if (selected && !historical.has(selected))
    fail("Artigo sem histórico ou indisponível.", 404);
  const articles = [...historical.values()]
    .map((row) => ({
      ...row,
      categoryLabel: categoryNames.get(row.category) || row.category,
      ...counters(articleCounts.get(row.id)),
    }))
    .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title));
  const daily = Array.from({ length: period.days }, (_, index) => {
    const date = shiftDate(period.start, index);
    return {
      date,
      ...counters(
        days.find((row) => row.day.toISOString().slice(0, 10) === date),
      ),
    };
  });
  return {
    period: {
      start: period.start,
      end: period.end,
      previousStart: period.previousStart,
      previousEnd: period.previousEnd,
      timeZone: period.timeZone,
    },
    updatedAt: now.toISOString(),
    tracking: {
      firstEventAt: first._min.createdAt,
      retentionDays,
      consentRequired: true,
      trailerTracking: "youtube-playing",
    },
    metrics: Object.fromEntries(
      Object.keys(current).map((key) => [
        key,
        metric(current[key], previous[key]),
      ]),
    ),
    daily,
    categories: categoryRows.map((row) => ({
      name: categoryNames.get(row.category) || row.category,
      value: number(row.value),
    })),
    readers: {
      single: Math.max(0, current.visitors - current.multiReaders),
      multiple: current.multiReaders,
    },
    articles,
    selectedArticle: articles.find((row) => row.id === selected) || null,
    navigation: destinations.map((row) => ({
      ...(historical.get(row.id) || {
        id: row.id,
        title: "Artigo removido",
        slug: "",
        cover: "",
        category: "",
      }),
      events: number(row.events),
      visitors: number(row.visitors),
    })),
  };
}
module.exports = { analyticsReport };
