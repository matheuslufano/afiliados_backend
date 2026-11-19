const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const v = require("../src/services/locomotivaValidation");
const { defaults, formattedEmail } = require("../src/services/locomotivaMailTemplates");
process.env.LOCOMOTIVA_DATA_KEY ||= "ab".repeat(32);
test("CPF, encryption and profile normalization reject invalid and internal URLs", () => {
  assert.ok(v.cpfValid("52998224725"));
  assert.ok(!v.cpfValid("11111111111"));
  assert.equal(v.decrypt(v.encrypt("52998224725")), "52998224725");
  assert.equal(
    v.instagram("https://instagram.com/Example/").instagram,
    "example",
  );
  for (const url of [
    "http://localhost/example",
    "https://instagram.com.evil.test/example",
    "https://instagram.com@127.0.0.1/example",
    "https://instagram.com/reel/example/",
  ])
    assert.throws(() => v.instagram(url));
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
  assert.deepEqual(v.configuration({ ...v.DEFAULT_CONFIG, dates: ["2027-02-01", "2026-12-05", "2027-02-01"] }).dates, ["2026-12-05", "2027-02-01"]);
  assert.throws(() => v.configuration({ ...v.DEFAULT_CONFIG, dates: ["2027-02-29"] }));
});

test("reservation settings retain the voucher value and supported message templates", () => {
  const result = v.configuration({
    ...v.DEFAULT_CONFIG,
    restaurantName: " Locomotiva ",
    voucherAmount: "219.50",
    messageCONFIRMED: "Olá, {{nome}}!",
    messageUNKNOWN: "Ignorar",
  });
  assert.equal(result.restaurantName, "Locomotiva");
  assert.equal(result.voucherAmount, 219.5);
  assert.equal(result.messageCONFIRMED, "Olá, {{nome}}!");
  assert.equal(result.messageUNKNOWN, undefined);
  assert.throws(() => v.configuration({ ...v.DEFAULT_CONFIG, voucherAmount: -1 }), /valor válido/);
  const expired = { ...v.DEFAULT_CONFIG, dates: ["2000-01-15"], lunch: ["12:00"], published: true };
  for (const field of v.missing(expired)) expired[field] = "Valor de teste";
  assert.throws(() => v.configuration(expired), /data futura/);
});

