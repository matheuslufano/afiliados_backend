WITH matching_responsible AS (
  SELECT
    deal.id AS deal_id,
    MIN(app_user.id) AS user_id
  FROM "CrmDeal" AS deal
  INNER JOIN "User" AS app_user
    ON LOWER(BTRIM(deal.owner)) = LOWER(BTRIM(app_user.name))
  WHERE deal."responsibleUserId" IS NULL
    AND NULLIF(BTRIM(deal.owner), '') IS NOT NULL
    AND app_user.active = TRUE
  GROUP BY deal.id
  HAVING COUNT(*) = 1
)
UPDATE "CrmDeal" AS deal
SET
  "responsibleUserId" = matching_responsible.user_id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM matching_responsible
WHERE deal.id = matching_responsible.deal_id;
