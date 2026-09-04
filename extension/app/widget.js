/* global ZOHO */
(function () {
  "use strict";

  var PARENT_SOURCE = "zoho_hucc";
  var BRIDGE_SOURCE = "vocalcom_hucc";
  var DEFAULTS = null;
  var orgConfig = {};
  var zohoUser = { id: "", email: "", name: "" };
  var userCreds = { login: "", password: "", station: "" };
  var bridgeCode = "";
  var bridgeInjected = false;
  var iframeLoaded = false;

  var els = {
    status: null,
    error: null,
    station: null,
    login: null,
    iframe: null,
    saveStation: null,
    reload: null,
  };

  function setStatus(text) {
    if (els.status) {
      els.status.textContent = text;
    }
  }

  function setError(text) {
    if (!els.error) {
      return;
    }
    if (text) {
      els.error.hidden = false;
      els.error.textContent = text;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }
  }

  function storageKey() {
    return "vocalcom_hucc_user_" + (zohoUser.id || "anonymous");
  }

  function loadUserCreds() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function saveUserCreds() {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        login: userCreds.login,
        password: userCreds.password,
        station: userCreds.station,
      })
    );
  }

  function normalizePhone(value) {
    return String(value || "").replace(/[^\d+]/g, "");
  }

  function fetchDefaults() {
    return fetch("../config/settings.json")
      .then(function (res) {
        return res.ok ? res.json() : {};
      })
      .catch(function () {
        return {};
      });
  }

  function fetchBridgeCode() {
    return fetch("bridge.js")
      .then(function (res) {
        if (!res.ok) {
          throw new Error("Could not load bridge.js");
        }
        return res.text();
      });
  }

  function readOrgConfigFromZoho() {
    if (!ZOHO || !ZOHO.CRM || !ZOHO.CRM.CONFIG) {
      return Promise.resolve({});
    }
    return ZOHO.CRM.CONFIG.getOrgInfo()
      .then(function () {
        return ZOHO.CRM.CONFIG.get("hucc_front_url")
          .then(function (v) { orgConfig.frontUrl = v; })
          .catch(function () { /* optional */ })
          .then(function () {
            return ZOHO.CRM.CONFIG.get("hucc_loader_url");
          })
          .then(function (v) { orgConfig.loaderUrl = v; })
          .catch(function () { /* optional */ })
          .then(function () {
            return ZOHO.CRM.CONFIG.get("hucc_proxy_config");
          })
          .then(function (v) { orgConfig.proxyConfig = v; })
          .catch(function () { /* optional */ })
          .then(function () {
            return ZOHO.CRM.CONFIG.get("hucc_config_code");
          })
          .then(function (v) { orgConfig.configCode = v; })
          .catch(function () { /* optional */ })
          .then(function () {
            return ZOHO.CRM.CONFIG.get("hucc_customer_id");
          })
          .then(function (v) { orgConfig.customerId = v; })
          .catch(function () { /* optional */ });
      })
      .catch(function () {
        return null;
      });
  }

  function resolveOrgConfig() {
    orgConfig = {
      frontUrl: orgConfig.frontUrl || DEFAULTS.frontUrl,
      loaderUrl: orgConfig.loaderUrl || DEFAULTS.loaderUrl,
      proxyConfig: orgConfig.proxyConfig || DEFAULTS.proxyConfig,
      configCode: orgConfig.configCode || DEFAULTS.configCode,
      customerId: orgConfig.customerId || DEFAULTS.customerId,
    };
  }

  function resolveUserCreds() {
    var stored = loadUserCreds();
    var demo = (DEFAULTS && DEFAULTS.demoCredentials) || {};
    userCreds.login = (stored && stored.login) || demo.login || "";
    userCreds.password = (stored && stored.password) || demo.password || "";
    userCreds.station = (stored && stored.station) || demo.station || DEFAULTS.defaultStation || "";
  }

  function bootstrapJsUrl() {
    return new URL("bridge-bootstrap.js", window.location.href).href;
  }

  function buildIframeUrl() {
    var station = els.station ? els.station.value.trim() : userCreds.station;
    var params = {
      HUCCLoader: orgConfig.loaderUrl,
      CustomerID: orgConfig.customerId,
      proxyConfig: orgConfig.proxyConfig,
      configCode: orgConfig.configCode,
      userId: userCreds.login,
      Password: userCreds.password,
      agentStation: station,
      jsFiles: bootstrapJsUrl(),
    };
    var query = Object.keys(params)
      .map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key] || "");
      })
      .join("&");
    return orgConfig.frontUrl + "?" + query;
  }

  function injectBridge() {
    if (!iframeLoaded || !bridgeCode || bridgeInjected || !els.iframe || !els.iframe.contentWindow) {
      return;
    }
    bridgeInjected = true;
    els.iframe.contentWindow.postMessage(
      { source: PARENT_SOURCE, type: "inject_bridge", code: bridgeCode },
      "*"
    );
    setStatus("Bridge injected — confirm station and click Log in");
  }

  function loadIframe() {
    if (!els.iframe) {
      return;
    }
    bridgeInjected = false;
    iframeLoaded = false;
    var url = buildIframeUrl();
    setStatus("Loading Vocalcom panel…");
    els.iframe.src = url;
  }

  function openRecord(entity, recordId) {
    return ZOHO.CRM.UI.Record.open({
      Entity: entity,
      RecordID: recordId,
    });
  }

  function searchModule(entity, phone) {
    return ZOHO.CRM.API.searchRecord({
      Entity: entity,
      Type: "phone",
      Query: phone,
    }).then(function (response) {
      var rows = (response && response.data) || [];
      return rows.map(function (row) {
        return { id: row.id, module: entity, name: row.Full_Name || row.Last_Name || row.Company || row.id };
      });
    }).catch(function () {
      return [];
    });
  }

  function screenPopInZoho(phone, meta) {
    var normalized = normalizePhone(phone);
    if (!normalized) {
      return;
    }
    setStatus("Screen-pop: " + normalized);
    Promise.all([
      searchModule("Contacts", normalized),
      searchModule("Leads", normalized),
    ]).then(function (results) {
      var matches = results[0].concat(results[1]);
      if (!matches.length) {
        setStatus("No CRM match for " + normalized);
        return;
      }
      if (matches.length === 1) {
        return openRecord(matches[0].module, matches[0].id).then(function () {
          setStatus("Opened " + matches[0].module + ": " + (matches[0].name || matches[0].id));
        });
      }
      setStatus(matches.length + " matches for " + normalized + " — opening first");
      return openRecord(matches[0].module, matches[0].id);
    }).catch(function (err) {
      setError("Screen-pop failed: " + String(err));
    });
  }

  function dialPhone(phone) {
    var normalized = normalizePhone(phone);
    if (!normalized || !els.iframe || !els.iframe.contentWindow) {
      return;
    }
    els.iframe.contentWindow.postMessage(
      { source: PARENT_SOURCE, type: "dial", phone: normalized },
      "*"
    );
    setStatus("Dialing " + normalized + "…");
  }

  function onBridgeMessage(event) {
    var data = event.data || {};
    if (data.source !== BRIDGE_SOURCE) {
      return;
    }
    if (data.type === "bridge_bootstrap_ready") {
      injectBridge();
      return;
    }
    if (data.type === "bridge_ready") {
      setStatus("HUCC ready — confirm station and click Log in");
      return;
    }
    if (data.type === "screen_pop" && data.phone) {
      screenPopInZoho(data.phone, data);
      return;
    }
    if (data.type === "dial_started" && data.phone) {
      setStatus("Outbound call started: " + data.phone);
      return;
    }
    if (data.type === "dial_failed") {
      setError("Dial failed: " + (data.reason || "unknown"));
    }
  }

  function bindClickToCall() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target) {
        return;
      }
      var anchor = target.closest ? target.closest("a[href^='tel:']") : null;
      if (anchor) {
        event.preventDefault();
        dialPhone(anchor.getAttribute("href").replace(/^tel:/i, ""));
      }
    });
  }

  function bindUi() {
    els.saveStation.addEventListener("click", function () {
      userCreds.station = els.station.value.trim();
      saveUserCreds();
      setStatus("Station saved — reload phone to apply");
      setError("");
    });
    els.reload.addEventListener("click", function () {
      userCreds.station = els.station.value.trim();
      saveUserCreds();
      setError("");
      loadIframe();
    });
    els.iframe.addEventListener("load", function () {
      iframeLoaded = true;
      injectBridge();
    });
  }

  function initDom() {
    els.status = document.getElementById("vhucc-status");
    els.error = document.getElementById("vhucc-error");
    els.station = document.getElementById("vhucc-station");
    els.login = document.getElementById("vhucc-login");
    els.iframe = document.getElementById("vhucc-iframe");
    els.saveStation = document.getElementById("vhucc-save-station");
    els.reload = document.getElementById("vhucc-reload");
  }

  function renderUserFields() {
    els.station.value = userCreds.station || "";
    els.login.value = userCreds.login || "";
  }

  function boot() {
    initDom();
    bindUi();
    bindClickToCall();
    window.addEventListener("message", onBridgeMessage);

    Promise.all([fetchDefaults(), fetchBridgeCode()])
      .then(function (parts) {
        DEFAULTS = parts[0];
        bridgeCode = parts[1];
        return readOrgConfigFromZoho();
      })
      .then(function () {
        resolveOrgConfig();
        resolveUserCreds();
        renderUserFields();
        if (!userCreds.login || !userCreds.password) {
          setError("Missing HUCC credentials. Set hucc_login / hucc_password in localStorage or use demo defaults.");
        }
        setStatus("Confirm station " + (userCreds.station || "?") + " and click Log in inside Vocalcom.");
        loadIframe();
      })
      .catch(function (err) {
        setError(String(err));
        setStatus("Initialization failed");
      });
  }

  if (typeof ZOHO !== "undefined" && ZOHO.embeddedApp) {
    ZOHO.embeddedApp.on("PageLoad", function (data) {
      zohoUser.id = (data && data.User && data.User.ID) || "";
      zohoUser.email = (data && data.User && data.User.Email) || "";
      zohoUser.name = (data && data.User && data.User.Name) || "";
      boot();
    });
    ZOHO.embeddedApp.init();
  } else {
    boot();
  }
})();
