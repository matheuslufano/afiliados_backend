const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHmac } = require("node:crypto");
const {
  analyticsPeriod,
  shiftDate,
} = require("../src/services/blogAnalyticsPeriod");
const { validateEvent } = require("../src/services/blogAnalyticsCollection");

test("analytics periods include Brazilian days and equal-length previous comparisons", () => {
  const period = analyticsPeriod({}, new Date("2026-11-05T01:00:00Z"));
  assert.equal(period.end, "2026-11-04");
  assert.equal(period.start, "2026-10-29");
  assert.equal(period.previousStart, "2026-10-22");
  assert.equal(period.previousEnd, "2026-10-28");
  assert.equal(period.from.toISOString(), "2026-10-29T03:00:00.000Z");
  assert.throws(() =>
    analyticsPeriod({ start: "2026-02-30", end: "2026-03-02" }),
  );
  assert.throws(() => analyticsPeriod({ end: "invalid" }), { status: 400 });
  assert.throws(() =>
    analyticsPeriod({ start: "2025-01-01", end: "2026-01-01" }),
  );
});
test("event validation requires consent and hashes random identifiers without accepting personal identity", () => {
  const payload = {
    id: randomUUID(),
    kind: "article_view",
    articleId: "article",
    visitorId: randomUUID(),
    sessionId: randomUUID(),
    consent: true,
  };
  const event = validateEvent({
    ...payload,
    email: "private@example.org",
    ip: "127.0.0.1",
  });
  assert.match(event.visitorHash, /^[a-f0-9]{64}$/);
  assert.notEqual(event.visitorHash, payload.visitorId);
  assert.equal(event.email, undefined);
  assert.equal(event.ip, undefined);
  assert.throws(() => validateEvent({ ...payload, consent: false }));
  assert.throws(() =>
    validateEvent({ ...payload, visitorId: "person@example.org" }),
  );
  assert.throws(() =>
    validateEvent({
      ...payload,
      kind: "article_navigation",
      fromArticleId: "article",
    }),
  );
});

