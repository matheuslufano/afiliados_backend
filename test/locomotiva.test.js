const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const v = require("../src/services/locomotivaValidation");
process.env.LOCOMOTIVA_DATA_KEY ||= "ab".repeat(32);
test("CPF, encryption and profile normalization reject invalid and internal URLs", () => {
  assert.ok(v.cpfValid("52998224725"));
  assert.ok(!v.cpfValid("11111111111"));
  assert.equal(v.decrypt(v.encrypt("52998224725")), "52998224725");
  assert.equal(
    v.instagram("@example", "https://instagram.com/example/").instagram,
    "example",
  );
  for (const url of [
    "http://localhost/example",
    "https://instagram.com.evil.test/example",
    "https://instagram.com@127.0.0.1/example",
    "https://instagram.com/other/",
  ])
    assert.throws(() => v.instagram("example", url));
  assert.throws(() => v.photo("data:image/svg+xml;base64,AAAA"));
});
test("configuration requires approved documents and disallows arrivals at closing", () => {
  assert.throws(() =>
    v.configuration({ ...v.DEFAULT_CONFIG, lunch: ["15:00"] }),
  );
  assert.throws(() =>
    v.configuration({ ...v.DEFAULT_CONFIG, dinner: ["23:00"] }),
  );
  assert.throws(() =>
    v.configuration({ ...v.DEFAULT_CONFIG, published: true }),
  );
  assert.equal(v.DATES.length, 10);
});

