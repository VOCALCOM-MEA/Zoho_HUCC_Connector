/**
 * Minimal bootstrap loaded inside the Vocalcom iframe via jsFiles URL param.
 * Applies credentials, installs CIF stub, and accepts full bridge injection from parent.
 */
(function () {
  "use strict";

  if (window.__zohoHuccBootstrapDone) {
    return;
  }
  window.__zohoHuccBootstrapDone = true;

  var SOURCE = "vocalcom_hucc";
  var PARENT = "zoho_hucc";
  var bridgeInjected = false;

  function param(name) {
    var url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)");
    var results = regex.exec(url);
    if (!results) {
      return null;
    }
    if (!results[2]) {
      return "";
    }
    return decodeURIComponent(results[2].replace(/\+/g, " "));
  }

  function applySettings() {
    var voc = window.Vocalcom && window.Vocalcom.UCCore;
    if (!voc || typeof voc.setHUCCSettings !== "function") {
      return false;
    }
    voc.setHUCCSettings({
      proxyConfig: param("proxyConfig"),
      configCode: param("configCode"),
      customerId: param("CustomerID"),
      login: param("userId"),
      password: param("Password"),
      jsFiles: param("jsFiles"),
      agentStation: param("agentStation") || "",
      userIdentity: "",
    });
    return true;
  }

  if (!applySettings()) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (applySettings() || attempts > 120) {
        clearInterval(timer);
      }
    }, 50);
  }

  function parseODataPhone(query) {
    if (!query) {
      return "";
    }
    var decoded = decodeURIComponent(String(query));
    var match = decoded.match(/(?:telephone1|mobilephone|phone|mobile)\s+eq\s+'([^']+)'/i);
    if (match) {
      return match[1];
    }
    match = decoded.match(/contains\([^,]+,\s*'([^']+)'\)/i);
    return match ? match[1] : "";
  }

  window.Microsoft = window.Microsoft || {};
  window.Microsoft.CIFramework = {
    searchAndOpenRecords: function (entity, query) {
      var phone = parseODataPhone(query);
      window.parent.postMessage({
        source: SOURCE,
        type: "screen_pop",
        phone: phone,
        identifier: phone,
        channel: "call",
        direction: "inbound",
        interaction_type: "searchAndOpenRecords",
      }, "*");
      return Promise.resolve([]);
    },
    openForm: function () { return Promise.resolve(); },
    setMode: function () { return Promise.resolve(); },
    setWidth: function () { return Promise.resolve(); },
    setClickToAct: function () { return Promise.resolve(true); },
    getClickToAct: function () { return Promise.resolve(true); },
    getEnvironment: function () {
      return Promise.resolve({ appid: "zoho", pageType: "entityrecord", crmVersion: "zoho" });
    },
    notifyEvent: function (eventName, data) {
      window.parent.postMessage({
        source: SOURCE,
        type: "cif_event",
        event: eventName,
        data: data || {},
      }, "*");
      return Promise.resolve();
    },
    addHandler: function () { return Promise.resolve(); },
    removeHandler: function () { return Promise.resolve(); },
  };

  try {
    window.dispatchEvent(new Event("CIFInitDone"));
  } catch (e) {
    /* ignore */
  }

  function injectBridge(code) {
    if (bridgeInjected || !code) {
      return;
    }
    bridgeInjected = true;
    var script = document.createElement("script");
    script.type = "text/javascript";
    script.text = code;
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.source !== PARENT || data.type !== "inject_bridge") {
      return;
    }
    try {
      injectBridge(data.code);
    } catch (e) {
      window.parent.postMessage({
        source: SOURCE,
        type: "bridge_inject_failed",
        reason: String(e),
      }, "*");
    }
  });

  try {
    window.parent.postMessage({ source: SOURCE, type: "bridge_bootstrap_ready" }, "*");
  } catch (e) {
    /* ignore */
  }
})();
