ALTER TABLE "Conversion" ADD COLUMN "crmDeletedAt" TIMESTAMP(3);

CREATE INDEX "Conversion_crmDeletedAt_idx" ON "Conversion"("crmDeletedAt");
