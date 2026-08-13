// ==UserScript==
// @name         Fantis Sleeper Manager — Browser Automation
// @namespace    fantis-sleeper-manager
// @version      1.0.0
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
// ==/UserScript==

(function () {
  "use strict";

  // Only runs while a tab matching @match above is open — Tampermonkey
  // userscripts have no persistent background process the way a Chrome
  // extension's service worker does, so this polls only while /manager
  // is actually the active tab's page.
  const API_BASE = window.location.origin;
  const PING_INTERVAL_MS = 5000;

  function getToken() {
    let token = GM_getValue("automationToken", "");
    if (!token) {
      token = prompt(
        "Fantis Sleeper Manager: paste your AUTOMATION_TOKEN (from .env.local / Vercel env) to connect this browser."
      );
      if (token) GM_setValue("automationToken", token.trim());
    }
    return token;
  }

  function request(path, options) {
    const token = getToken();
    if (!token) return Promise.reject(new Error("No automation token configured."));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url: API_BASE + path,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        data: options.body ? JSON.stringify(options.body) : undefined,
        onload: (res) => {
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
        onerror: () => reject(new Error("Network error reaching Fantis.")),
      });
    });
  }

  function ping() {
    request("/api/manager/automation/ping", { method: "POST" }).catch(() => {
      // A failed ping just means "not connected" on the dashboard next
      // load — no retry-storm, no user-facing error for a background beat.
    });
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
        for (const action of actions) {
          try {
            GM_openInTab(action.targetUrl, { active: true, insert: true });
            completeAction(action.id, "completed").catch(() => {});
          } catch (e) {
            completeAction(action.id, "failed", String(e)).catch(() => {});
          }
        }
      })
      .catch(() => {
        // Same reasoning as ping() — a failed poll just tries again next tick.
      });
  }

  function tick() {
    ping();
    processPendingActions();
  }

  tick();
  setInterval(tick, PING_INTERVAL_MS);
})();
