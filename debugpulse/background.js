(function () {
  "use strict";

  const FAILURES_KEY = "debugpulse_failures";
  const PAUSED_KEY = "debugpulsePaused";
  const COUNT_KEY = "debugpulseRequestCount";
  const MAX_FAILURES = 50;
  const MERGE_WINDOW_MS = 500;
  const REQUEST_TTL_MS = 120000;

  const requestMeta = new Map();
  const pendingBodies = [];
  const devtoolsPorts = new Map();

  function requestKey(details) {
    return `${details.requestId || ""}`;
  }

  function nowId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeHeaders(headers) {
    if (!Array.isArray(headers)) return [];
    return headers
      .filter((header) => header && header.name)
      .map((header) => ({
        name: String(header.name),
        value: header.value === undefined ? "" : String(header.value),
      }));
  }

  function isBodyLikeType(type) {
    return ["xmlhttprequest", "fetch"].includes(type);
  }

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  async function isPaused() {
    const values = await storageGet(PAUSED_KEY);
    return Boolean(values[PAUSED_KEY]);
  }

  async function getFailures() {
    const values = await storageGet(FAILURES_KEY);
    return Array.isArray(values[FAILURES_KEY]) ? values[FAILURES_KEY] : [];
  }

  async function setFailures(failures) {
    await storageSet({ [FAILURES_KEY]: failures.slice(0, MAX_FAILURES) });
  }

  function notifyTabs(message) {
    const targetTabId = message.data && message.data.tabId;
    let delivered = false;
    for (const [tabId, ports] of devtoolsPorts.entries()) {
      if (targetTabId !== undefined && targetTabId !== tabId) continue;
      for (const port of ports) {
        try {
          port.postMessage(message);
          delivered = true;
        } catch (error) {
          console.warn("DebugPulse port delivery failed", error);
        }
      }
    }
    if (!delivered) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  }

  function cleanupRequestMeta() {
    const cutoff = Date.now() - REQUEST_TTL_MS;
    for (const [key, meta] of requestMeta.entries()) {
      if ((meta.startedAt || 0) < cutoff) requestMeta.delete(key);
    }
    for (let index = pendingBodies.length - 1; index >= 0; index -= 1) {
      if ((pendingBodies[index].receivedAt || 0) < cutoff) pendingBodies.splice(index, 1);
    }
  }

  async function incrementRequestCount() {
    const values = await storageGet(COUNT_KEY);
    const current = Number(values[COUNT_KEY] || 0);
    await storageSet({ [COUNT_KEY]: current + 1 });
  }

  function buildFailure(details, override = {}) {
    const meta = requestMeta.get(requestKey(details)) || {};
    const timeStamp = Math.round(details.timeStamp || Date.now());
    return {
      id: nowId(),
      url: details.url,
      method: details.method || meta.method || "GET",
      statusCode: override.statusCode ?? details.statusCode ?? 0,
      statusLine: override.statusLine ?? details.statusLine ?? "",
      requestHeaders: normalizeHeaders(meta.requestHeaders),
      responseHeaders: normalizeHeaders(details.responseHeaders),
      timeStamp,
      tabId: details.tabId,
      type: details.type || meta.type || "other",
      error: override.error || "",
      duration: meta.startedAt ? Math.max(0, Math.round(timeStamp - meta.startedAt)) : null,
      requestBody: "",
      responseBody: "",
      analysis: null,
      analysisStatus: "idle",
    };
  }

  function scoreBodyMatch(failure, body) {
    if (!failure || !body) return Number.POSITIVE_INFINITY;
    if (failure.tabId !== body.tabId) return Number.POSITIVE_INFINITY;
    if ((failure.method || "").toUpperCase() !== (body.method || "").toUpperCase()) {
      return Number.POSITIVE_INFINITY;
    }
    if (failure.url !== body.url) return Number.POSITIVE_INFINITY;
    return Math.abs(Number(failure.timeStamp) - Number(body.timestamp || body.timeStamp || 0));
  }

  function mergeBodyIntoFailure(failure, body) {
    const mergedRequestHeaders = normalizeHeaders(body.requestHeaders);
    const mergedResponseHeaders = normalizeHeaders(body.responseHeaders);
    return {
      ...failure,
      requestBody: body.requestBody ?? failure.requestBody ?? "",
      responseBody: body.responseBody ?? failure.responseBody ?? "",
      requestHeaders: mergedRequestHeaders.length ? mergedRequestHeaders : failure.requestHeaders,
      responseHeaders: mergedResponseHeaders.length ? mergedResponseHeaders : failure.responseHeaders,
      statusCode: body.status || failure.statusCode,
      bodyCaptureStatus: body.bodyCaptureStatus || failure.bodyCaptureStatus || "captured",
    };
  }

  function findPendingBodyForFailure(failure) {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < pendingBodies.length; index += 1) {
      const score = scoreBodyMatch(failure, pendingBodies[index]);
      if (score <= MERGE_WINDOW_MS && score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) return null;
    const [body] = pendingBodies.splice(bestIndex, 1);
    return body;
  }

  async function storeFailure(failure) {
    if (await isPaused()) return;
    cleanupRequestMeta();
    const pendingBody = findPendingBodyForFailure(failure);
    const finalFailure = pendingBody ? mergeBodyIntoFailure(failure, pendingBody) : failure;
    const failures = await getFailures();
    const next = [finalFailure, ...failures].slice(0, MAX_FAILURES);
    await setFailures(next);
    notifyTabs({ type: "NEW_FAILURE", data: finalFailure });
  }

  async function mergeBodyCapture(bodyData, sender) {
    if (await isPaused()) return { ok: true, paused: true };
    const body = {
      ...bodyData,
      tabId: bodyData.tabId ?? sender?.tab?.id ?? -1,
      receivedAt: Date.now(),
    };
    const failures = await getFailures();
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = 0; index < failures.length; index += 1) {
      const score = scoreBodyMatch(failures[index], body);
      if (score <= MERGE_WINDOW_MS && score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) {
      pendingBodies.unshift(body);
      pendingBodies.splice(20);
      return { ok: true, pending: true };
    }
    const merged = mergeBodyIntoFailure(failures[bestIndex], body);
    failures[bestIndex] = merged;
    await setFailures(failures);
    notifyTabs({ type: "FAILURE_UPDATED", data: merged });
    return { ok: true, merged: true };
  }

  chrome.webRequest.onBeforeRequest.addListener(
    async (details) => {
      cleanupRequestMeta();
      requestMeta.set(requestKey(details), {
        startedAt: Math.round(details.timeStamp || Date.now()),
        method: details.method,
        url: details.url,
        tabId: details.tabId,
        type: details.type,
      });
      if (isBodyLikeType(details.type)) {
        await incrementRequestCount().catch(() => {});
      }
    },
    { urls: ["<all_urls>"] }
  );

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const key = requestKey(details);
      const meta = requestMeta.get(key) || {};
      requestMeta.set(key, {
        ...meta,
        method: details.method || meta.method,
        url: details.url || meta.url,
        tabId: details.tabId,
        type: details.type || meta.type,
        requestHeaders: normalizeHeaders(details.requestHeaders),
      });
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.statusCode >= 400 && isBodyLikeType(details.type)) {
        storeFailure(buildFailure(details)).catch((error) => {
          console.error("DebugPulse failed to store completed request", error);
        });
      }
      requestMeta.delete(requestKey(details));
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders", "extraHeaders"]
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (isBodyLikeType(details.type)) {
        storeFailure(buildFailure(details, {
          statusCode: 0,
          statusLine: "Network Error",
          error: details.error || "Network error",
        })).catch((error) => {
          console.error("DebugPulse failed to store network error", error);
        });
      }
      requestMeta.delete(requestKey(details));
    },
    { urls: ["<all_urls>"] }
  );

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "devtools-panel") return;
    let connectedTabId = null;
    port.onMessage.addListener((message) => {
      if (message?.type === "INIT_DEVTOOLS" && Number.isInteger(message.tabId)) {
        connectedTabId = message.tabId;
        const ports = devtoolsPorts.get(connectedTabId) || new Set();
        ports.add(port);
        devtoolsPorts.set(connectedTabId, ports);
      }
    });
    port.onDisconnect.addListener(() => {
      if (connectedTabId === null) return;
      const ports = devtoolsPorts.get(connectedTabId);
      if (!ports) return;
      ports.delete(port);
      if (!ports.size) devtoolsPorts.delete(connectedTabId);
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case "REQUEST_BODY_CAPTURED":
          return mergeBodyCapture(message.data || {}, sender);
        case "GET_FAILURES":
          return { failures: await getFailures() };
        case "CLEAR_FAILURES":
          await setFailures([]);
          notifyTabs({ type: "FAILURES_CLEARED" });
          return { ok: true };
        case "SET_PAUSED":
          await storageSet({ [PAUSED_KEY]: Boolean(message.paused) });
          return { ok: true, paused: Boolean(message.paused) };
        case "GET_SETTINGS": {
          const values = await storageGet([PAUSED_KEY, COUNT_KEY, "groqApiKey"]);
          return {
            paused: Boolean(values[PAUSED_KEY]),
            requestCount: Number(values[COUNT_KEY] || 0),
            hasGroqApiKey: Boolean(values.groqApiKey),
            groqApiKey: values.groqApiKey || "",
          };
        }
        case "SAVE_GROQ_KEY":
          await storageSet({ groqApiKey: String(message.groqApiKey || "").trim() });
          return { ok: true };
        case "TEST_GROQ": {
          const values = await storageGet("groqApiKey");
          const key = String(message.groqApiKey || values.groqApiKey || "").trim();
          if (!key) return { ok: false, error: "Missing Groq API key" };
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: "Reply with OK." }],
              max_tokens: 5,
            }),
          });
          return { ok: response.ok, status: response.status, error: response.ok ? "" : await response.text() };
        }
        default:
          return { ok: false, error: "Unknown DebugPulse message" };
      }
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
