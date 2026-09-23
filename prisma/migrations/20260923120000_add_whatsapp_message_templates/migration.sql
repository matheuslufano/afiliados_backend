CREATE TABLE "WhatsAppMessageTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "WhatsAppMessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppMessageTemplate_createdById_name_key"
ON "WhatsAppMessageTemplate"("createdById", "name");

CREATE INDEX "WhatsAppMessageTemplate_createdById_updatedAt_idx"
ON "WhatsAppMessageTemplate"("createdById", "updatedAt");

ALTER TABLE "WhatsAppMessageTemplate"
ADD CONSTRAINT "WhatsAppMessageTemplate_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
