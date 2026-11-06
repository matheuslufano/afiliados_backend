CREATE TABLE "BlogCategory" (
  "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL UNIQUE, "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "BlogCategory" ("name", "slug") SELECT DISTINCT "category", "category" FROM "BlogArticle";
ALTER TABLE "BlogArticle"
  ALTER COLUMN "syncedAt" DROP NOT NULL,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "publishedRevision" INTEGER,
  ADD COLUMN "publicSnapshot" JSONB,
  ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "authorId" INTEGER,
  ADD COLUMN "syncError" TEXT,
  ADD COLUMN "syncAttemptedAt" TIMESTAMP(3);
UPDATE "BlogArticle" SET "searchText" = "content"::text;
ALTER TABLE "BlogArticle" ADD CONSTRAINT "BlogArticle_category_fkey" FOREIGN KEY ("category") REFERENCES "BlogCategory"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;
