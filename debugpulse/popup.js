(function () {
  "use strict";

  const elements = {
    activeState: document.getElementById("activeState"),
    pausedToggle: document.getElementById("pausedToggle"),
    popupFailures: document.getElementById("popupFailures"),
    openDevtools: document.getElementById("openDevtools"),
    popupGroqKey: document.getElementById("popupGroqKey"),
    popupSaveKey: document.getElementById("popupSaveKey"),
    popupStatus: document.getElementById("popupStatus"),
    requestCount: document.getElementById("requestCount"),
  };

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || Date.now())) / 1000));
    if (seconds < 5) return "now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }

  function statusClass(failure) {
    if (failure.error || !failure.statusCode) return "status-network";
    if (failure.statusCode >= 500) return "status-5xx";
    return "status-4xx";
  }

  function methodClass(method) {
    const normalized = String(method || "GET").toUpperCase();
    return `method-${["GET", "POST", "PUT", "DELETE", "PATCH"].includes(normalized) ? normalized : "GET"}`;
  }

  function renderFailures(failures) {
    const recent = failures.slice(0, 3);
    if (!recent.length) {
      elements.popupFailures.innerHTML = "<p class=\"settings-status\">No failures captured yet.</p>";
      return;
    }
    elements.popupFailures.innerHTML = recent.map((failure) => {
      const method = String(failure.method || "GET").toUpperCase();
      const status = failure.error || !failure.statusCode ? "ERR" : failure.statusCode;
      return `
        <article class="popup-failure">
          <div class="failure-row">
            <span class="method-badge ${methodClass(method)}">${escapeHtml(method)}</span>
            <span class="status-badge ${statusClass(failure)}">${escapeHtml(status)}</span>
            <span class="time-text">${relativeTime(failure.timeStamp)}</span>
          </div>
          <span class="url-text" title="${escapeHtml(failure.url)}">${escapeHtml(failure.url)}</span>
        </article>
      `;
    }).join("");
  }

  async function load() {
    const [settings, failureResult] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_FAILURES" }),
    ]);
    elements.pausedToggle.checked = Boolean(settings.paused);
    elements.activeState.textContent = settings.paused ? "Paused" : "Active";
    elements.requestCount.textContent = String(settings.requestCount || 0);
    elements.popupGroqKey.value = settings.groqApiKey || "";
    renderFailures(failureResult.failures || []);
  }

  elements.pausedToggle.addEventListener("change", async () => {
    const paused = elements.pausedToggle.checked;
    await sendMessage({ type: "SET_PAUSED", paused });
    elements.activeState.textContent = paused ? "Paused" : "Active";
  });

  elements.popupSaveKey.addEventListener("click", async () => {
    await sendMessage({ type: "SAVE_GROQ_KEY", groqApiKey: elements.popupGroqKey.value });
    elements.popupStatus.textContent = "Groq API key saved.";
  });

  elements.openDevtools.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.update(tab.id, { active: true });
    }
    elements.popupStatus.textContent = "Open Chrome DevTools and select the DebugPulse panel.";
  });

  load().catch((error) => {
    elements.popupStatus.textContent = `DebugPulse failed to load: ${error.message || String(error)}`;
  });
})();
