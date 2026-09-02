ALTER TABLE "Link" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WhatsAppLink" (
  "id" SERIAL NOT NULL,
  "whatsappNumber" TEXT NOT NULL,
  "originalMessage" TEXT NOT NULL,
  "finalMessage" TEXT NOT NULL,
  "identificationTemplate" TEXT NOT NULL DEFAULT 'Código do afiliado: {{codigo}}',
  "appendAffiliateCode" BOOLEAN NOT NULL DEFAULT true,
  "whatsappUrl" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "campaignId" INTEGER NOT NULL,
  "affiliateId" INTEGER NOT NULL,
  "linkId" INTEGER NOT NULL,
  "createdById" INTEGER NOT NULL,
  CONSTRAINT "WhatsAppLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppLink_campaignId_createdAt_idx" ON "WhatsAppLink"("campaignId", "createdAt");
CREATE INDEX "WhatsAppLink_affiliateId_createdAt_idx" ON "WhatsAppLink"("affiliateId", "createdAt");
CREATE INDEX "WhatsAppLink_linkId_idx" ON "WhatsAppLink"("linkId");
CREATE INDEX "WhatsAppLink_active_createdAt_idx" ON "WhatsAppLink"("active", "createdAt");

ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
