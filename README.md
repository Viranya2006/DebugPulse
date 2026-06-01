# DebugPulse

DebugPulse is a Manifest V3 Chrome Extension for developers and QA engineers. It watches failed API requests in the inspected tab, captures request and response context, and uses Groq to explain what went wrong and how to fix it.

## Features

- Captures failed `fetch` and `XMLHttpRequest` calls.
- Tracks HTTP `4xx`, `5xx`, and network errors.
- Merges Chrome `webRequest` metadata with page-level request and response bodies.
- Stores the latest 50 failures locally in `chrome.storage.local`.
- Adds a DevTools panel with filters, request details, headers, bodies, and AI analysis.
- Includes a popup for pause/resume, recent failures, request count, and Groq API key settings.
- Uses Groq's OpenAI-compatible chat completions endpoint with `llama-3.3-70b-versatile`.
- No npm build step required.

## Project Structure

```text
debugpulse/
├── manifest.json
├── background.js
├── content.js
├── page-hook.js
├── devtools.html
├── devtools.js
├── panel.html
├── panel.js
├── popup.html
├── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── styles/
    └── panel.css

tests/
└── validate-extension.js
```

## Install Locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `debugpulse` folder from this repository.
5. Open DevTools on any page and select the **DebugPulse** panel.

## Groq API Key

DebugPulse does not hardcode an API key. Add your key from either:

- the DevTools panel settings drawer, or
- the toolbar popup settings section.

The key is stored in `chrome.storage.local` under `groqApiKey`.

## Usage

1. Load the extension unpacked.
2. Open DevTools on a page you want to inspect.
3. Select the **DebugPulse** panel.
4. Trigger an API failure from the page.
5. Select the failed request in DebugPulse.
6. Open **AI Analysis** to generate the Groq explanation.

## How It Works

- `background.js` listens to `chrome.webRequest` events for completed failed requests and network errors.
- `page-hook.js` runs in the page's main JavaScript world and patches `fetch` and `XMLHttpRequest` to capture request and response bodies.
- `content.js` bridges messages from the page hook to the extension service worker.
- `panel.js` renders the DevTools UI and calls Groq for analysis.
- `popup.js` manages quick settings and recent failures.

Chrome `webRequest` cannot read request or response bodies, so DebugPulse combines `webRequest` metadata with body captures from the page hook.

## Privacy Notes

DebugPulse stores captured failures and the Groq API key locally using Chrome extension storage. Failed request data is sent to Groq only when you open AI Analysis or ask a follow-up question.

Be careful when debugging production systems. Request headers and bodies may contain secrets, tokens, personal data, or customer data.

## Validate

Run the static validator:

```bash
node tests/validate-extension.js
```

Expected output:

```text
DebugPulse extension validation passed.
```

You can also syntax-check the extension scripts:

```bash
node --check debugpulse/background.js
node --check debugpulse/content.js
node --check debugpulse/page-hook.js
node --check debugpulse/devtools.js
node --check debugpulse/panel.js
node --check debugpulse/popup.js
```

## Development Notes

- This extension intentionally uses plain JavaScript, HTML, and CSS.
- Extension pages do not load Tailwind or highlight.js from CDNs because Manifest V3 extension pages cannot execute remote scripts.
- The UI styling is implemented locally in `debugpulse/styles/panel.css`.
- The Groq endpoint used is `https://api.groq.com/openai/v1/chat/completions`.
- The model used is `llama-3.3-70b-versatile`.

## License

Add a license before publishing if this repository will be public.
