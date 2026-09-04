/**
 * Vocalcom HUCC bridge — runs inside the Vocalcom iframe.
 * Injected once by the Zoho widget parent (no auto-reload / recoverSessionOnce).
 */
(function () {
  "use strict";

  if (window.__zohoHuccBridgeDone) {
    return;
  }
  window.__zohoHuccBridgeDone = true;

  var SOURCE = "vocalcom_hucc";
  var PARENT = "zoho_hucc";
  var lastPopKey = "";
  var lastPopAt = 0;
  var lastContextKey = "";
  var lastDomPhone = "";

  function log() {
    if (typeof console !== "undefined" && console.debug) {
      console.debug.apply(console, ["[Zoho HUCC bridge]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

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

  function postToParent(payload) {
    try {
      window.parent.postMessage(Object.assign({ source: SOURCE }, payload), "*");
    } catch (e) {
      log("postMessage failed", e);
    }
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
    var credAttempts = 0;
    var credTimer = setInterval(function () {
      credAttempts += 1;
      if (applySettings() || credAttempts > 120) {
        clearInterval(credTimer);
      }
    }, 50);
  }

  function walkPhone(value, depth) {
    if (value == null || depth > 6) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number") {
      var text = String(value).trim();
      var match = text.match(/\+?\d[\d\s\-().]{6,}\d/);
      return match ? match[0].replace(/[\s\-().]/g, "") : "";
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        var found = walkPhone(value[i], depth + 1);
        if (found) {
          return found;
        }
      }
      return "";
    }
    if (typeof value === "object") {
      var keys = [
        "phone", "Phone", "caller", "Caller", "ani", "ANI", "dnis", "DNIS",
        "mobile", "Mobile", "telephone", "Telephone", "number", "Number",
        "from", "From", "to", "To", "contactNumber", "customerPhone"
      ];
      for (var k = 0; k < keys.length; k += 1) {
        if (value[keys[k]]) {
          var phone = walkPhone(value[keys[k]], depth + 1);
          if (phone) {
            return phone;
          }
        }
      }
      var nested = ["data", "payload", "interaction", "call", "context", "event"];
      for (var n = 0; n < nested.length; n += 1) {
        if (value[nested[n]]) {
          phone = walkPhone(value[nested[n]], depth + 1);
          if (phone) {
            return phone;
          }
        }
      }
    }
    return "";
  }

  function walkIdentifier(raw) {
    return walkPhone(raw, 0) || walkPhone(raw && raw.phone, 0);
  }

  function inferDirection(raw, eventName, extra) {
    if (extra && extra.direction) {
      return extra.direction;
    }
    var blob = JSON.stringify(raw || {}) + " " + String(eventName || "");
    if (/outbound|outgoing|manual|preview/i.test(blob)) {
      return "outbound";
    }
    return "inbound";
  }

  function inferState(raw, eventName, extra) {
    if (extra && extra.state) {
      return extra.state;
    }
    var blob = JSON.stringify(raw || {}) + " " + String(eventName || "");
    if (/ring|offer/i.test(blob)) {
      return "ringing";
    }
    if (/connect|answer/i.test(blob)) {
      return "answered";
    }
    return "";
  }

  function inferChannel(raw, eventName, extra) {
    if (extra && extra.channel) {
      return extra.channel;
    }
    var blob = JSON.stringify(raw || {}) + " " + String(eventName || "");
    if (/chat|message/i.test(blob)) {
      return "chat";
    }
    if (/email|mail/i.test(blob)) {
      return "email";
    }
    if (/social/i.test(blob)) {
      return "social";
    }
    return "call";
  }

  function extractCallId(value) {
    if (!value || typeof value !== "object") {
      return "";
    }
    return String(
      value.callId || value.callID || value.interactionId || value.sessionId ||
      value.vocalcomCallId || value.id || ""
    );
  }

  function buildExtra(raw, eventName, extra) {
    extra = extra || {};
    var identifier = extra.phone || extra.identifier || walkIdentifier(raw);
    return {
      phone: identifier,
      identifier: identifier,
      call_id: extra.call_id || extractCallId(raw),
      direction: inferDirection(raw, eventName, extra),
      state: inferState(raw, eventName, extra),
      channel: inferChannel(raw, eventName, extra),
      interaction_type: extra.interaction_type || eventName || "",
    };
  }

  function screenPop(raw, extra, eventName) {
    var meta = buildExtra(raw, eventName, extra);
    if (!meta.phone) {
      return;
    }
    var now = Date.now();
    var key = meta.phone + "|" + meta.call_id + "|" + meta.channel + "|" + meta.direction;
    if (key === lastPopKey && now - lastPopAt < 2500) {
      return;
    }
    lastPopKey = key;
    lastPopAt = now;
    log("screen_pop", meta.phone, eventName || meta.interaction_type);
    postToParent(Object.assign({ type: "screen_pop" }, meta));
  }

  function makeHandler(eventName, defaults) {
    return function (payload) {
      screenPop(payload, defaults || {}, eventName);
    };
  }

  function bindTarget(target, eventName, handler) {
    if (!target) {
      return;
    }
    ["on", "addEventListener", "subscribe"].forEach(function (method) {
      if (typeof target[method] !== "function") {
        return;
      }
      try {
        target[method](eventName, handler);
      } catch (e) {
        /* unsupported event */
      }
    });
  }

  function bindCallback(target, methodName, handler) {
    if (!target || typeof target[methodName] !== "function") {
      return;
    }
    try {
      target[methodName](handler);
    } catch (e) {
      /* ignore */
    }
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

  function installCIF() {
    window.Microsoft = window.Microsoft || {};
    window.Microsoft.CIFramework = {
      searchAndOpenRecords: function (entity, query) {
        var phone = parseODataPhone(query);
        screenPop({ query: query, entity: entity }, { phone: phone, direction: "inbound", channel: "call" }, "searchAndOpenRecords");
        postToParent({ type: "cif_search", entity: entity, query: query });
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
        screenPop(data || {}, {}, eventName);
        postToParent({ type: "cif_event", event: eventName, data: data || {} });
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
  }

  installCIF();

  function bindEvents() {
    var voc = window.Vocalcom && window.Vocalcom.UCCore;
    if (!voc) {
      return;
    }
    var eventNames = [
      "incomingCall", "IncomingCall", "onIncomingCall", "callOffered", "CallOffered",
      "outgoingCall", "OutgoingCall", "onOutgoingCall", "manualCall", "ManualCall",
      "callStarted", "CallStarted", "callConnected", "CallConnected", "callAnswered",
      "interactionStarted", "InteractionStarted", "newInteraction", "NewInteraction",
      "chatStarted", "ChatStarted", "messageReceived", "emailReceived", "EmailReceived",
      "onSocialMessage", "omnichannelInteraction", "mediaConnected", "MediaConnected",
    ];
    eventNames.forEach(function (name) {
      bindTarget(voc, name, makeHandler(name));
    });
    if (voc.Telephony) {
      ["onIncomingCall", "onCallOffered", "onOutgoingCall", "onManualCall", "onCallConnected"].forEach(function (methodName) {
        bindCallback(voc.Telephony, methodName, makeHandler(methodName));
      });
    }
    postToParent({ type: "bridge_ready" });
  }

  function pollContext() {
    var voc = window.Vocalcom && window.Vocalcom.UCCore;
    if (!voc) {
      return;
    }
    var candidates = [];
    if (typeof voc.getGlobalContext === "function") {
      try {
        var ctx = voc.getGlobalContext();
        if (ctx) {
          candidates.push(ctx);
        }
      } catch (e) {
        /* ignore */
      }
    }
    if (voc.Telephony) {
      ["getActiveCall", "getCurrentCall", "getCurrentInteraction"].forEach(function (method) {
        if (typeof voc.Telephony[method] !== "function") {
          return;
        }
        try {
          var value = voc.Telephony[method]();
          if (value) {
            candidates.push(value);
          }
        } catch (e2) {
          /* ignore */
        }
      });
    }
    candidates.forEach(function (raw) {
      var identifier = walkIdentifier(raw);
      if (!identifier) {
        return;
      }
      var contextKey = identifier + "|" + extractCallId(raw);
      if (contextKey === lastContextKey) {
        return;
      }
      lastContextKey = contextKey;
      screenPop(raw, {}, "telephony_poll");
    });
  }

  function scanDomForPhone() {
    var selectors = ["[class*='call-banner']", "[class*='caller']", "[data-phone]", "[data-caller]"];
    var nodes = [];
    selectors.forEach(function (selector) {
      try {
        document.querySelectorAll(selector).forEach(function (node) {
          nodes.push(node);
        });
      } catch (e) {
        /* ignore */
      }
    });
    nodes.forEach(function (node) {
      var phone = walkPhone(node.getAttribute("data-phone") || node.getAttribute("data-caller") || node.textContent, 0);
      if (!phone || phone === lastDomPhone) {
        return;
      }
      lastDomPhone = phone;
      screenPop({ phone: phone }, { phone: phone, channel: "call" }, "dom_banner");
    });
  }

  function placeCall(phone, campaignId) {
    var voc = window.Vocalcom && window.Vocalcom.UCCore;
    if (!voc || !voc.Telephony || typeof voc.Telephony.manualCall !== "function") {
      postToParent({ type: "dial_failed", phone: phone, reason: "UCCore.Telephony.manualCall is not available yet" });
      return;
    }
    try {
      if (campaignId && typeof voc.Telephony.selectManualCampaign === "function") {
        voc.Telephony.selectManualCampaign(campaignId);
      }
      voc.Telephony.manualCall(phone);
      screenPop({ phone: phone }, { phone: phone, direction: "outbound", channel: "call", state: "ringing" }, "manualCall");
      postToParent({ type: "dial_started", phone: phone, campaign_id: campaignId, direction: "outbound", channel: "call" });
    } catch (e) {
      postToParent({ type: "dial_failed", phone: phone, reason: String(e) });
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.source !== PARENT) {
      return;
    }
    if (data.type === "dial" && data.phone) {
      placeCall(data.phone, data.campaignId);
    }
    if (data.type === "ping") {
      postToParent({ type: "pong" });
    }
  });

  function initBridge() {
    bindEvents();
    setInterval(pollContext, 1200);
    setInterval(scanDomForPhone, 2000);
  }

  var bindAttempts = 0;
  var bindTimer = setInterval(function () {
    bindAttempts += 1;
    if ((window.Vocalcom && window.Vocalcom.UCCore) || bindAttempts > 120) {
      clearInterval(bindTimer);
      initBridge();
    }
  }, 50);
})();
