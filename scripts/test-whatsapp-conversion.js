const app = require('../src/app');

function getShortCode(link) {
  const path = new URL(link).pathname;
  const shortCode = path.split('/').filter(Boolean).at(-1);

  if (!shortCode) {
    throw new Error(`Nao foi possivel extrair shortCode de ${link}`);
  }

  return shortCode;
}

function assertStatsPayload(stats, label) {
  if (typeof stats.totalConversions !== 'number') {
    throw new Error(
      `${label} nao retornou totalConversions. A API testada parece estar sem a implementacao de conversoes.`
    );
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `${options?.method || 'GET'} ${url} retornou ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function runAgainstBaseUrl(baseUrl) {
  const created = await requestJson(`${baseUrl}/links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: `TESTE conversao whatsapp ${Date.now()}`,
      url: 'https://example.com/landing-teste'
    })
  });

  const shortCode = getShortCode(created.link);
  const links = await requestJson(`${baseUrl}/links`);
  const link = links.find((item) => item.shortCode === shortCode);

  if (!link) {
    throw new Error(`Link temporario ${shortCode} nao apareceu em /links`);
  }

  try {
    const before = await requestJson(`${baseUrl}/links/${link.id}/stats`);
    assertStatsPayload(before, 'Stats antes do teste');

    const whatsappResponse = await fetch(
      `${baseUrl}/links/${shortCode}/whatsapp?product=Teste%20Automatizado`,
      {
        redirect: 'manual',
        headers: {
          'user-agent': 'codex-whatsapp-conversion-test'
        }
      }
    );
    const after = await requestJson(`${baseUrl}/links/${link.id}/stats`);
    assertStatsPayload(after, 'Stats depois do teste');

    const increment = after.totalConversions - before.totalConversions;

    console.log(
      JSON.stringify(
        {
          ok: whatsappResponse.status >= 300 && whatsappResponse.status < 400 && increment === 1,
          linkId: link.id,
          shortCode,
          hasWhatsappLink: Boolean(link.whatsappLink),
          whatsappStatus: whatsappResponse.status,
          redirectLocation: whatsappResponse.headers.get('location'),
          beforeConversions: before.totalConversions,
          afterConversions: after.totalConversions,
          increment
        },
        null,
        2
      )
    );

    if (increment !== 1) {
      throw new Error(`Esperava incremento 1, recebeu ${increment}`);
    }

    if (whatsappResponse.status < 300 || whatsappResponse.status >= 400) {
      throw new Error(`Esperava redirect 3xx, recebeu ${whatsappResponse.status}`);
    }
  } finally {
    const deleted = await fetch(`${baseUrl}/links/${link.id}`, {
      method: 'DELETE'
    });

    if (!deleted.ok) {
      console.error(`Aviso: falha ao apagar link temporario ${link.id}: ${deleted.status}`);
    }
  }
}

async function main() {
  const remoteBaseUrl = process.argv[2] || process.env.TEST_API_URL;

  if (remoteBaseUrl) {
    await runAgainstBaseUrl(remoteBaseUrl.replace(/\/+$/, ''));
    return;
  }

  const server = app.listen(0, async () => {
    const { port } = server.address();

    try {
      await runAgainstBaseUrl(`http://127.0.0.1:${port}`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
