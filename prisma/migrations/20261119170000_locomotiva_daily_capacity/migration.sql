-- Daily capacity is validated transactionally against the active reservation count.
-- Remove the previous fixed one-reservation-per-date constraint.
DROP INDEX IF EXISTS "locomotiva_active_date";
