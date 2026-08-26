ALTER TABLE "Conversion"
  ADD COLUMN "attendanceId" TEXT;

WITH latest_per_conversion AS (
  SELECT
    "conversionId",
    "attendanceId",
    "receivedAt",
    ROW_NUMBER() OVER (
      PARTITION BY "conversionId"
      ORDER BY "receivedAt" DESC, "id" DESC
    ) AS conversion_rank
  FROM "WebhookLog"
  WHERE "provider" = 'chatmix'
    AND "conversionId" IS NOT NULL
    AND "attendanceId" IS NOT NULL
), unique_attendance AS (
  SELECT
    "conversionId",
    "attendanceId",
    ROW_NUMBER() OVER (
      PARTITION BY "attendanceId"
      ORDER BY "receivedAt" DESC, "conversionId" DESC
    ) AS attendance_rank
  FROM latest_per_conversion
  WHERE conversion_rank = 1
)
UPDATE "Conversion" AS conversion
SET "attendanceId" = unique_attendance."attendanceId"
FROM unique_attendance
WHERE conversion."id" = unique_attendance."conversionId"
  AND unique_attendance.attendance_rank = 1;

CREATE UNIQUE INDEX "Conversion_attendanceId_key"
  ON "Conversion"("attendanceId");
