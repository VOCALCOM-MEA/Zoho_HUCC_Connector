(function () {
    "use strict";

    if (window.__odooHuccCdnPreclearDone) {
        return;
    }
    window.__odooHuccCdnPreclearDone = true;

    function isVocalcomStorageKey(key) {
        if (!key) {
            return false;
        }
        var lower = key.toLowerCase();
        return (
            key === "context" ||
            key.indexOf("LS_") === 0 ||
            key.indexOf("VHC_") === 0 ||
            key.indexOf("vhc_") === 0 ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) ||
            lower.indexOf("vocalcom") >= 0 ||
            lower.indexOf("hermes") >= 0 ||
            lower.indexOf("cti") >= 0 ||
            lower.indexOf("hucc") >= 0 ||
            lower.indexOf("proxy") >= 0 ||
            lower.indexOf("session") >= 0 ||
            lower.indexOf("agent") >= 0 ||
            lower.indexOf("reconnect") >= 0
        );
    }

    function clearVocalcomSessionStorage() {
        var keys = [];
        var idx;
        var key;
        for (idx = 0; idx < localStorage.length; idx += 1) {
            key = localStorage.key(idx);
            if (isVocalcomStorageKey(key)) {
                keys.push(key);
            }
        }
        keys.forEach(function (storageKey) {
            try {
                localStorage.removeItem(storageKey);
            } catch (e) {
                /* ignore */
            }
        });
        try {
            for (idx = sessionStorage.length - 1; idx >= 0; idx -= 1) {
                key = sessionStorage.key(idx);
                if (isVocalcomStorageKey(key)) {
                    sessionStorage.removeItem(key);
                }
            }
        } catch (e2) {
            /* ignore */
        }
    }

    clearVocalcomSessionStorage();
    console.debug("[Odoo HUCC] CDN CTI storage cleared");
})();
