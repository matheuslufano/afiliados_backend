CREATE TABLE "BlogAnalyticsEvent" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('article_view','article_share','trailer_play','article_navigation')),
  "articleId" TEXT NOT NULL,
  "articleTitle" TEXT NOT NULL,
  "articleSlug" TEXT NOT NULL,
  "articleCover" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "visitorHash" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "fromArticleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogAnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BlogAnalyticsEvent_createdAt_kind_idx" ON "BlogAnalyticsEvent"("createdAt","kind");
CREATE INDEX "BlogAnalyticsEvent_articleId_createdAt_idx" ON "BlogAnalyticsEvent"("articleId","createdAt");
CREATE INDEX "BlogAnalyticsEvent_visitorHash_createdAt_idx" ON "BlogAnalyticsEvent"("visitorHash","createdAt");
CREATE INDEX "BlogAnalyticsEvent_sessionHash_createdAt_idx" ON "BlogAnalyticsEvent"("sessionHash","createdAt");
CREATE INDEX "BlogAnalyticsEvent_fromArticleId_createdAt_idx" ON "BlogAnalyticsEvent"("fromArticleId","createdAt");
