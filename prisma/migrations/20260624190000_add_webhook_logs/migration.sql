CREATE TABLE "WebhookLog" (
  "id" SERIAL NOT NULL,
  "provider" TEXT NOT NULL,
  "attendanceId" TEXT,
  "channelName" TEXT,
  "channelType" TEXT,
  "eventStatus" TEXT,
  "shortCode" TEXT,
  "conversionId" INTEGER,
  "linkId" INTEGER,
  "visitorName" TEXT,
  "visitorPhone" TEXT,
  "visitorDocument" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "raw" JSONB NOT NULL,
  "query" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookLog_provider_receivedAt_idx"
  ON "WebhookLog"("provider", "receivedAt");

CREATE INDEX "WebhookLog_attendanceId_idx"
  ON "WebhookLog"("attendanceId");

CREATE INDEX "WebhookLog_shortCode_idx"
  ON "WebhookLog"("shortCode");
