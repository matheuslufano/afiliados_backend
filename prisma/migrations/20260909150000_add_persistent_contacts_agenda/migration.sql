CREATE TABLE "Contact" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "document" TEXT,
  "city" TEXT,
  "neighborhood" TEXT,
  "address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "preferredChannel" TEXT NOT NULL DEFAULT 'WHATSAPP',
  "notes" TEXT,
  "avatarUrl" TEXT,
  "ownerUserId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Contact_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ContactInteraction" (
  "id" SERIAL PRIMARY KEY,
  "contactId" INTEGER NOT NULL,
  "userId" INTEGER,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContactInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ContactAppointment" (
  "id" SERIAL PRIMARY KEY,
  "contactId" INTEGER NOT NULL,
  "assignedUserId" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 30,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reminderMinutes" INTEGER,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactAppointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContactAppointment_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "Conversion" ADD COLUMN "contactId" INTEGER;
ALTER TABLE "CrmDeal" ADD COLUMN "contactId" INTEGER;

INSERT INTO "Contact" ("name", "phone", "document", "city", "createdAt", "updatedAt")
SELECT DISTINCT ON (COALESCE(NULLIF(regexp_replace("visitorDocument", '\\D', '', 'g'), ''), NULLIF(regexp_replace("visitorPhone", '\\D', '', 'g'), ''), 'conversion:' || "id"))
  "visitorName", NULLIF(regexp_replace("visitorPhone", '\\D', '', 'g'), ''), NULLIF(regexp_replace("visitorDocument", '\\D', '', 'g'), ''), "visitorCity", "convertedAt", CURRENT_TIMESTAMP
FROM "Conversion"
WHERE "crmDeletedAt" IS NULL
ORDER BY COALESCE(NULLIF(regexp_replace("visitorDocument", '\\D', '', 'g'), ''), NULLIF(regexp_replace("visitorPhone", '\\D', '', 'g'), ''), 'conversion:' || "id"), "convertedAt" ASC, "id" ASC;

UPDATE "Conversion" AS c
SET "contactId" = contact."id"
FROM "Contact" AS contact
WHERE c."crmDeletedAt" IS NULL
  AND ((contact."document" IS NOT NULL AND contact."document" = NULLIF(regexp_replace(c."visitorDocument", '\\D', '', 'g'), ''))
    OR (contact."document" IS NULL AND contact."phone" IS NOT NULL AND contact."phone" = NULLIF(regexp_replace(c."visitorPhone", '\\D', '', 'g'), '')));

UPDATE "CrmDeal" AS d
SET "contactId" = c."contactId"
FROM "Conversion" AS c
WHERE d."conversionId" = c."id" AND c."contactId" IS NOT NULL;

CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");
CREATE INDEX "Contact_document_idx" ON "Contact"("document");
CREATE INDEX "Contact_status_deletedAt_idx" ON "Contact"("status", "deletedAt");
CREATE INDEX "Contact_ownerUserId_status_idx" ON "Contact"("ownerUserId", "status");
CREATE INDEX "ContactInteraction_contactId_occurredAt_idx" ON "ContactInteraction"("contactId", "occurredAt");
CREATE INDEX "ContactAppointment_contactId_scheduledAt_idx" ON "ContactAppointment"("contactId", "scheduledAt");
CREATE INDEX "ContactAppointment_assignedUserId_scheduledAt_status_idx" ON "ContactAppointment"("assignedUserId", "scheduledAt", "status");
CREATE INDEX "Conversion_contactId_idx" ON "Conversion"("contactId");
CREATE INDEX "CrmDeal_contactId_idx" ON "CrmDeal"("contactId");
