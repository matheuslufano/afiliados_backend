CREATE TABLE "BlogArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topic" TEXT,
    "category" TEXT NOT NULL,
    "cover" TEXT NOT NULL,
    "coverAlt" TEXT NOT NULL,
    "coverCredit" TEXT,
    "author" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB NOT NULL,
    "seo" JSONB NOT NULL,
    "spotlight" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlogArticle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogArticleSource" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'reference',
    "position" INTEGER NOT NULL DEFAULT 0,
    "articleId" TEXT NOT NULL,
    CONSTRAINT "BlogArticleSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogArticle_slug_key" ON "BlogArticle"("slug");
CREATE INDEX "BlogArticle_status_publishedAt_idx" ON "BlogArticle"("status", "publishedAt");
CREATE INDEX "BlogArticle_category_publishedAt_idx" ON "BlogArticle"("category", "publishedAt");
CREATE INDEX "BlogArticleSource_articleId_position_idx" ON "BlogArticleSource"("articleId", "position");

ALTER TABLE "BlogArticleSource" ADD CONSTRAINT "BlogArticleSource_articleId_fkey"
FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
