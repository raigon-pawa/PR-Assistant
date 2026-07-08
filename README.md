# GitHub PR Assistant — Firefox / Floorp Extension

A powerful, pure-JS WebExtension that injects a floating panel into GitHub compare pages, letting you generate high-quality PR titles and descriptions in two modes:

1. **Generate JSON** — exports a structured diff payload for use in any external tool
2. **Use Claude API** — streams a PR title + description directly from Anthropic's Claude API **and auto-fills them into GitHub's PR form**.

---

## ✨ Features

- **🪄 Magic Auto-Fill**: Watches the Claude stream and magically types the generated Title and Description directly into GitHub's actual PR creation textboxes (`?expand=1` page support).
- **🤖 Dynamic Model Fetching**: Click "Fetch available models" in the settings to hit the Anthropic API and instantly populate the dropdown with all available models (including `claude-3-5-haiku-latest`).
- **🗂️ Persistent UI**: The injected widget remembers whether you left it expanded or collapsed across page loads and SPA navigations.
- **🛡️ Flatpak & Floorp Compatible**: 100% pure ASCII ES5 JavaScript. No build steps, no webpack, no modern JS syntax that trips up older SpiderMonkey parsers. Perfectly compatible with Firefox forks like Floorp.
- **🔄 SPA Support**: Gracefully handles GitHub's Turbo/SPA navigations using `tabs.onUpdated` injection.

---

## Installation (Load Unpacked)

Since this extension is not yet published on the Mozilla Add-ons store, you will need to load it as a temporary extension.

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/raigon-pawa/PR-Assistant.git
   ```
2. Open your Firefox or Floorp browser and navigate to `about:debugging`.
3. Click **"This Firefox"** (or "This Floorp") in the left sidebar.
4. Click **"Load Temporary Add-on…"**.
5. Navigate to the directory where you cloned the repository and select the **`manifest.json`** file.

> **Note**: Temporary add-ons are removed when the browser restarts. For permanent installation, you can sign the extension via [addons.mozilla.org](https://addons.mozilla.org/).

> **Flatpak Users**: If you are using a sandboxed browser (like a Flatpak version), make sure the repository is cloned into a visible directory (like `~/Downloads` or `~/Documents`), as Flatpak browsers cannot read from hidden directories.

---

## Usage

### Set Up Your API Key
1. Click the **✦ PR Assistant** icon in the toolbar
2. Click **⚙ Settings**
3. Paste your Anthropic API key (`sk-ant-...`)
4. Click **↻ Fetch available models** to pull the latest models from Anthropic, then select your preferred model.
5. Customize the System Prompt if desired.
6. Click **Save Settings**.

### On a GitHub Compare Page
Navigate to any GitHub compare page. The extension smartly matches all compare routes, including explicit branches and implicit bases:
- `github.com/owner/repo/compare/main...feat-branch`
- `github.com/owner/repo/compare/feat-branch?expand=1` (The "Create PR" page)

The floating **✦ PR Assistant** panel will appear in the bottom-right corner.

---

## Panel Actions

| Button | Description |
|---|---|
| **{ } Generate JSON** | Fetches the raw `.diff` from GitHub and exports a structured JSON payload containing repo info, commit messages, file list, and full diff. |
| **✦ Use Claude API** | Fetches the raw diff, sends it to Claude, and streams back a PR title + description in Markdown format. Automatically types the result into the GitHub form! |

---

## File Structure

```
pr-assistant/
├── manifest.json            # MV2 manifest (persistent background script)
├── README.md
├── icons/
│   ├── icon-48.png          # Toolbar icon (48x48)
│   └── icon-48.png          # Toolbar icon (96x96)
├── background/
│   └── background.js        # Handles Anthropic API CORS & SPA injection
├── content/
│   ├── content.js           # Injected panel, auto-fill, diff parsing
│   └── content.css          # Glassmorphism panel styles
├── popup/
│   ├── popup.html           # Toolbar popup
│   ├── popup.js             
│   └── popup.css
└── options/
    ├── options.html         # Settings page
    ├── options.js
    └── options.css
```

---

## How It Works Under the Hood

- **Diff Fetching**: Instead of scraping the DOM, the background script quietly fetches `https://github.com/.../compare/....diff`, ensuring the *entire* diff is captured, even for massive PRs where GitHub normally truncates the UI.
- **Anthropic Security Headers**: Automatically attaches the `anthropic-dangerous-direct-browser-access: true` header to bypass CORS restrictions when making client-side requests to Claude's API.
- **Cross-Origin Streaming**: Opens an SSE stream to `api.anthropic.com/v1/messages` inside the `background.js` script, and pipelines the text delta chunks back to `content.js` via a `browser.runtime.connect()` port to achieve real-time streaming inside the GitHub page without triggering CSP blocks.

---

## Privacy
- ✅ No telemetry or analytics
- ✅ API key stored entirely locally (`browser.storage.local`)
- ✅ Diff data sent only to Anthropic's official API
- ✅ Open source & pure JavaScript
