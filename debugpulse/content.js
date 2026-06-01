(function () {
  "use strict";

  const SOURCE = "DebugPulsePageHook";

  function injectHook() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.async = false;
    script.onload = () => script.remove();
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE) return;
    if (event.data?.type !== "REQUEST_BODY_CAPTURED") return;
    chrome.runtime.sendMessage({
      type: "REQUEST_BODY_CAPTURED",
      data: event.data.data,
    }).catch(() => {});
  });

  try {
    injectHook();
  } catch (error) {
    console.warn("DebugPulse failed to inject page hook", error);
  }
})();
