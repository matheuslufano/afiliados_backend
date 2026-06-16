const {
  publicAppBaseUrl
} = require('../utils/publicUrls');
const {
  DEFAULT_WHATSAPP_MESSAGE,
  buildWhatsAppUrl
} = require('../utils/whatsapp');

function jsString(value) {
  return JSON.stringify(String(value || ''));
}

class WordPressController {
  landingScript(req, res) {
    const apiBaseUrl = publicAppBaseUrl(req);
    const fallbackWhatsApp = buildWhatsAppUrl(
      process.env.WHATSAPP_MESSAGE || DEFAULT_WHATSAPP_MESSAGE
    );

    res.type('application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(`(function () {
  var script = document.currentScript;
  var API_BASE_URL = ${jsString(apiBaseUrl)};
  var DEFAULT_SELECTOR = ".whatsapp-conversion, #netbox-whatsapp-button, .netbox-whatsapp-button, [data-netbox-whatsapp]";
  var STORAGE_KEY = "netboxReferralCode";
  var PRODUCT = (script && script.dataset.product) || "Plano Familia Netbox";
  var BUTTON_SELECTOR = (script && script.dataset.buttonSelector) || DEFAULT_SELECTOR;
  var FALLBACK_WHATSAPP = (script && script.dataset.fallbackWhatsapp) || ${jsString(fallbackWhatsApp)};
  var MESSAGE = script && script.dataset.message;

  function toArray(list) {
    return Array.prototype.slice.call(list || []);
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return "";
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Browsers can block storage in private or restricted contexts.
    }
  }

  function getReferralCode() {
    var params = new URLSearchParams(window.location.search);
    var ref = (
      params.get("ref") ||
      params.get("shortCode") ||
      params.get("link") ||
      ""
    ).trim();

    if (ref) {
      storageSet(STORAGE_KEY, ref);
      return ref;
    }

    return (storageGet(STORAGE_KEY) || "").trim();
  }

  function buildButtonHref() {
    var ref = getReferralCode();

    if (!ref) {
      return FALLBACK_WHATSAPP;
    }

    var conversionUrl = new URL(
      "/links/" + encodeURIComponent(ref) + "/whatsapp",
      API_BASE_URL
    );
    conversionUrl.searchParams.set("product", PRODUCT);

    if (MESSAGE) {
      conversionUrl.searchParams.set("message", MESSAGE);
    }

    return conversionUrl.toString();
  }

  function updateButton(button, href) {
    if (!button || button.dataset.netboxNoTrack === "true") {
      return;
    }

    button.dataset.netboxWhatsappHref = href;

    if (button.tagName && button.tagName.toLowerCase() === "a") {
      button.setAttribute("href", href);
    }
  }

  function getButtons() {
    try {
      return toArray(document.querySelectorAll(BUTTON_SELECTOR));
    } catch (error) {
      return [];
    }
  }

  function findButton(target) {
    if (!target || typeof target.closest !== "function") {
      return null;
    }

    try {
      return target.closest(BUTTON_SELECTOR);
    } catch (error) {
      return null;
    }
  }

  function updateButtons() {
    var href = buildButtonHref();

    getButtons().forEach(function (button) {
      updateButton(button, href);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateButtons);
  } else {
    updateButtons();
  }

  document.addEventListener("click", function (event) {
    var button = findButton(event.target);

    if (!button || button.dataset.netboxNoTrack === "true") {
      return;
    }

    var href = buildButtonHref();
    updateButton(button, href);

    if (!(button.tagName && button.tagName.toLowerCase() === "a")) {
      event.preventDefault();
      window.location.href = href;
    }
  });
})();`);
  }
}

module.exports = new WordPressController();
