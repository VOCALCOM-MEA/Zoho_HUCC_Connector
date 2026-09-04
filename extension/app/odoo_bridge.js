// Vocalcom HUCC Odoo bridge — loaded via jsFiles in ProxyHermesFront iframe.
(function watchCtiPopups() {
    var nativeOpen = window.open;
    if (typeof nativeOpen !== "function") {
        return;
    }
    var ctiPopupCount = 0;
    window.open = function (url, target, features) {
        var blob = String(url || "") + " " + String(target || "") + " " + String(features || "");
        if (/softphone|connection.?status|hermes|vocalcom|cti|webrtc/i.test(blob)) {
            ctiPopupCount += 1;
            if (ctiPopupCount > 1) {
                console.warn("[Odoo HUCC] Multiple CTI popups detected — keep one widget iframe only", url);
            }
        }
        return nativeOpen.apply(window, arguments);
    };
})();

(function () {
    "use strict";

    if (window.__odooHuccBridgeDone) {
        return;
    }
    window.__odooHuccBridgeDone = true;

    var SOURCE = "vocalcom_hucc";
    var DEBUG = true;
    var lastPopKey = "";
    var lastPopAt = 0;
    var lastContextKey = "";
    var lastDomPhone = "";

    function log() {
        if (!DEBUG) {
            return;
        }
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift("[HUCC Odoo]");
            console.log.apply(console, args);
        } catch (e) {
            /* ignore */
        }
    }

    function param(name, url) {
        url = url || window.location.href;
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

    function postToOdoo(payload) {
        payload = payload || {};
        payload.source = SOURCE;
        try {
            window.parent.postMessage(payload, "*");
        } catch (e) {
            console.warn("[HUCC Odoo] postMessage failed", e);
        }
    }

    function walkPhone(value, depth) {
        if (!value || depth > 5) {
            return "";
        }
        if (typeof value === "string" || typeof value === "number") {
            var text = String(value);
            if (/[\d+]{6,}/.test(text.replace(/\s/g, "")) && text.length < 40) {
                return text;
            }
            return "";
        }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                var found = walkPhone(value[i], depth + 1);
                if (found) {
                    return found;
                }
            }
            return "";
        }
        if (typeof value === "object") {
            var keys = [
                "phone", "phoneNumber", "PhoneNumber", "callerNumber", "callingNumber",
                "calledNumber", "ani", "ANI", "cli", "CLI", "mediaAddress", "from",
                "number", "telephone1", "mobilephone", "customerPhone", "remoteUri",
                "remoteNumber", "originator", "caller"
            ];
            for (var k = 0; k < keys.length; k++) {
                if (value[keys[k]]) {
                    var hit = walkPhone(value[keys[k]], depth + 1);
                    if (hit) {
                        return hit;
                    }
                }
            }
            for (var key in value) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) {
                    continue;
                }
                if (/phone|ani|cli|caller|number|uri/i.test(key)) {
                    var nested = walkPhone(value[key], depth + 1);
                    if (nested) {
                        return nested;
                    }
                }
            }
        }
        return "";
    }

    function walkEmail(value, depth) {
        if (!value || depth > 5) {
            return "";
        }
        if (typeof value === "string") {
            var text = value.trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length < 120) {
                return text;
            }
            return "";
        }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                var found = walkEmail(value[i], depth + 1);
                if (found) {
                    return found;
                }
            }
            return "";
        }
        if (typeof value === "object") {
            var keys = [
                "email", "Email", "mail", "fromAddress", "senderEmail",
                "customerEmail", "contactEmail", "address", "handle", "userId"
            ];
            for (var k = 0; k < keys.length; k++) {
                if (value[keys[k]]) {
                    var hit = walkEmail(value[keys[k]], depth + 1);
                    if (hit) {
                        return hit;
                    }
                }
            }
            for (var key in value) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) {
                    continue;
                }
                if (/email|mail|handle|sender|from/i.test(key)) {
                    var nested = walkEmail(value[key], depth + 1);
                    if (nested) {
                        return nested;
                    }
                }
            }
        }
        return "";
    }

    function walkIdentifier(raw) {
        return walkPhone(raw, 0) || walkEmail(raw, 0);
    }

    function inferDirection(raw, eventName, extra) {
        extra = extra || {};
        if (extra.direction) {
            return extra.direction;
        }
        var blob = String(eventName || "") + " " + JSON.stringify(raw || {}).toLowerCase();
        if (/outbound|outgoing|manual|preview|dial/i.test(blob)) {
            return "outbound";
        }
        if (/inbound|incoming|ring|offer/i.test(blob)) {
            return "inbound";
        }
        if (raw && typeof raw === "object") {
            var dir = raw.direction || raw.Direction || raw.callDirection || raw.CallDirection;
            if (dir) {
                return String(dir).toLowerCase().indexOf("out") >= 0 ? "outbound" : "inbound";
            }
        }
        return "unknown";
    }

    function inferState(raw, eventName, extra) {
        extra = extra || {};
        if (extra.state) {
            return extra.state;
        }
        var blob = String(eventName || "") + " " + JSON.stringify(raw || {}).toLowerCase();
        if (/connect|answer|active|ready|started/i.test(blob)) {
            return "answered";
        }
        if (/ring|offer|invite|alert/i.test(blob)) {
            return "ringing";
        }
        if (raw && typeof raw === "object") {
            var state = raw.state || raw.State || raw.callState || raw.status;
            if (state) {
                return String(state).toLowerCase();
            }
        }
        return "ringing";
    }

    function inferChannel(raw, eventName) {
        var blob = String(eventName || "") + " " + JSON.stringify(raw || {}).toLowerCase();
        if (/chat|message(?!.*email)|messaging|whatsapp|messenger/i.test(blob)) {
            return "chat";
        }
        if (/email|mail/i.test(blob)) {
            return "email";
        }
        if (/social|facebook|twitter|instagram|telegram/i.test(blob)) {
            return "social";
        }
        if (/sms|text/i.test(blob)) {
            return "sms";
        }
        if (raw && typeof raw === "object") {
            var channel = raw.channel || raw.Channel || raw.mediaType || raw.interactionType;
            if (channel) {
                var text = String(channel).toLowerCase();
                if (/chat|message/.test(text)) {
                    return "chat";
                }
                if (/email|mail/.test(text)) {
                    return "email";
                }
                if (/social/.test(text)) {
                    return "social";
                }
                if (/sms/.test(text)) {
                    return "sms";
                }
            }
        }
        return "call";
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
            channel: extra.channel || inferChannel(raw, eventName),
            interaction_type: extra.interaction_type || eventName || "",
            campaign_id: extra.campaign_id,
            campaign_name: extra.campaign_name,
            raw: raw
        };
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

    function extractDuration(value) {
        if (!value || typeof value !== "object") {
            return null;
        }
        var raw = value.duration || value.Duration || value.callDuration ||
            value.talkTime || value.TalkTime || value.connectedDuration;
        if (raw == null || raw === "") {
            return null;
        }
        var parsed = parseInt(raw, 10);
        return isNaN(parsed) ? null : parsed;
    }

    function tryAutoLogin() {
        if (param("_odooAutoLogin") !== "1" || window.__odooHuccAutoLoginDone) {
            return !!window.__odooHuccAutoLoginDone;
        }
        var voc = window.Vocalcom && window.Vocalcom.UCCore;
        if (!voc) {
            return false;
        }
        try {
            if (typeof voc.loginAgent === "function") {
                voc.loginAgent();
                window.__odooHuccAutoLoginDone = true;
                log("auto loginAgent invoked");
                postToOdoo({ type: "agent_logged_in" });
                return true;
            }
            if (voc.Agent && typeof voc.Agent.login === "function") {
                voc.Agent.login();
                window.__odooHuccAutoLoginDone = true;
                log("Agent.login invoked");
                postToOdoo({ type: "agent_logged_in" });
                return true;
            }
            var station = param("agentStation") || "";
            if (
                station &&
                voc.Telephony &&
                typeof voc.Telephony.connectAgentStation === "function"
            ) {
                voc.Telephony.connectAgentStation(station);
                window.__odooHuccAutoLoginDone = true;
                log("connectAgentStation invoked", station);
                postToOdoo({ type: "agent_logged_in", station: station });
                return true;
            }
        } catch (e) {
            log("auto-login failed", e);
        }
        return false;
    }

    function scheduleAutoLogin() {
        if (param("_odooAutoLogin") !== "1") {
            return;
        }
        var attempts = 0;
        var timer = setInterval(function () {
            attempts += 1;
            if (tryAutoLogin() || attempts > 120) {
                clearInterval(timer);
            }
        }, 100);
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
        postToOdoo(Object.assign({ type: "screen_pop" }, meta));
    }

    function makeHandler(eventName, defaults) {
        return function (payload) {
            screenPop(payload, defaults || {}, eventName);
        };
    }

    function makeCallEndHandler(eventName) {
        return function (payload) {
            var meta = buildExtra(payload, eventName, { state: "done" });
            log("call_completed", meta.phone, eventName);
            postToOdoo(Object.assign({
                type: "call_completed",
                end: true,
                duration: extractDuration(payload),
            }, meta));
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
                /* ignore unsupported event names */
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
        var handlers = {};
        window.Microsoft.CIFramework = {
            searchAndOpenRecords: function (entity, query, searchOnly) {
                var phone = parseODataPhone(query);
                log("CIF.searchAndOpenRecords", entity, phone, query);
                screenPop({ query: query, entity: entity }, { phone: phone, direction: "inbound", channel: "call" }, "searchAndOpenRecords");
                postToOdoo({ type: "cif_search", entity: entity, query: query, searchOnly: !!searchOnly });
                return Promise.resolve([]);
            },
            openForm: function (options) {
                postToOdoo({ type: "cif_open_form", options: options || {} });
                return Promise.resolve();
            },
            setMode: function (mode) {
                postToOdoo({ type: "cif_set_mode", mode: mode });
                return Promise.resolve();
            },
            setWidth: function (width) {
                postToOdoo({ type: "cif_set_width", width: width });
                return Promise.resolve();
            },
            setClickToAct: function () {
                return Promise.resolve(true);
            },
            getClickToAct: function () {
                return Promise.resolve(true);
            },
            getEnvironment: function () {
                return Promise.resolve({
                    appid: "odoo",
                    pageType: "entityrecord",
                    crmVersion: "odoo"
                });
            },
            notifyEvent: function (eventName, data) {
                screenPop(data || {}, {}, eventName);
                postToOdoo({ type: "cif_event", event: eventName, data: data || {} });
                return Promise.resolve();
            },
            addHandler: function (eventName, handler) {
                handlers[eventName] = handlers[eventName] || [];
                handlers[eventName].push(handler);
                return Promise.resolve();
            },
            removeHandler: function (eventName, handler) {
                if (!handlers[eventName]) {
                    return Promise.resolve();
                }
                handlers[eventName] = handlers[eventName].filter(function (item) {
                    return item !== handler;
                });
                return Promise.resolve();
            },
            _handlers: handlers
        };
        if (!window.__odooHuccCifInitDone) {
            window.__odooHuccCifInitDone = true;
            try {
                window.dispatchEvent(new Event("CIFInitDone"));
            } catch (e) {
                /* ignore */
            }
        }
    }

    function bindEvents() {
        var voc = window.Vocalcom && window.Vocalcom.UCCore;
        if (!voc) {
            return;
        }
        var eventNames = [
            "incomingCall", "IncomingCall", "onIncomingCall", "callOffered", "CallOffered",
            "outgoingCall", "OutgoingCall", "onOutgoingCall", "outboundCall", "OutboundCall",
            "onOutboundCall", "manualCall", "ManualCall", "onManualCall", "previewCall",
            "PreviewCall", "onPreviewCall", "onManualCallStarted",
            "callStarted", "CallStarted", "onCallStarted", "callConnected", "CallConnected",
            "onCallConnected", "callAnswered", "CallAnswered", "onCallAnswered",
            "onConnected", "connected", "ringing", "Ringing", "onRinging", "onCallRinging",
            "interactionStarted", "InteractionStarted", "newInteraction", "NewInteraction",
            "interactionCreated", "InteractionCreated", "onInteraction", "onInteractionStarted",
            "interactionOffered", "InteractionOffered", "onInteractionOffered",
            "interactionConnected", "InteractionConnected", "onInteractionConnected",
            "chatStarted", "ChatStarted", "onChatStarted", "chatOffered", "ChatOffered",
            "onChatOffered", "chatConnected", "onChatConnected", "messageReceived",
            "MessageReceived", "onMessageReceived", "onNewMessage", "newMessage", "NewMessage",
            "socialMessage", "SocialMessage", "onSocialMessage", "emailReceived", "EmailReceived",
            "onEmailReceived", "onSocialInteraction", "omnichannelInteraction",
            "OmnichannelInteraction", "channelInteraction", "onChannelInteraction",
            "mediaConnected", "MediaConnected", "onMediaConnected"
        ];
        eventNames.forEach(function (name) {
            bindTarget(voc, name, makeHandler(name));
        });
        [
            "callEnded", "CallEnded", "onCallEnded", "callDisconnected", "CallDisconnected",
            "onCallDisconnected", "hangup", "Hangup", "onHangup", "callFinished", "CallFinished",
        ].forEach(function (name) {
            bindTarget(voc, name, makeCallEndHandler(name));
        });
        if (voc.Telephony) {
            var telephonyCallbacks = [
                "onIncomingCall", "onCallOffered", "onRinging", "onCallRinging",
                "onOutgoingCall", "onOutboundCall", "onManualCall", "onManualCallStarted",
                "onPreviewCall", "onCallStarted", "onCallConnected", "onCallAnswered",
                "onConnected", "onInteractionStarted", "onInteractionOffered",
                "onCallEnded", "onCallDisconnected", "onHangup",
            ];
            telephonyCallbacks.forEach(function (methodName) {
                if (/ended|disconnect|hangup|finished/i.test(methodName)) {
                    bindCallback(voc.Telephony, methodName, makeCallEndHandler(methodName));
                } else {
                    bindCallback(voc.Telephony, methodName, makeHandler(methodName));
                }
            });
        }
        ["Chat", "Omnichannel", "Messaging", "Social", "Email"].forEach(function (moduleName) {
            var mod = voc[moduleName];
            if (!mod) {
                return;
            }
            var moduleEvents = [
                "onChatStarted", "onChatOffered", "onChatConnected", "onMessageReceived",
                "onNewMessage", "onInteractionStarted", "onInteractionOffered",
                "onEmailReceived", "onSocialMessage", "onChannelInteraction"
            ];
            moduleEvents.forEach(function (methodName) {
                bindCallback(mod, methodName, makeHandler(moduleName + "." + methodName));
            });
            ["chatStarted", "messageReceived", "interactionStarted", "emailReceived"].forEach(function (eventName) {
                bindTarget(mod, eventName, makeHandler(moduleName + "." + eventName));
            });
        });
        postToOdoo({ type: "bridge_ready" });
        scheduleAutoLogin();
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
            var telephony = voc.Telephony;
            ["getActiveCall", "getCurrentCall", "getCurrentInteraction", "getActiveInteraction", "getCurrentSession"].forEach(function (method) {
                if (typeof telephony[method] !== "function") {
                    return;
                }
                try {
                    var value = telephony[method]();
                    if (value) {
                        candidates.push(value);
                    }
                } catch (e) {
                    /* ignore */
                }
            });
            if (telephony.currentCall) {
                candidates.push(telephony.currentCall);
            }
            if (telephony.activeCall) {
                candidates.push(telephony.activeCall);
            }
        }
        ["Interaction", "InteractionManager", "CurrentInteraction", "CRM"].forEach(function (key) {
            if (!voc[key]) {
                return;
            }
            var mod = voc[key];
            if (typeof mod.getCurrent === "function") {
                try {
                    var current = mod.getCurrent();
                    if (current) {
                        candidates.push(current);
                    }
                } catch (e) {
                    /* ignore */
                }
            }
            if (mod.current) {
                candidates.push(mod.current);
            }
        });
        candidates.forEach(function (raw) {
            var identifier = walkIdentifier(raw);
            if (!identifier) {
                return;
            }
            var callId = extractCallId(raw);
            var contextKey = identifier + "|" + callId;
            if (contextKey === lastContextKey) {
                return;
            }
            lastContextKey = contextKey;
            screenPop(raw, {}, "telephony_poll");
        });
    }

    function scanDomForPhone() {
        var selectors = [
            "[class*='call-banner']",
            "[class*='callBanner']",
            "[class*='phone-banner']",
            "[class*='interaction-banner']",
            "[class*='caller']",
            "[data-phone]",
            "[data-caller]"
        ];
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
        if (!nodes.length) {
            var bodyText = (document.body && document.body.innerText) || "";
            var match = bodyText.match(/\+?\d[\d\s\-().]{7,}\d/g);
            if (match) {
                match.slice(0, 3).forEach(function (text) {
                    var phone = walkPhone(text, 0);
                    if (phone && phone !== lastDomPhone) {
                        lastDomPhone = phone;
                        screenPop({ phone: phone }, { phone: phone, channel: "call" }, "dom_scan");
                    }
                });
            }
            return;
        }
        nodes.forEach(function (node) {
            var phone = walkPhone(node.getAttribute("data-phone") || node.getAttribute("data-caller") || node.textContent, 0);
            if (!phone || phone === lastDomPhone) {
                return;
            }
            lastDomPhone = phone;
            screenPop({ phone: phone, node: node.className || "" }, { phone: phone, channel: "call" }, "dom_banner");
        });
    }

    function placeCall(phone, campaignId) {
        var voc = window.Vocalcom && window.Vocalcom.UCCore;
        if (!voc || !voc.Telephony || typeof voc.Telephony.manualCall !== "function") {
            postToOdoo({ type: "dial_failed", phone: phone, reason: "UCCore.Telephony.manualCall is not available yet" });
            return;
        }
        try {
            if (campaignId && typeof voc.Telephony.selectManualCampaign === "function") {
                voc.Telephony.selectManualCampaign(campaignId);
            }
            voc.Telephony.manualCall(phone);
            screenPop({ phone: phone }, { phone: phone, direction: "outbound", channel: "call", state: "ringing" }, "manualCall");
            postToOdoo({ type: "dial_started", phone: phone, campaign_id: campaignId, direction: "outbound", channel: "call" });
        } catch (e) {
            postToOdoo({ type: "dial_failed", phone: phone, reason: String(e) });
        }
    }

    window.addEventListener("message", function (event) {
        var data = event.data || {};
        if (data.source !== "odoo_hucc") {
            return;
        }
        if (data.type === "dial" && data.phone) {
            placeCall(data.phone, data.campaignId);
        }
        if (data.type === "ping") {
            postToOdoo({ type: "pong" });
        }
    });

    installCIF();

    var attempts = 0;
    var eventsBound = false;
    var timer = setInterval(function () {
        attempts += 1;
        var voc = window.Vocalcom && window.Vocalcom.UCCore;
        if (voc && !eventsBound) {
            eventsBound = true;
            bindEvents();
            clearInterval(timer);
            setInterval(pollContext, 1200);
            setInterval(scanDomForPhone, 2000);
            try {
                var observer = new MutationObserver(function () {
                    scanDomForPhone();
                });
                observer.observe(document.documentElement || document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            } catch (e) {
                /* ignore */
            }
        } else if (attempts > 40) {
            clearInterval(timer);
        }
    }, 400);
})();