test(
  "PostgreSQL: consent intake, deduplication, protected reports, real aggregates and article navigation",
  { skip: process.env.BLOG_TEST_DATABASE !== "1" },
  async () => {
    require("dotenv").config({ quiet: true });
    const prisma = require("../src/database/prisma");
    const express = require("express");
    const app = express();
    app.use(express.json());
    app.use(require("../src/routes/blogAnalyticsRoutes"));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const oldOrigins = process.env.BLOG_ANALYTICS_ORIGINS;
    process.env.BLOG_ANALYTICS_ORIGINS = "http://analytics.test";
    const key = "analytics-" + randomUUID();
    const a = randomUUID(),
      b = randomUUID(),
      draft = randomUUID();
    const eventIds = [];
    let category, manager, viewer;
    const token = (id) => {
      const payload = Buffer.from(JSON.stringify({ id })).toString("base64url");
      return (
        payload +
        "." +
        createHmac(
          "sha256",
          process.env.JWT_SECRET || "minha_chave_super_secreta",
        )
          .update(payload)
          .digest("base64url")
      );
    };
    async function request(path, body, auth, headers = {}) {
      const response = await fetch(base + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://analytics.test",
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    }
    try {
      category = await prisma.blogCategory.create({
        data: { name: key, slug: key },
      });
      manager = await prisma.user.create({
        data: {
          name: "Analytics test",
          email: key + "@example.invalid",
          password: randomUUID(),
          role: "MANAGER",
        },
      });
      viewer = await prisma.user.create({
        data: {
          name: "Analytics viewer",
          email: key + "-viewer@example.invalid",
          password: randomUUID(),
          role: "USER",
        },
      });
      const now = new Date(),
        period = analyticsPeriod({}, now);
      for (const [id, title, status] of [
        [a, "Publicado A", "published"],
        [b, "Publicado B", "published"],
        [draft, "Privado", "draft"],
      ])
        await prisma.blogArticle.create({
          data: {
            id,
            slug: key + "-" + id,
            title: "Rascunho não publicado",
            summary: "Test",
            category: key,
            cover: "https://example.org/image.webp",
            coverAlt: "Imagem",
            author: "Editorial",
            status,
            publishedAt: now,
            updatedAt: now,
            content: [],
            seo: {},
            publicSnapshot: {
              id,
              title,
              slug: key + "-" + id,
              cover: "https://example.org/image.webp",
              category: key,
              updatedAt: period.end,
            },
          },
        });
      assert.equal((await request("/admin/blog/analytics")).status, 401);
      assert.equal(
        (await request("/admin/blog/analytics", null, token(viewer.id))).status,
        403,
      );
      const visitor = randomUUID(),
        session = randomUUID();
      const payload = {
        id: randomUUID(),
        kind: "article_view",
        articleId: a,
        visitorId: visitor,
        sessionId: session,
        consent: true,
      };
      eventIds.push(payload.id);
      assert.equal(
        (
          await request("/blog/analytics/events", {
            ...payload,
            consent: false,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/blog/analytics/events", payload, null, {
            Origin: "https://evil.test",
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/blog/analytics/events", payload, null, { DNT: "1" }))
          .status,
        204,
      );
      assert.equal(
        (
          await request("/blog/analytics/events", {
            ...payload,
            articleId: draft,
          })
        ).status,
        404,
      );
      assert.equal(
        (await request("/blog/analytics/events", payload)).data.accepted,
        true,
      );
      assert.equal(
        (await request("/blog/analytics/events", payload)).data.accepted,
        false,
      );
      const stored = await prisma.blogAnalyticsEvent.findUnique({
        where: { id: payload.id },
      });
      assert.equal(stored.articleTitle, "Publicado A");
      assert.notEqual(stored.visitorHash, visitor);
      const navigation = {
        ...payload,
        id: randomUUID(),
        kind: "article_navigation",
        articleId: b,
        fromArticleId: a,
      };
      eventIds.push(navigation.id);
      assert.equal(
        (await request("/blog/analytics/events", navigation)).data.accepted,
        true,
      );
      await prisma.blogAnalyticsEvent.deleteMany({
        where: { id: { in: eventIds } },
      });
      const one = randomUUID(),
        two = randomUUID(),
        previous = randomUUID();
      function fixture(kind, articleId, who, day, fromArticleId) {
        const id = randomUUID();
        eventIds.push(id);
        return {
          ...validateEvent({
            id,
            kind,
            articleId,
            visitorId: who,
            sessionId: session,
            fromArticleId,
            consent: true,
          }),
          articleTitle: articleId === a ? "Publicado A" : "Publicado B",
          articleSlug: key + "-" + articleId,
          articleCover: "https://example.org/image.webp",
          category: key,
          createdAt: new Date(day + "T12:00:00-03:00"),
        };
      }
      await prisma.blogAnalyticsEvent.createMany({
        data: [
          fixture("article_view", a, one, period.start),
          fixture("article_view", a, one, period.end),
          fixture("article_view", b, one, period.end),
          fixture("article_view", a, two, period.end),
          fixture("article_share", a, one, period.end),
          fixture("article_share", b, two, period.end),
          fixture("trailer_play", a, one, period.end),
          fixture("article_navigation", b, one, period.end, a),
          fixture("article_view", a, previous, period.previousEnd),
        ],
      });
      const suffix = `?start=${period.start}&end=${period.end}`;
      const report = await request(
        "/admin/blog/analytics" + suffix,
        null,
        token(manager.id),
      );
      assert.equal(report.status, 200);
      // Scope the fixtures through a dedicated category? Report global counts can include real traffic,
      // so verify exact article aggregates and lower bounds for the global totals.
      const rowA = report.data.articles.find((row) => row.id === a),
        rowB = report.data.articles.find((row) => row.id === b);
      assert.equal(rowA.views, 3);
      assert.equal(rowA.visitors, 2);
      assert.equal(rowA.shares, 1);
      assert.equal(rowA.trailers, 1);
      assert.equal(rowA.continuations, 1);
      assert.equal(rowB.views, 1);
      assert.ok(report.data.metrics.views.value >= 4);
      assert.equal(report.data.daily.length, 7);
      assert.equal(
        report.data.categories.find((row) => row.name === key).value,
        4,
      );
      const detail = (
        await request(
          "/admin/blog/analytics" + suffix + "&articleId=" + a,
          null,
          token(manager.id),
        )
      ).data;
      assert.equal(detail.metrics.views.value, 3);
      assert.equal(detail.metrics.views.previous, 1);
      assert.equal(detail.metrics.views.change, 200);
      assert.equal(detail.metrics.visitors.value, 2);
      assert.equal(detail.metrics.multiReaders.value, 1);
      assert.equal(detail.metrics.multiRate.value, 50);
      assert.deepEqual(detail.readers, { single: 1, multiple: 1 });
      assert.equal(detail.navigation.find((row) => row.id === b).events, 1);
      assert.equal(detail.daily.at(-1).multiReaders, 1);
      assert.equal(JSON.stringify(detail).includes(visitor), false);
      assert.equal(
        (
          await request(
            "/admin/blog/analytics?start=invalid",
            null,
            token(manager.id),
          )
        ).status,
        400,
      );
    } finally {
      await prisma.blogAnalyticsEvent.deleteMany({
        where: { id: { in: eventIds } },
      });
      await prisma.blogArticle.deleteMany({
        where: { id: { in: [a, b, draft] } },
      });
      if (category)
        await prisma.blogCategory.delete({ where: { id: category.id } });
      if (manager) await prisma.user.delete({ where: { id: manager.id } });
      if (viewer) await prisma.user.delete({ where: { id: viewer.id } });
      if (oldOrigins === undefined) delete process.env.BLOG_ANALYTICS_ORIGINS;
      else process.env.BLOG_ANALYTICS_ORIGINS = oldOrigins;
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
    }
  },
);
