CREATE TABLE "LocomotivaConfig" ("id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id" = 1), "data" JSONB NOT NULL);
CREATE TABLE "LocomotivaRegistration" (
  "id" TEXT PRIMARY KEY, "requestKey" TEXT NOT NULL UNIQUE, "requestHash" TEXT NOT NULL,
  "date" TEXT NOT NULL CHECK ("date" BETWEEN '2026-11-21' AND '2026-11-30'),
  "status" TEXT NOT NULL CHECK ("status" IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','ATTENDED','ABSENT')),
  "cpfHash" TEXT NOT NULL, "instagram" TEXT NOT NULL, "email" TEXT NOT NULL,
  "data" JSONB NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "locomotiva_active_date" ON "LocomotivaRegistration" ("date") WHERE "status" IN ('PENDING','CONFIRMED','ATTENDED','ABSENT');
CREATE UNIQUE INDEX "locomotiva_active_cpf" ON "LocomotivaRegistration" ("cpfHash") WHERE "status" IN ('PENDING','CONFIRMED','ATTENDED','ABSENT');
CREATE UNIQUE INDEX "locomotiva_active_instagram" ON "LocomotivaRegistration" ("instagram") WHERE "status" IN ('PENDING','CONFIRMED','ATTENDED','ABSENT');
CREATE UNIQUE INDEX "locomotiva_active_email" ON "LocomotivaRegistration" ("email") WHERE "status" IN ('PENDING','CONFIRMED','ATTENDED','ABSENT');
CREATE TABLE "LocomotivaInvite" ("id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "data" JSONB NOT NULL);
CREATE TABLE "LocomotivaMail" (
  "id" TEXT PRIMARY KEY, "registrationId" TEXT NOT NULL REFERENCES "LocomotivaRegistration"("id"),
  "kind" TEXT NOT NULL, "payload" JSONB NOT NULL, "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "sentAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE "LocomotivaAudit" ("id" TEXT PRIMARY KEY, "registrationId" TEXT, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "reason" TEXT NOT NULL, "at" TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE "LocomotivaRate" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMPTZ NOT NULL);
