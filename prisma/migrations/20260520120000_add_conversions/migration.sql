-- CreateTable
CREATE TABLE "Conversion" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'whatsapp',
    "product" TEXT,
    "destination" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkId" INTEGER NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
