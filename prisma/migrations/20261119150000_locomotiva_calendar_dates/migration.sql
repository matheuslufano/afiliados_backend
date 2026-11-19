ALTER TABLE "LocomotivaRegistration"
  DROP CONSTRAINT "LocomotivaRegistration_date_check",
  ADD CONSTRAINT "LocomotivaRegistration_date_check"
    CHECK ("date" ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' AND "date"::date IS NOT NULL);
