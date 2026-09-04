(function () {
    "use strict";

    if (window.__odooHuccCdnPreclearDone) {
        return;
    }
    window.__odooHuccCdnPreclearDone = true;

    function nuclearClear() {
        try {
            localStorage.clear();
        } catch (e) {
            /* ignore */
        }
        try {
            sessionStorage.clear();
        } catch (e2) {
            /* ignore */
        }
    }

    function notifyParent(phase) {
        try {
            window.parent.postMessage(
                {
                    source: "odoo_hucc_preclear",
                    cleared: true,
                    phase: phase || "final",
                },
                "*"
            );
        } catch (e3) {
            /* ignore */
        }
    }

    nuclearClear();
    console.debug("[Odoo HUCC] CDN CTI storage cleared");

    // ProxyHermesFront may init CTI and write uuid after HUCCLoader runs.
    setTimeout(function () {
        nuclearClear();
        console.debug("[Odoo HUCC] CDN CTI storage cleared (post-init)");
        notifyParent("final");
    }, 200);
})();
