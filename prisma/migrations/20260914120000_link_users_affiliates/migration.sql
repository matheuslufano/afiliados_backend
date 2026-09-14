ALTER TABLE "Affiliate" ADD COLUMN "userId" INTEGER;

UPDATE "Affiliate" AS affiliate
SET "userId" = app_user.id
FROM "User" AS app_user
WHERE affiliate."email" IS NOT NULL
  AND LOWER(affiliate."email") = LOWER(app_user."email")
  AND affiliate."userId" IS NULL;

CREATE UNIQUE INDEX "Affiliate_userId_key" ON "Affiliate"("userId");

ALTER TABLE "Affiliate"
ADD CONSTRAINT "Affiliate_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
