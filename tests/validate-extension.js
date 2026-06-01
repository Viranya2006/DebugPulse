const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..", "debugpulse");

const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "page-hook.js",
  "devtools.html",
  "devtools.js",
  "panel.html",
  "panel.js",
  "popup.html",
  "popup.js",
  "styles/panel.css",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `Missing required file: ${file}`);
}

const manifest = JSON.parse(read("manifest.json"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.name === "DebugPulse", "manifest name must be DebugPulse");
assert(manifest.background?.service_worker === "background.js", "background service worker must be background.js");
assert(manifest.devtools_page === "devtools.html", "devtools_page must be devtools.html");
assert(manifest.host_permissions?.includes("<all_urls>"), "host_permissions must include <all_urls>");
assert(manifest.permissions?.includes("webRequest"), "permissions must include webRequest");
assert(manifest.permissions?.includes("storage"), "permissions must include storage");
assert(manifest.permissions?.includes("scripting"), "permissions must include scripting");

const webResources = JSON.stringify(manifest.web_accessible_resources || []);
assert(webResources.includes("page-hook.js"), "page-hook.js must be web accessible for main-world injection");

for (const htmlFile of ["panel.html", "popup.html", "devtools.html"]) {
  const html = read(htmlFile);
  assert(!/https?:\/\//i.test(html), `${htmlFile} must not load remote CDN assets`);
}

const background = read("background.js");
assert(background.includes("debugpulse_failures"), "background must use debugpulse_failures storage key");
assert(background.includes("chrome.webRequest.onCompleted"), "background must listen for completed requests");
assert(background.includes("chrome.webRequest.onErrorOccurred"), "background must listen for network errors");
assert(background.includes("extraHeaders"), "background must request extraHeaders for sensitive headers");

const content = read("content.js");
assert(content.includes("page-hook.js"), "content must inject page-hook.js");
assert(content.includes("REQUEST_BODY_CAPTURED"), "content must forward REQUEST_BODY_CAPTURED messages");

const pageHook = read("page-hook.js");
assert(pageHook.includes("window.fetch"), "page hook must patch fetch");
assert(pageHook.includes("XMLHttpRequest.prototype.open"), "page hook must patch XHR open");
assert(pageHook.includes("XMLHttpRequest.prototype.send"), "page hook must patch XHR send");

const panel = read("panel.js");
assert(panel.includes("https://api.groq.com/openai/v1/chat/completions"), "panel must call Groq chat completions endpoint");
assert(panel.includes("llama-3.3-70b-versatile"), "panel must use the requested Groq model");
assert(panel.includes("conversationHistory"), "panel must maintain follow-up conversation history");
assert(panel.includes("response_format"), "panel must request JSON object responses for structured analysis");
assert(panel.includes("analysisError"), "panel must show the real AI analysis error instead of a generic key message");

for (const jsFile of ["background.js", "content.js", "page-hook.js", "devtools.js", "panel.js", "popup.js"]) {
  const code = read(jsFile);
  new vm.Script(code, { filename: jsFile });
}

for (const icon of ["icon16.png", "icon48.png", "icon128.png"]) {
  const bytes = fs.readFileSync(path.join(root, "icons", icon));
  assert(bytes.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${icon} must be a PNG`);
}

console.log("DebugPulse extension validation passed.");