test("all five events have editable defaults and the branded HTML escapes message text", () => {
  assert.deepEqual(Object.keys(defaults).sort(), ["CANCELLED", "CONFIRMED", "RECEIVED", "REJECTED", "UPDATED"]);
  for (const [event, template] of Object.entries(defaults)) {
    assert.ok(template.subject && template.body.includes("{{nome}}"));
    assert.doesNotThrow(() => v.mailTemplate(event, template.subject, template.body));
  }
  assert.throws(() => v.mailTemplate("RECEIVED", "Olá", "{{senha}}"), /variável desconhecida/);
  const html = formattedEmail("Visita <teste>", "Olá <script>\nSegunda linha\n\nOutro parágrafo.");
  assert.match(html, /Visita &lt;teste&gt;/);
  assert.match(html, /Olá &lt;script&gt;<br>Segunda linha/);
  assert.doesNotMatch(html, /<script>/);
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
  process.env.LOCOMOTIVA_LOCAL_TEST = "false";
  process.env.LOCOMOTIVA_INSTAGRAM_PUBLIC_LOOKUP = "false";
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
    await r.prisma.$executeRawUnsafe(fs.readFileSync(path.join(
      __dirname, "../prisma/migrations/20261119150000_locomotiva_calendar_dates/migration.sql",
    ), "utf8"));
    await r.prisma.$executeRawUnsafe(fs.readFileSync(path.join(
      __dirname, "../prisma/migrations/20261119160000_locomotiva_repeat_participation/migration.sql",
    ), "utf8"));
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
      "same participant can request a different date, and consent is still required",
      async () => {
        const repeat = await r.submit({
          ...winningPayload,
          requestKey: crypto.randomUUID(),
          date: "2026-11-25",
        });
        assert.notEqual(repeat.protocol, receipt.protocol);
        assert.equal(repeat.date, "2026-11-25");
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
      async (httpTest) => {
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
        await httpTest.test("draft, approvals, publication and closure preserve accepted terms", async (flow) => {
          await r.prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "User" (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
            "photoUrl" TEXT, role TEXT NOT NULL, active BOOLEAN NOT NULL, "teamId" INTEGER
          )`;
          const [manager] = await r.prisma.$queryRaw`INSERT INTO "User" (name,email,password,role,active)
            VALUES ('Gestor de teste','locomotiva-manager@example.invalid','login bloqueado','MANAGER',true)
            ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active RETURNING id`;
          const payloadToken = Buffer.from(JSON.stringify({ id: manager.id })).toString("base64url");
          const signature = crypto.createHmac("sha256", process.env.JWT_SECRET || "minha_chave_super_secreta")
            .update(payloadToken).digest("base64url");
          let version = 0;
          const save = async (operation, extra = {}, expected = 200) => {
            const response = await fetch(`${base}/admin/locomotiva/config`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${payloadToken}.${signature}` },
              body: JSON.stringify({ operation, version, ...extra }),
            });
            const result = await response.json();
            assert.equal(response.status, expected, JSON.stringify(result));
            if (response.ok) version = result.version;
          };
          const saved = await r.config();
          const acceptanceBefore = await r.prisma.$queryRaw`SELECT id, data->'acceptance' AS acceptance FROM "LocomotivaRegistration" ORDER BY id`;
          const list = await fetch(`${base}/admin/locomotiva`, {
            headers: { Authorization: `Bearer ${payloadToken}.${signature}` },
          });
          assert.equal(list.status, 200);
          const dashboard = await list.json();
          assert.deepEqual(dashboard.mailTemplates, defaults);
          assert.deepEqual(
            dashboard.registrations.map(({ id }) => id).sort(),
            acceptanceBefore.map(({ id }) => id),
          );
          await save("save", { config: { ...saved, dates: [] } });
          assert.deepEqual(await r.config(), saved);
          await save("publish", {}, 400);
          const additionalDate = "2027-02-01";
          await save("save", { config: { ...saved, address: "Novo endereço de teste", dates: [...saved.dates, additionalDate] } });
          await save("block-days", { dates: [additionalDate], reason: "Ajuste de agenda" });
          assert.equal((await r.settingsState()).administration.draft.dates.includes(additionalDate), false);
          await save("save", { config: { ...saved, address: "Novo endereço de teste", dates: [...saved.dates, additionalDate], messageSubjectRECEIVED: "Teste {{nome}}" } });
          await save("approve", { document: "conditions" }, 400);
          await save("review", { document: "conditions" });
          for (const document of ["imageTerm", "privacy"]) {
            await save("review", { document });
            await save("approve", { document });
          }
          const previousSmtp = process.env.LOCOMOTIVA_SMTP_URL;
          const previousFrom = process.env.LOCOMOTIVA_MAIL_FROM;
          process.env.LOCOMOTIVA_SMTP_URL = "smtp://example.invalid";
          process.env.LOCOMOTIVA_MAIL_FROM = "teste@example.invalid";
          try {
            await save("publish");
            const publicData = await (await fetch(`${base}/locomotiva/config`)).json();
            assert.equal(publicData.config.messageSubjectRECEIVED, undefined);
            assert.equal((await r.config()).messageSubjectRECEIVED, "Teste {{nome}}");
            assert.equal((await r.config()).revision, saved.revision + 1);
            assert.equal((await r.availability()).find(({ date }) => date === additionalDate)?.state, "AVAILABLE");
            await save("close");
            assert.equal((await r.config()).published, false);
            await save("publish");
            assert.equal((await r.config()).revision, saved.revision + 1);
          } finally {
            if (previousSmtp === undefined) delete process.env.LOCOMOTIVA_SMTP_URL;
            else process.env.LOCOMOTIVA_SMTP_URL = previousSmtp;
            if (previousFrom === undefined) delete process.env.LOCOMOTIVA_MAIL_FROM;
            else process.env.LOCOMOTIVA_MAIL_FROM = previousFrom;
          }
          const acceptanceAfter = await r.prisma.$queryRaw`SELECT id, data->'acceptance' AS acceptance FROM "LocomotivaRegistration" ORDER BY id`;
          assert.deepEqual(acceptanceAfter, acceptanceBefore);
          assert.ok(!(await r.config()).administration);
          await save("save-mail-template", { event: "RECEIVED", subject: "Olá, {{nome}}", body: "Recebemos sua solicitação para {{data}}." });
          assert.equal((await r.config()).revision, saved.revision + 1);
          assert.equal((await r.config()).messageRECEIVED, "Recebemos sua solicitação para {{data}}.");
          assert.equal((await r.config()).messageSubjectCONFIRMED, undefined);
          assert.equal((await r.settingsState()).administration.draft.messageSubjectRECEIVED, "Olá, {{nome}}");
          for (const page of ["condicoes.html", "seus-dados.html", "sua-visita.html", "solicitacao-recebida.html"]) {
            assert.equal((await fetch(`${base}/campanha-locomotiva/${page}`)).status, 200);
          }
          flow.mock.method(mail, "drain", async () => {});
          const visitor = payload({
            name: "Reserva fictícia Locomotiva",
            email: "reserva-ficticia@example.invalid",
            emailConfirmation: "reserva-ficticia@example.invalid",
            instagram: "usuario_legado_diferente",
            profileUrl: "https://www.instagram.com/reserva_ficticia_teste/",
            cpf: "12345678909",
            date: additionalDate,
            revision: saved.revision + 1,
          });
          const registration = await fetch(`${base}/locomotiva/registrations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(visitor),
          });
          const receipt = await registration.json();
          assert.equal(registration.status, 201, JSON.stringify(receipt));
          assert.ok(receipt.protocol);
          const detail = await fetch(`${base}/admin/locomotiva/registrations/${receipt.protocol}`, {
            headers: { Authorization: `Bearer ${payloadToken}.${signature}` },
          });
          assert.equal(detail.status, 200);
          const record = await detail.json();
          assert.equal(record.cpfFull, undefined);
          await r.prisma.$executeRaw`UPDATE "User" SET role='ADMIN' WHERE id=${manager.id}`;
          try {
            const headers = { Authorization: `Bearer ${payloadToken}.${signature}` };
            const adminDetail = await fetch(`${base}/admin/locomotiva/registrations/${receipt.protocol}`, { headers });
            assert.equal(adminDetail.status, 200);
            assert.equal((await adminDetail.json()).cpfFull, visitor.cpf);
            const adminList = await fetch(`${base}/admin/locomotiva`, { headers });
            assert.equal(adminList.status, 200);
            assert.ok((await adminList.json()).registrations.every((item) => item.cpfFull === undefined));
            const reads = await r.prisma.$queryRaw`SELECT id FROM "LocomotivaAudit" WHERE "registrationId"=${receipt.protocol} AND action='CPF_READ'`;
            assert.equal(reads.length, 1);
          } finally {
            await r.prisma.$executeRaw`UPDATE "User" SET role='MANAGER' WHERE id=${manager.id}`;
          }
          assert.equal(record.name, visitor.name);
          assert.equal(record.instagram, "reserva_ficticia_teste");
          assert.equal(record.date, additionalDate);
          assert.equal(record.status, "PENDING");
          assert.equal(record.acceptance.revision, visitor.revision);
          await save("block-days", { dates: [additionalDate], reason: "Data já solicitada" }, 409);
          assert.ok(record.emails.some(({ kind, state }) => kind === "RECEIVED" && state === "PENDING"));
          const [queued] = await r.prisma.$queryRaw`SELECT payload FROM "LocomotivaMail" WHERE "registrationId" = ${receipt.protocol} AND kind = 'RECEIVED'`;
          assert.equal(queued.payload.subject, `Olá, ${visitor.name}`);
          assert.match(queued.payload.text, /Recebemos sua solicitação para 01\/02\/2027/);
          flow.diagnostic(`Reserva fictícia ${receipt.protocol}, ${visitor.date} às ${visitor.time}, em análise.`);
          const localDate = "2027-02-02";
          await save("publish-local", { dates: [localDate] }, 403);
          await save("save", { config: { ...v.DEFAULT_CONFIG, dates: [localDate], lunch: [], dinner: [] } });
          const localFlag = process.env.LOCOMOTIVA_LOCAL_TEST;
          process.env.LOCOMOTIVA_LOCAL_TEST = "true";
          try {
            await save("publish-local", { dates: [localDate] });
            const testConfig = await r.config();
            assert.equal(testConfig.localTest, true);
            assert.deepEqual(testConfig.lunch, ["11:30"]);
            const localReceipt = await r.submit(payload({
              cpf: "98765432100", email: "reserva-local@example.invalid",
              emailConfirmation: "reserva-local@example.invalid", instagram: "reserva_local_teste",
              profileUrl: "https://www.instagram.com/reserva_local_teste/",
              revision: testConfig.revision, date: localDate,
            }));
            assert.equal(localReceipt.localTest, true);
            const mailRows = await r.prisma.$queryRaw`SELECT id FROM "LocomotivaMail" WHERE "registrationId" = ${localReceipt.protocol}`;
            assert.deepEqual(mailRows, []);
          } finally {
            if (localFlag === undefined) delete process.env.LOCOMOTIVA_LOCAL_TEST;
            else process.env.LOCOMOTIVA_LOCAL_TEST = localFlag;
          }
          assert.equal((await r.config()).published, false);
          const deletionUrl = `${base}/admin/locomotiva/registrations/${receipt.protocol}`;
          const headers = { Authorization: `Bearer ${payloadToken}.${signature}` };
          assert.equal((await fetch(deletionUrl, { method: "DELETE", headers })).status, 403);
          await r.prisma.$executeRaw`UPDATE "User" SET role='ADMIN' WHERE id=${manager.id}`;
          try {
            assert.equal((await fetch(deletionUrl, { method: "DELETE", headers })).status, 204);
            assert.equal((await fetch(deletionUrl, { headers })).status, 404);
            const messages = await r.prisma.$queryRaw`SELECT id FROM "LocomotivaMail" WHERE "registrationId"=${receipt.protocol}`;
            assert.deepEqual(messages, []);
            const audit = await r.prisma.$queryRaw`SELECT id FROM "LocomotivaAudit" WHERE "registrationId"=${receipt.protocol} AND action='REGISTRATION_DELETED'`;
            assert.equal(audit.length, 1);
          } finally {
            await r.prisma.$executeRaw`UPDATE "User" SET role='MANAGER' WHERE id=${manager.id}`;
          }
        });
      },
    );
  });
}
