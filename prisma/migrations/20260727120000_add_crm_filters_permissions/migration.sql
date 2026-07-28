ALTER TABLE "User"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "teamId" INTEGER;

UPDATE "User"
SET "role" = 'ADMIN'
WHERE LOWER("email") = 'admin@netbox.com';

CREATE TABLE "CrmTeam" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CrmTeam_name_key" ON "CrmTeam"("name");

ALTER TABLE "User"
  ADD CONSTRAINT "User_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "CrmTeam"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmDeal"
  ADD COLUMN "createdByUserId" INTEGER,
  ADD COLUMN "responsibleUserId" INTEGER,
  ADD COLUMN "updatedByUserId" INTEGER;

ALTER TABLE "CrmDeal"
  ADD CONSTRAINT "CrmDeal_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmDeal_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "CrmDeal_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SavedCrmFilter" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "funnelId" INTEGER,
  "conditions" JSONB NOT NULL,
  "sort" JSONB,
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerUserId" INTEGER NOT NULL REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "User_teamId_active_idx" ON "User"("teamId", "active");
CREATE INDEX "CrmDeal_createdByUserId_idx" ON "CrmDeal"("createdByUserId");
CREATE INDEX "CrmDeal_responsibleUserId_idx" ON "CrmDeal"("responsibleUserId");
CREATE INDEX "SavedCrmFilter_ownerUserId_isDefault_idx"
  ON "SavedCrmFilter"("ownerUserId", "isDefault");
CREATE INDEX "SavedCrmFilter_visibility_idx" ON "SavedCrmFilter"("visibility");
