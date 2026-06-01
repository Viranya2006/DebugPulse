(function () {
  "use strict";

  if (window.__DEBUGPULSE_INSTALLED__) return;
  window.__DEBUGPULSE_INSTALLED__ = true;

  const SOURCE = "DebugPulsePageHook";
  const MAX_BODY_LENGTH = 200000;
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  function truncate(value) {
    if (typeof value !== "string") return value;
    if (value.length <= MAX_BODY_LENGTH) return value;
    return `${value.slice(0, MAX_BODY_LENGTH)}\n\n[DebugPulse truncated ${value.length - MAX_BODY_LENGTH} characters]`;
  }

  function normalizeHeaderPairs(headers) {
    const pairs = [];
    try {
      if (!headers) return pairs;
      if (headers instanceof Headers) {
        headers.forEach((value, name) => pairs.push({ name, value }));
        return pairs;
      }
      if (Array.isArray(headers)) {
        for (const item of headers) {
          if (Array.isArray(item)) pairs.push({ name: String(item[0]), value: String(item[1]) });
        }
        return pairs;
      }
      if (typeof headers === "object") {
        for (const [name, value] of Object.entries(headers)) {
          pairs.push({ name, value: String(value) });
        }
      }
    } catch (error) {
      pairs.push({ name: "DebugPulse-Headers-Error", value: error.message || String(error) });
    }
    return pairs;
  }

  async function bodyToText(body) {
    try {
      if (body === null || body === undefined) return "";
      if (typeof body === "string") return truncate(body);
      if (body instanceof URLSearchParams) return truncate(body.toString());
      if (body instanceof FormData) {
        const object = {};
        for (const [key, value] of body.entries()) {
          object[key] = value instanceof File
            ? { name: value.name, type: value.type, size: value.size }
            : String(value);
        }
        return truncate(JSON.stringify(object, null, 2));
      }
      if (body instanceof Blob) return truncate(await body.text());
      if (body instanceof ArrayBuffer) return truncate(new TextDecoder().decode(body));
      if (ArrayBuffer.isView(body)) return truncate(new TextDecoder().decode(body));
      if (body instanceof ReadableStream) return "[ReadableStream body unavailable]";
      if (typeof body === "object") return truncate(JSON.stringify(body, null, 2));
      return truncate(String(body));
    } catch (error) {
      return `[DebugPulse could not read request body: ${error.message || String(error)}]`;
    }
  }

  async function requestBodyFromFetch(input, init) {
    try {
      if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
        return bodyToText(init.body);
      }
      if (input instanceof Request) {
        const clone = input.clone();
        return truncate(await clone.text());
      }
    } catch (error) {
      return `[DebugPulse could not clone request body: ${error.message || String(error)}]`;
    }
    return "";
  }

  function fetchUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return String(input);
  }

  function fetchMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  }

  function fetchHeaders(input, init) {
    if (init?.headers) return normalizeHeaderPairs(init.headers);
    if (input instanceof Request) return normalizeHeaderPairs(input.headers);
    return [];
  }

  function emit(data) {
    window.postMessage({ source: SOURCE, type: "REQUEST_BODY_CAPTURED", data }, "*");
  }

  async function responseText(response) {
    try {
      return truncate(await response.clone().text());
    } catch (error) {
      return "Response body unavailable (CORS or already consumed)";
    }
  }

  if (typeof originalFetch === "function") {
    window.fetch = async function debugPulseFetch(input, init) {
      const url = fetchUrl(input);
      const method = fetchMethod(input, init);
      const requestHeaders = fetchHeaders(input, init);
      const requestBodyPromise = requestBodyFromFetch(input, init);
      try {
        const response = await originalFetch.apply(this, arguments);
        if (response.status >= 400) {
          emit({
            url,
            method,
            requestBody: await requestBodyPromise,
            responseBody: await responseText(response),
            requestHeaders,
            responseHeaders: normalizeHeaderPairs(response.headers),
            status: response.status,
            timestamp: Date.now(),
            type: "fetch",
          });
        }
        return response;
      } catch (error) {
        emit({
          url,
          method,
          requestBody: await requestBodyPromise,
          responseBody: "",
          requestHeaders,
          responseHeaders: [],
          status: 0,
          timestamp: Date.now(),
          type: "fetch",
          error: error.message || String(error),
        });
        throw error;
      }
    };
  }

  XMLHttpRequest.prototype.open = function debugPulseOpen(method, url) {
    this.__debugPulse = {
      method: String(method || "GET").toUpperCase(),
      url: String(url),
      requestHeaders: [],
      timestamp: 0,
    };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function debugPulseSetRequestHeader(name, value) {
    if (this.__debugPulse) {
      this.__debugPulse.requestHeaders.push({ name: String(name), value: String(value) });
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function debugPulseSend(body) {
    const meta = this.__debugPulse || {
      method: "GET",
      url: "",
      requestHeaders: [],
    };
    const requestBodyPromise = bodyToText(body);

    this.addEventListener("readystatechange", async () => {
      if (this.readyState !== 4) return;
      if (this.status < 400) return;
      let responseHeaders = [];
      try {
        responseHeaders = this.getAllResponseHeaders()
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf(":");
            if (separator === -1) return { name: line, value: "" };
            return {
              name: line.slice(0, separator).trim(),
              value: line.slice(separator + 1).trim(),
            };
          });
      } catch (error) {
        responseHeaders = [{ name: "DebugPulse-Headers-Error", value: error.message || String(error) }];
      }

      let responseBody = "";
      try {
        responseBody = truncate(this.responseText || "");
      } catch (error) {
        responseBody = "Response body unavailable (CORS)";
      }

      emit({
        url: meta.url,
        method: meta.method,
        requestBody: await requestBodyPromise,
        responseBody,
        requestHeaders: meta.requestHeaders,
        responseHeaders,
        status: this.status,
        timestamp: Date.now(),
        type: "xmlhttprequest",
      });
    });

    this.addEventListener("error", async () => {
      emit({
        url: meta.url,
        method: meta.method,
        requestBody: await requestBodyPromise,
        responseBody: "",
        requestHeaders: meta.requestHeaders,
        responseHeaders: [],
        status: 0,
        timestamp: Date.now(),
        type: "xmlhttprequest",
        error: "XHR network error",
      });
    });

    return originalSend.apply(this, arguments);
  };
})();
