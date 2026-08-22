// ==UserScript==
// @name         Fantis Sleeper Manager — Browser Automation
// @namespace    fantis-sleeper-manager
// @version      1.1.0
// @description  Phase 3: lets the Fantis Sleeper Manager dashboard open the
//               right Sleeper page for you. No consequential actions —
//               opening a tab is the only thing this does right now.
// @match        https://fantis.vercel.app/manager*
// @match        http://localhost:3000/manager*
// @connect      fantis.vercel.app
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const LOG = "[Fantis Automation]";
  console.log(LOG, "script loaded — GM APIs present:", {
    GM_xmlhttpRequest: typeof GM_xmlhttpRequest,
    GM_openInTab: typeof GM_openInTab,
    GM_setValue: typeof GM_setValue,
    GM_getValue: typeof GM_getValue,
  });

  try {
    // Only runs while a tab matching @match above is open — Tampermonkey
    // userscripts have no persistent background process the way a Chrome
    // extension's service worker does, so this polls only while /manager
    // is actually the active tab's page.
    const API_BASE = window.location.origin;
    const PING_INTERVAL_MS = 5000;

    // Exposed via Tampermonkey's toolbar menu so a bad/stale pasted token
    // (from earlier troubleshooting) can be cleared without digging through
    // GM storage manually.
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Reset Fantis automation token", () => {
        GM_setValue("automationToken", "");
        alert("Fantis automation token cleared — reload this page to be prompted again.");
      });
    }

    function getToken() {
      let token = GM_getValue("automationToken", "");
      console.log(LOG, "stored token present:", Boolean(token));
      if (!token) {
        console.log(LOG, "no stored token — calling prompt()");
        try {
          token = prompt(
            "Fantis Sleeper Manager: paste your AUTOMATION_TOKEN (from .env.local / Vercel env) to connect this browser."
          );
        } catch (e) {
          console.error(LOG, "prompt() threw:", e);
          token = null;
        }
        console.log(LOG, "prompt() returned:", token ? `(${token.length} chars)` : JSON.stringify(token));
        if (token) GM_setValue("automationToken", token.trim());
      }
      return token;
    }

    function request(path, options) {
      const token = getToken();
      if (!token) {
        console.warn(LOG, "no token available — skipping request to", path);
        return Promise.reject(new Error("No automation token configured."));
      }
      return new Promise((resolve, reject) => {
        console.log(LOG, "requesting", options.method || "GET", API_BASE + path);
        GM_xmlhttpRequest({
          method: options.method || "GET",
          url: API_BASE + path,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          data: options.body ? JSON.stringify(options.body) : undefined,
          onload: (res) => {
            console.log(LOG, "response", res.status, "from", path);
            if (res.status >= 200 && res.status < 300) {
              try {
                resolve(JSON.parse(res.responseText));
              } catch {
                resolve(null);
              }
            } else {
              reject(new Error("HTTP " + res.status));
            }
          },
          onerror: (err) => {
            console.error(LOG, "network error reaching", path, err);
            reject(new Error("Network error reaching Fantis."));
          },
        });
      });
    }

    function ping() {
      request("/api/manager/automation/ping", { method: "POST" })
        .then(() => console.log(LOG, "ping ok"))
        .catch((e) => console.warn(LOG, "ping failed:", e.message));
    }

    function completeAction(id, status, error) {
      return request(`/api/manager/automation/actions/${id}/complete`, {
        method: "POST",
        body: { status, error },
      });
    }

    function processPendingActions() {
      request("/api/manager/automation/actions", { method: "GET" })
        .then((data) => {
          const actions = (data && data.actions) || [];
          if (actions.length) console.log(LOG, actions.length, "pending action(s)");
          for (const action of actions) {
            try {
              GM_openInTab(action.targetUrl, { active: true, insert: true });
              completeAction(action.id, "completed").catch(() => {});
            } catch (e) {
              completeAction(action.id, "failed", String(e)).catch(() => {});
            }
          }
        })
        .catch((e) => console.warn(LOG, "poll failed:", e.message));
    }

    function tick() {
      ping();
      processPendingActions();
    }

    console.log(LOG, "starting poll loop, interval", PING_INTERVAL_MS, "ms");
    tick();
    setInterval(tick, PING_INTERVAL_MS);
  } catch (e) {
    console.error(LOG, "top-level error — script did not start:", e);
  }
})();
