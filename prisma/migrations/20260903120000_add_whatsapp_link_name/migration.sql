ALTER TABLE "WhatsAppLink" ADD COLUMN "name" TEXT;

UPDATE "WhatsAppLink"
SET "name" = CONCAT('Link WhatsApp ', "id")
WHERE "name" IS NULL;

ALTER TABLE "WhatsAppLink" ALTER COLUMN "name" SET NOT NULL;
