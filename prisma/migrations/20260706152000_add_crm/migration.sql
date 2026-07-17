CREATE TABLE "CrmFunnel" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CrmStage" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "color" TEXT,
  "slaHours" INTEGER,
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "isWonStage" BOOLEAN NOT NULL DEFAULT false,
  "isLostStage" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "funnelId" INTEGER NOT NULL REFERENCES "CrmFunnel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmDealStatus" (
  "id" SERIAL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CrmLeadSource" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CrmDeal" (
  "id" SERIAL PRIMARY KEY,
  "customerName" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "city" TEXT,
  "neighborhood" TEXT,
  "address" TEXT,
  "estimatedValue" DECIMAL(10,2),
  "monthlyValue" DECIMAL(10,2),
  "plan" TEXT,
  "priorityLevel" TEXT NOT NULL DEFAULT 'medium',
  "notes" TEXT,
  "trackingCode" TEXT,
  "rdId" TEXT,
  "chatmixId" TEXT,
  "sgpId" TEXT,
  "campaignName" TEXT,
  "lastInteractionAt" TIMESTAMP(3),
  "nextFollowUpAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "funnelId" INTEGER NOT NULL REFERENCES "CrmFunnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stageId" INTEGER NOT NULL REFERENCES "CrmStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "statusId" INTEGER NOT NULL REFERENCES "CrmDealStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceId" INTEGER REFERENCES "CrmLeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "affiliateId" INTEGER REFERENCES "Affiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "linkId" INTEGER REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "conversionId" INTEGER UNIQUE REFERENCES "Conversion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CrmDealTask" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "taskType" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dealId" INTEGER NOT NULL REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmDealHistory" (
  "id" SERIAL PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dealId" INTEGER NOT NULL REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmSyncLog" (
  "id" SERIAL PRIMARY KEY,
  "integrationName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AffiliateCommission" (
  "id" SERIAL PRIMARY KEY,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "affiliateId" INTEGER NOT NULL REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dealId" INTEGER NOT NULL REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmFunnel_name_key" ON "CrmFunnel"("name");
CREATE UNIQUE INDEX "CrmStage_funnelId_name_key" ON "CrmStage"("funnelId", "name");
CREATE UNIQUE INDEX "CrmDealStatus_key_key" ON "CrmDealStatus"("key");
CREATE UNIQUE INDEX "CrmLeadSource_name_key" ON "CrmLeadSource"("name");
CREATE UNIQUE INDEX "AffiliateCommission_affiliateId_dealId_key" ON "AffiliateCommission"("affiliateId", "dealId");

CREATE INDEX "CrmStage_funnelId_position_idx" ON "CrmStage"("funnelId", "position");
CREATE INDEX "CrmDeal_funnelId_idx" ON "CrmDeal"("funnelId");
CREATE INDEX "CrmDeal_stageId_idx" ON "CrmDeal"("stageId");
CREATE INDEX "CrmDeal_statusId_idx" ON "CrmDeal"("statusId");
CREATE INDEX "CrmDeal_affiliateId_idx" ON "CrmDeal"("affiliateId");
CREATE INDEX "CrmDeal_createdAt_idx" ON "CrmDeal"("createdAt");
CREATE INDEX "CrmDealTask_dealId_status_idx" ON "CrmDealTask"("dealId", "status");
CREATE INDEX "CrmDealHistory_dealId_createdAt_idx" ON "CrmDealHistory"("dealId", "createdAt");
CREATE INDEX "AffiliateCommission_dealId_idx" ON "AffiliateCommission"("dealId");
