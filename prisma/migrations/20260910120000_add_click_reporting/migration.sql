ALTER TABLE "Click"
  ADD COLUMN "clickCode" TEXT,
  ADD COLUMN "visitorId" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "ipHash" TEXT,
  ADD COLUMN "browserVersion" TEXT,
  ADD COLUMN "destinationUrl" TEXT,
  ADD COLUMN "isUnique" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isValid" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isSuspectedBot" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Conversion" ADD COLUMN "clickId" INTEGER;

CREATE UNIQUE INDEX "Click_clickCode_key" ON "Click"("clickCode");
CREATE INDEX "Click_clickedAt_idx" ON "Click"("clickedAt");
CREATE INDEX "Click_linkId_clickedAt_idx" ON "Click"("linkId", "clickedAt");
CREATE INDEX "Click_visitorId_idx" ON "Click"("visitorId");
CREATE INDEX "Click_sessionId_idx" ON "Click"("sessionId");
CREATE INDEX "Click_utmSource_idx" ON "Click"("utmSource");
CREATE INDEX "Click_utmCampaign_idx" ON "Click"("utmCampaign");
CREATE INDEX "Click_source_idx" ON "Click"("source");
CREATE INDEX "Click_geoCity_idx" ON "Click"("geoCity");
CREATE INDEX "Click_isValid_idx" ON "Click"("isValid");
CREATE INDEX "Conversion_clickId_idx" ON "Conversion"("clickId");

ALTER TABLE "Conversion"
  ADD CONSTRAINT "Conversion_clickId_fkey"
  FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE SET NULL ON UPDATE CASCADE;