// Integration suite only runs with an explicitly selected disposable local database.
const integration = process.env.LOCOMOTIVA_TEST_DATABASE_URL;
if (integration) {
  if (
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/locomotiva_test(?:\?|$)/.test(
      integration,
    )
  )
    throw new Error("Use the disposable local locomotiva_test database only.");
  process.env.DATABASE_URL = integration;
  const r = require("../src/services/locomotivaRepository");
  const nodemailer = require("nodemailer");
  const mail = require("../src/services/locomotivaMail");
  let server;
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await r.prisma.$disconnect();
  });
  test("PostgreSQL: atomic booking, idempotency, release, consent, outbox and access controls", async (t) => {
    const exists = await r.prisma
      .$queryRaw`SELECT to_regclass('public."LocomotivaConfig"')::text AS name`;
    if (!exists[0].name) {
      const sql = fs.readFileSync(
        path.join(
          __dirname,
          "../prisma/migrations/20261117120000_locomotiva_campaign/migration.sql",
        ),
        "utf8",
      );
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await r.prisma.$executeRawUnsafe(statement);
    }
    await r.prisma.$executeRawUnsafe(
      'TRUNCATE "LocomotivaMail", "LocomotivaRegistration", "LocomotivaConfig", "LocomotivaAudit", "LocomotivaInvite", "LocomotivaRate"',
    );
    const config = {
      ...v.DEFAULT_CONFIG,
      published: true,
      revision: 1,
      minimumHours: 0,
      lunch: ["11:30"],
      dinner: ["19:00"],
    };
    for (const k of v.missing(config))
      if (k !== "arrivalTimes")
        config[k] = "Texto fictício exclusivo de teste — não publicar";
    await r.prisma
      .$executeRaw`INSERT INTO "LocomotivaConfig" (id,data) VALUES (1,${JSON.stringify(config)}::jsonb)`;
    function payload(overrides = {}) {
      return {
        requestKey: crypto.randomUUID(),
        name: "Participante de teste",
        cpf: "52998224725",
        email: "test@example.invalid",
        emailConfirmation: "test@example.invalid",
        phone: "63999999999",
        city: "Cidade teste",
        uf: "TO",
        instagram: "testprofile",
        profileUrl: "https://www.instagram.com/testprofile/",
        profileConfirmed: true,
        date: "2026-11-21",
        period: "lunch",
        time: "11:30",
        modality: "STORIES",
        revision: 1,
        acceptances: { conditions: true, image: true, privacy: true },
        ...overrides,
      };
    }
    const first = payload(),
      second = payload({
        cpf: "11144477735",
        email: "other@example.invalid",
        emailConfirmation: "other@example.invalid",
        instagram: "otherprofile",
        profileUrl: "https://instagram.com/otherprofile/",
      });
    let receipt;
    await t.test(
      "simultaneous submissions: exactly one wins, one clear conflict",
      async () => {
        const results = await Promise.allSettled([
          r.submit(first),
          r.submit(second),
        ]);
        assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(
          results.find((x) => x.status === "rejected").reason.status,
          409,
        );
        receipt = results.find((x) => x.status === "fulfilled").value;
      },
    );
    const winner = (
      await r.prisma
        .$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id=${receipt.protocol}`
    )[0];
    const winningPayload = winner.email === first.email ? first : second;
    await t.test(
      "same request replay returns same protocol without duplicate outbox",
      async () => {
        assert.equal(
          (await r.submit(winningPayload)).protocol,
          receipt.protocol,
        );
        const mails = await r.prisma.$queryRaw`SELECT id FROM "LocomotivaMail"`;
        assert.equal(mails.length, 1);
        await assert.rejects(
          r.submit({ ...winningPayload, name: "Different" }),
          (e) => e.status === 409,
        );
      },
    );
    await t.test(
      "duplicate identity and stale consent fail without a second booking",
      async () => {
        await assert.rejects(
          r.submit({
            ...winningPayload,
            requestKey: crypto.randomUUID(),
            date: "2026-11-22",
          }),
          (e) => e.status === 409,
        );
        await assert.rejects(
          r.submit(payload({ revision: 0 })),
          (e) => e.status === 412,
        );
        await assert.rejects(
          r.submit(payload({ acceptances: { conditions: true } })),
          (e) => e.status === 400,
        );
      },
    );
    await t.test(
      "rejection releases date and permits a new application",
      async () => {
        await r.update(
          winner.id,
          { ...winner.data, status: "REJECTED", reason: "Teste de liberação" },
          "test-admin",
        );
        assert.equal(
          (await r.availability()).find((d) => d.date === winner.date).state,
          "AVAILABLE",
        );
        const fresh = await r.submit({
          ...winningPayload,
          requestKey: crypto.randomUUID(),
        });
        assert.notEqual(fresh.protocol, receipt.protocol);
        receipt = fresh;
      },
    );
    await t.test(
      "database unique partial index rejects direct conflicting writers",
      async () => {
        await assert.rejects(
          r.prisma
            .$executeRaw`INSERT INTO "LocomotivaRegistration" (id,"requestKey","requestHash",date,status,"cpfHash",instagram,email,data) VALUES (${crypto.randomUUID()},${crypto.randomUUID()},'x','2026-11-21','PENDING','different','different','different','{}'::jsonb)`,
        );
      },
    );
    await t.test(
      "photo unavailable does not prevent registration; CPF is masked",
      async () => {
        const [row] = await r.prisma
          .$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id=${receipt.protocol}`;
        const safe = r.safe(row);
        assert.equal(safe.photoState, "UNAVAILABLE");
        assert.ok(!JSON.stringify(safe).includes(winningPayload.cpf));
        assert.equal(safe.cpfCipher, undefined);
      },
    );
    await t.test(
      "SMTP failure preserves registration and records failed attempt; retry can send",
      async () => {
        nodemailer.createTransport = () => ({
          sendMail: async () => {
            throw new Error("simulated failure");
          },
        });
        process.env.LOCOMOTIVA_SMTP_URL = "smtp://127.0.0.1:9";
        process.env.LOCOMOTIVA_MAIL_FROM = "test@example.invalid";
        await mail.drain();
        const failed = await r.prisma
          .$queryRaw`SELECT state FROM "LocomotivaMail"`;
        assert.ok(
          failed.every((m) => ["FAILED", "SUPERSEDED"].includes(m.state)),
        );
        assert.ok(
          (
            await r.prisma
              .$queryRaw`SELECT id FROM "LocomotivaRegistration" WHERE id=${receipt.protocol}`
          ).length,
        );
        nodemailer.createTransport = () => ({
          sendMail: async () => ({ accepted: ["test@example.invalid"] }),
        });
        await r.prisma
          .$executeRaw`UPDATE "LocomotivaMail" SET state='PENDING' WHERE "registrationId"=${receipt.protocol}`;
        await mail.drain();
        const [sent] = await r.prisma
          .$queryRaw`SELECT state,attempts FROM "LocomotivaMail" WHERE "registrationId"=${receipt.protocol}`;
        assert.equal(sent.state, "SENT");
        assert.equal(sent.attempts, 2);
      },
    );
    await t.test("cancellation releases the date", async () => {
      const [row] = await r.prisma
        .$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id=${receipt.protocol}`;
      await r.update(
        row.id,
        { ...row.data, status: "CANCELLED", reason: "Teste cancelamento" },
        "test-admin",
      );
      assert.equal(
        (await r.availability()).find((d) => d.date === row.date).state,
        "AVAILABLE",
      );
    });
    await t.test(
      "date changes check conflicts and queue updated communication atomically",
      async () => {
        const a = await r.submit({
          ...first,
          requestKey: crypto.randomUUID(),
          date: "2026-11-22",
        });
        const b = await r.submit({
          ...second,
          requestKey: crypto.randomUUID(),
          date: "2026-11-23",
        });
        const [row] = await r.prisma
          .$queryRaw`SELECT * FROM "LocomotivaRegistration" WHERE id=${a.protocol}`;
        await assert.rejects(
          r.update(
            row.id,
            { ...row.data, date: "2026-11-23", reason: "Teste de conflito" },
            "admin",
          ),
          (e) => e.status === 409,
        );
        await r.update(
          row.id,
          { ...row.data, date: "2026-11-24", reason: "Nova data solicitada" },
          "admin",
        );
        const days = await r.availability();
        assert.equal(
          days.find((d) => d.date === "2026-11-22").state,
          "AVAILABLE",
        );
        assert.equal(
          days.find((d) => d.date === "2026-11-24").state,
          "PENDING",
        );
        const messages = await r.prisma
          .$queryRaw`SELECT kind,state FROM "LocomotivaMail" WHERE "registrationId"=${a.protocol}`;
        assert.ok(
          messages.some((m) => m.kind === "UPDATED" && m.state === "PENDING"),
        );
        assert.ok(
          messages.some(
            (m) => m.kind === "RECEIVED" && m.state === "SUPERSEDED",
          ),
        );
        assert.ok(b.protocol);
      },
    );
    await t.test(
      "public HTTP and unauthorized administrative access",
      async () => {
        const express = require("express");
        const app = express();
        app.use(express.json());
        app.use(require("../src/routes/locomotivaRoutes"));
        server = app.listen(0, "127.0.0.1");
        await new Promise((resolve) => server.once("listening", resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.equal((await fetch(`${base}/admin/locomotiva`)).status, 401);
        const publicData = await (
          await fetch(`${base}/locomotiva/config`)
        ).json();
        assert.equal(publicData.availability.length, 10);
        assert.ok(!JSON.stringify(publicData).includes("test@example.invalid"));
        assert.equal((await fetch(`${base}/campanha-locomotiva/`)).status, 200);
        const profile = await (
          await fetch(`${base}/locomotiva/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instagram: "testprofile",
              profileUrl: "https://instagram.com/testprofile/",
            }),
          })
        ).json();
        assert.equal(profile.state, "UNAVAILABLE");
        const {
          requireManager,
          requireAdmin,
        } = require("../src/middleware/auth");
        let status;
        const res = {
          status: (n) => {
            status = n;
            return res;
          },
          json: () => {},
        };
        requireManager({ user: { role: "USER" } }, res, () =>
          assert.fail("USER cannot manage"),
        );
        assert.equal(status, 403);
        requireAdmin({ user: { role: "MANAGER" } }, res, () =>
          assert.fail("MANAGER cannot read CPF"),
        );
        assert.equal(status, 403);
      },
    );
  });
}
