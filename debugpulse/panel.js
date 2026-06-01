(function () {
  "use strict";

  const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
  const GROQ_MODEL = "llama-3.3-70b-versatile";
  const state = {
    failures: [],
    selectedId: null,
    filter: "all",
    activeTab: "overview",
    groqApiKey: "",
    conversationHistory: [],
  };
  let port = null;

  const elements = {};

  function $(id) {
    return document.getElementById(id);
  }

  function initElements() {
    for (const id of [
      "failureList", "emptyState", "failureCount", "detailPlaceholder", "detailView",
      "detailStatus", "detailStatusText", "detailMethod", "detailTime", "detailDuration",
      "detailUrl", "quickSummary", "requestHeaders", "responseHeaders", "requestBody",
      "responseBody", "analysisMissingKey", "analysisLoader", "analysisCards",
      "followupForm", "followupInput", "followupAnswer", "settingsDrawer", "settingsToggle",
      "settingsClose", "groqApiKey", "toggleKey", "saveKey", "testConnection",
      "settingsStatus", "clearAll",
    ]) {
      elements[id] = $(id);
    }
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function getSelectedFailure() {
    return state.failures.find((failure) => failure.id === state.selectedId) || null;
  }

  function statusClass(failure) {
    if (failure.error || !failure.statusCode) return "status-network";
    if (failure.statusCode >= 500) return "status-5xx";
    if (failure.statusCode >= 400) return "status-4xx";
    return "";
  }

  function methodClass(method) {
    const normalized = String(method || "GET").toUpperCase();
    return `method-${["GET", "POST", "PUT", "DELETE", "PATCH"].includes(normalized) ? normalized : "GET"}`;
  }

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || Date.now())) / 1000));
    if (seconds < 5) return "now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }

  function statusMessage(failure) {
    if (failure.error || !failure.statusCode) return failure.error || "Network Error";
    const text = String(failure.statusLine || "").replace(/^HTTP\/\d(?:\.\d)?\s*/i, "").trim();
    return text || `HTTP ${failure.statusCode}`;
  }

  function filteredFailures() {
    return state.failures.filter((failure) => {
      if (state.filter === "all") return true;
      if (state.filter === "network") return failure.error || !failure.statusCode;
      if (state.filter === "5xx") return failure.statusCode >= 500;
      if (state.filter === "4xx") return failure.statusCode >= 400 && failure.statusCode < 500;
      return true;
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderList() {
    const failures = filteredFailures();
    elements.failureCount.textContent = String(failures.length);
    elements.emptyState.classList.toggle("hidden", state.failures.length > 0);
    elements.failureList.innerHTML = failures.map((failure) => {
      const method = String(failure.method || "GET").toUpperCase();
      const status = failure.error || !failure.statusCode ? "ERR" : failure.statusCode;
      return `
        <button class="failure-item ${failure.id === state.selectedId ? "active" : ""}" data-id="${escapeHtml(failure.id)}">
          <div class="failure-row">
            <span class="method-badge ${methodClass(method)}">${escapeHtml(method)}</span>
            <span class="status-badge ${statusClass(failure)}">${escapeHtml(status)}</span>
            <span class="ai-dot ${failure.analysis ? "ready" : ""}" title="AI analysis ${failure.analysis ? "ready" : "pending"}"></span>
          </div>
          <div class="failure-row">
            <span class="url-text" title="${escapeHtml(failure.url)}">${escapeHtml(failure.url)}</span>
            <span class="time-text">${relativeTime(failure.timeStamp)}</span>
          </div>
        </button>
      `;
    }).join("");
  }

  function renderHeaderTable(headers) {
    if (!headers || !headers.length) return "<p class=\"notice\">No headers captured</p>";
    return `
      <table class="headers-table">
        <tbody>
          ${headers.map((header) => `
            <tr>
              <td>${escapeHtml(header.name)}</td>
              <td>${escapeHtml(header.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function formatBody(value, emptyMessage) {
    if (!value) return emptyMessage;
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function highlightJson(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "json-key" : "json-string";
      else if (/true|false/.test(match)) cls = "json-bool";
      else if (/null/.test(match)) cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    });
  }

  function setCode(element, value, emptyMessage) {
    const formatted = formatBody(value, emptyMessage);
    element.dataset.raw = formatted;
    element.innerHTML = highlightJson(formatted);
  }

  function renderDetail() {
    const failure = getSelectedFailure();
    elements.detailPlaceholder.classList.toggle("hidden", Boolean(failure));
    elements.detailView.classList.toggle("hidden", !failure);
    if (!failure) return;

    const method = String(failure.method || "GET").toUpperCase();
    elements.detailStatus.textContent = failure.error || !failure.statusCode ? "ERR" : failure.statusCode;
    elements.detailStatus.style.color = failure.statusCode >= 500 ? "var(--dp-red)" : failure.statusCode >= 400 ? "var(--dp-orange)" : "var(--dp-text-muted)";
    elements.detailStatusText.textContent = statusMessage(failure);
    elements.detailMethod.textContent = method;
    elements.detailMethod.className = `method-badge ${methodClass(method)}`;
    elements.detailTime.textContent = new Date(failure.timeStamp).toLocaleString();
    elements.detailDuration.textContent = failure.duration === null || failure.duration === undefined ? "" : `${failure.duration} ms`;
    elements.detailUrl.textContent = failure.url;
    elements.quickSummary.textContent = failure.analysis?.whatWentWrong || "Open AI Analysis to generate a request-specific explanation.";
    elements.requestHeaders.innerHTML = renderHeaderTable(failure.requestHeaders);
    elements.responseHeaders.innerHTML = renderHeaderTable(failure.responseHeaders);
    setCode(elements.requestBody, failure.requestBody, "No request body captured");
    setCode(elements.responseBody, failure.responseBody, failure.bodyCaptureStatus ? failure.bodyCaptureStatus : "No response body captured");
    renderAnalysis(failure);
  }

  function renderAnalysis(failure) {
    elements.analysisMissingKey.classList.toggle("hidden", Boolean(state.groqApiKey));
    elements.analysisLoader.classList.toggle("hidden", failure.analysisStatus !== "loading");
    if (!failure.analysis) {
      elements.analysisCards.innerHTML = failure.analysisStatus === "error"
        ? `<div class="notice">AI analysis failed: ${escapeHtml(failure.analysisError || "Unknown Groq or response parsing error")}</div>`
        : "";
      return;
    }
    const analysis = failure.analysis;
    elements.analysisCards.innerHTML = [
      card("⚠", "What went wrong", `<p>${escapeHtml(analysis.whatWentWrong || "")}</p>`),
      card("🔍", "Likely cause", list(analysis.likelyCauses)),
      card("🔧", "How to fix it", markdownLike(analysis.howToFix || "")),
      card("📋", "Headers & payload issues", list(analysis.headerAndPayloadIssues)),
    ].join("");
  }

  function card(icon, title, body) {
    return `<article class="analysis-card"><h3><span>${icon}</span>${escapeHtml(title)}</h3>${body}</article>`;
  }

  function list(items) {
    if (!Array.isArray(items) || !items.length) return "<p>No specific issues found.</p>";
    return `<ul>${items.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function markdownLike(value) {
    const escaped = escapeHtml(value);
    return escaped
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/\n/g, "<br>");
  }

  function setFailureAnalysis(id, patch) {
    const index = state.failures.findIndex((failure) => failure.id === id);
    if (index === -1) return;
    state.failures[index] = { ...state.failures[index], ...patch };
    renderList();
    renderDetail();
  }

  function headersToLines(headers) {
    if (!headers || !headers.length) return "not captured";
    return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
  }

  function buildAnalysisMessages(failure) {
    return [
      {
        role: "system",
        content: "You are DebugPulse, an expert API debugger assistant. You help developers and QA engineers understand why API requests fail. You analyze HTTP failures and provide clear, actionable diagnostics. Always be specific - reference the actual status code, headers, and payload values from the request. Format your response as a JSON object with these exact keys: whatWentWrong (string), likelyCauses (array of strings, max 3), howToFix (string with markdown code blocks where helpful), headerAndPayloadIssues (array of strings). Be concise but precise.",
      },
      {
        role: "user",
        content: `Analyze this failed API request:

Method: ${failure.method}
URL: ${failure.url}
Status: ${failure.statusCode} ${failure.statusLine || ""}
Timestamp: ${new Date(failure.timeStamp).toISOString()}

REQUEST HEADERS:
${headersToLines(failure.requestHeaders)}

REQUEST BODY:
${failure.requestBody || "not captured"}

RESPONSE HEADERS:
${headersToLines(failure.responseHeaders)}

RESPONSE BODY:
${failure.responseBody || "not captured"}

${failure.error ? "Network Error: " + failure.error : ""}

Diagnose what went wrong and how to fix it.`,
      },
    ];
  }

  async function getGroqKey() {
    const values = await chrome.storage.local.get("groqApiKey");
    state.groqApiKey = values.groqApiKey || "";
    elements.groqApiKey.value = state.groqApiKey;
    return state.groqApiKey;
  }

  async function streamGroq(messages, onChunk, options = {}) {
    const key = await getGroqKey();
    if (!key) throw new Error("Missing Groq API key");
    const payload = {
      model: GROQ_MODEL,
      messages,
      stream: true,
      temperature: 0.2,
    };
    if (options.responseFormat === "json_object") {
      payload.response_format = { type: "json_object" };
    }
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await response.text());
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            content += delta;
            onChunk(content, delta);
          }
        } catch (_) {}
      }
    }
    return content;
  }

  function parseAnalysis(text) {
    const trimmed = text.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let jsonText = trimmed;
    if (!jsonText.startsWith("{")) {
      const start = jsonText.indexOf("{");
      const end = jsonText.lastIndexOf("}");
      if (start !== -1 && end > start) {
        jsonText = jsonText.slice(start, end + 1);
      }
    }
    const parsed = JSON.parse(jsonText);
    return {
      whatWentWrong: String(parsed.whatWentWrong || ""),
      likelyCauses: Array.isArray(parsed.likelyCauses) ? parsed.likelyCauses.slice(0, 3).map(String) : [],
      howToFix: String(parsed.howToFix || ""),
      headerAndPayloadIssues: Array.isArray(parsed.headerAndPayloadIssues) ? parsed.headerAndPayloadIssues.map(String) : [],
    };
  }

  async function analyzeFailure(failure) {
    if (!failure || failure.analysis || failure.analysisStatus === "loading") return;
    if (!state.groqApiKey) {
      await getGroqKey();
      if (!state.groqApiKey) {
        renderAnalysis(failure);
        return;
      }
    }
    setFailureAnalysis(failure.id, { analysisStatus: "loading" });
    try {
      const text = await streamGroq(buildAnalysisMessages(failure), () => {}, { responseFormat: "json_object" });
      const analysis = parseAnalysis(text);
      setFailureAnalysis(failure.id, { analysis, analysisStatus: "ready", analysisError: "" });
    } catch (error) {
      console.error("DebugPulse analysis failed", error);
      setFailureAnalysis(failure.id, { analysisStatus: "error", analysisError: error.message || String(error) });
    }
  }

  async function askFollowup(question) {
    const failure = getSelectedFailure();
    if (!failure || !question.trim()) return;
    elements.followupAnswer.textContent = "";
    state.conversationHistory.push({ role: "user", content: question.trim() });
    state.conversationHistory = state.conversationHistory.slice(-6);
    const messages = [
      ...buildAnalysisMessages(failure),
      { role: "assistant", content: JSON.stringify(failure.analysis || {}) },
      ...state.conversationHistory,
    ];
    try {
      const answer = await streamGroq(messages, (content) => {
        elements.followupAnswer.textContent = content;
      });
      state.conversationHistory.push({ role: "assistant", content: answer });
      state.conversationHistory = state.conversationHistory.slice(-6);
    } catch (error) {
      elements.followupAnswer.textContent = `DebugPulse could not answer: ${error.message || String(error)}`;
    }
  }

  function attachEvents() {
    elements.failureList.addEventListener("click", (event) => {
      const item = event.target.closest(".failure-item");
      if (!item) return;
      state.selectedId = item.dataset.id;
      state.conversationHistory = [];
      renderList();
      renderDetail();
    });
    document.querySelectorAll(".filter-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;
        document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
        renderList();
      });
    });
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.tab;
        document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
        document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${state.activeTab}`));
        if (state.activeTab === "analysis") analyzeFailure(getSelectedFailure());
      });
    });
    document.addEventListener("click", (event) => {
      const copy = event.target.closest(".copy-button");
      if (!copy) return;
      const target = elements[copy.dataset.copy];
      navigator.clipboard.writeText(target?.dataset.raw || target?.textContent || "");
    });
    elements.clearAll.addEventListener("click", async () => {
      await sendMessage({ type: "CLEAR_FAILURES" });
      state.failures = [];
      state.selectedId = null;
      renderList();
      renderDetail();
    });
    elements.settingsToggle.addEventListener("click", () => elements.settingsDrawer.classList.remove("hidden"));
    elements.settingsClose.addEventListener("click", () => elements.settingsDrawer.classList.add("hidden"));
    elements.toggleKey.addEventListener("click", () => {
      const visible = elements.groqApiKey.type === "text";
      elements.groqApiKey.type = visible ? "password" : "text";
      elements.toggleKey.textContent = visible ? "Show" : "Hide";
    });
    elements.saveKey.addEventListener("click", async () => {
      await sendMessage({ type: "SAVE_GROQ_KEY", groqApiKey: elements.groqApiKey.value });
      state.groqApiKey = elements.groqApiKey.value.trim();
      elements.settingsStatus.textContent = "Groq API key saved.";
      renderDetail();
    });
    elements.testConnection.addEventListener("click", async () => {
      elements.settingsStatus.textContent = "Testing connection...";
      const result = await sendMessage({ type: "TEST_GROQ", groqApiKey: elements.groqApiKey.value });
      elements.settingsStatus.textContent = result.ok ? "Connection successful." : `Connection failed: ${result.error || result.status}`;
    });
    elements.followupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const question = elements.followupInput.value;
      elements.followupInput.value = "";
      await askFollowup(question);
    });
  }

  async function loadInitialState() {
    const [failureResult] = await Promise.all([
      sendMessage({ type: "GET_FAILURES" }),
      getGroqKey(),
    ]);
    state.failures = failureResult.failures || [];
    if (!state.selectedId && state.failures.length) state.selectedId = state.failures[0].id;
    renderList();
    renderDetail();
  }

  function connectDevtoolsPort() {
    try {
      port = chrome.runtime.connect({ name: "devtools-panel" });
      port.postMessage({ type: "INIT_DEVTOOLS", tabId: chrome.devtools.inspectedWindow.tabId });
      port.onMessage.addListener((message) => {
        if (message.type === "NEW_FAILURE") {
          state.failures = [message.data, ...state.failures.filter((failure) => failure.id !== message.data.id)].slice(0, 50);
          if (!state.selectedId) state.selectedId = message.data.id;
          renderList();
          renderDetail();
        }
        if (message.type === "FAILURE_UPDATED") {
          const index = state.failures.findIndex((failure) => failure.id === message.data.id);
          if (index !== -1) state.failures[index] = message.data;
          renderList();
          renderDetail();
        }
        if (message.type === "FAILURES_CLEARED") {
          state.failures = [];
          state.selectedId = null;
          renderList();
          renderDetail();
        }
      });
    } catch (error) {
      console.warn("DebugPulse could not connect DevTools port", error);
    }
  }

  initElements();
  attachEvents();
  connectDevtoolsPort();
  loadInitialState().catch((error) => {
    console.error("DebugPulse panel failed to initialize", error);
  });
})();
