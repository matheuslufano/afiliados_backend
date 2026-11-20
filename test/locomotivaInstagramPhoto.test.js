const { test } = require("node:test");
const assert = require("node:assert/strict");
const instagramPhoto = require("../src/services/locomotivaInstagramPhoto");

test("public profile photo is read from the HTML head when the full Instagram page exceeds 2 MB", async (t) => {
  const originalFetch = global.fetch;
  const previousLookup = process.env.LOCOMOTIVA_INSTAGRAM_PUBLIC_LOOKUP;
  const previousAccount = process.env.LOCOMOTIVA_INSTAGRAM_ACCOUNT_ID;
  const previousVersion = process.env.LOCOMOTIVA_INSTAGRAM_GRAPH_VERSION;
  const previousToken = process.env.LOCOMOTIVA_INSTAGRAM_TOKEN;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [
      ["LOCOMOTIVA_INSTAGRAM_PUBLIC_LOOKUP", previousLookup],
      ["LOCOMOTIVA_INSTAGRAM_ACCOUNT_ID", previousAccount],
      ["LOCOMOTIVA_INSTAGRAM_GRAPH_VERSION", previousVersion],
      ["LOCOMOTIVA_INSTAGRAM_TOKEN", previousToken],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.LOCOMOTIVA_INSTAGRAM_PUBLIC_LOOKUP = "true";
  delete process.env.LOCOMOTIVA_INSTAGRAM_ACCOUNT_ID;
  delete process.env.LOCOMOTIVA_INSTAGRAM_GRAPH_VERSION;
  delete process.env.LOCOMOTIVA_INSTAGRAM_TOKEN;
  const profileHead = '<html><head><meta property="og:type" content="profile"><meta property="og:url" content="https://www.instagram.com/examplecreator/"><meta property="og:image" content="https://scontent.cdninstagram.com/profile.png"></head>';
  const profilePage = profileHead + "x".repeat(2 * 1024 * 1024);
  global.fetch = async (input) => {
    if (String(input).includes("instagram.com/examplecreator/")) {
      return new Response(profilePage, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(Buffer.byteLength(profilePage)),
        },
      });
    }
    return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
      headers: { "content-type": "image/png" },
    });
  };

  const result = await instagramPhoto.lookupPhoto("examplecreator");
  assert.equal(result.source, "INSTAGRAM_PUBLIC_PROFILE");
  assert.match(result.photo, /^data:image\/png;base64,/);
});
