// Background script - handles raw diff fetching, Claude API streaming,
// and programmatic content script injection for SPA-navigated pages.
// Compatible with Firefox, Floorp, and other Firefox-based browsers.

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var ANTHROPIC_VERSION = '2023-06-01';

// --- Browser API compatibility shim ---
var _br = (
  typeof browser !== 'undefined' ? browser :
  typeof chrome  !== 'undefined' ? chrome  :
  null
);

if (!_br) {
  console.error('[PR Assistant BG] No browser extension API found.');
}

console.log('[PR Assistant BG] Background script loaded.');

// --- Programmatic content script injection ---
// GitHub uses SPA (Turbo) navigation. Manifest-declared content_scripts
// only fire on full page loads. This listener catches SPA navigations
// by watching tabs.onUpdated for URL changes to compare pages.
var COMPARE_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/compare\/.+/;

// Track which tabs we have already injected into (to avoid double-injection)
var injectedTabs = {};

function tryInject(tabId, url) {
  if (!COMPARE_RE.test(url)) {
    // Left a compare page - clear tracking
    delete injectedTabs[tabId];
    return;
  }

  if (injectedTabs[tabId]) {
    // Already injected for this tab; content.js has its own guard too
    return;
  }

  injectedTabs[tabId] = true;
  console.log('[PR Assistant BG] Injecting content script into tab', tabId, url);

  // Inject CSS first, then JS
  _br.tabs.insertCSS(tabId, { file: 'content/content.css', runAt: 'document_idle' })
    .then(function() {
      return _br.tabs.executeScript(tabId, { file: 'content/content.js', runAt: 'document_idle' });
    })
    .then(function() {
      console.log('[PR Assistant BG] Injection succeeded for tab', tabId);
    })
    .catch(function(err) {
      console.warn('[PR Assistant BG] Injection failed for tab', tabId, err.message);
      delete injectedTabs[tabId]; // allow retry
    });
}

// Listen for URL changes (catches SPA navigations + full loads)
_br.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // 'url' fires on SPA navigation, 'complete' on full loads
  if (changeInfo.url || changeInfo.status === 'complete') {
    var url = changeInfo.url || tab.url;
    if (url) tryInject(tabId, url);
  }
});

// Clean up when tabs are closed
_br.tabs.onRemoved.addListener(function(tabId) {
  delete injectedTabs[tabId];
});

// Also inject into any already-open compare tabs when the extension loads
_br.tabs.query({ url: '*://github.com/*/compare/*' }).then(function(tabs) {
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].url && COMPARE_RE.test(tabs[i].url)) {
      tryInject(tabs[i].id, tabs[i].url);
    }
  }
}).catch(function() {});

// --- Port-based streaming handler ---
_br.runtime.onConnect.addListener(function(port) {
  if (port.name !== 'pra-claude-stream') return;

  port.onMessage.addListener(function(msg) {
    if (msg.type === 'CLAUDE_REQUEST') {
      handleClaudeStream(port, msg);
    } else if (msg.type === 'FETCH_DIFF') {
      handleFetchDiff(port, msg);
    }
  });
});

// --- One-shot message handler (for non-streaming tasks) ---
_br.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'FETCH_DIFF_SYNC') {
    handleFetchDiffSync(msg.url).then(sendResponse).catch(function(err) {
      sendResponse({ error: err.message });
    });
    return true; // keep channel open for async
  }

  if (msg.type === 'OPEN_OPTIONS') {
    _br.runtime.openOptionsPage();
  }

  // Content script can signal that it is alive
  if (msg.type === 'PRA_ALIVE' && sender.tab) {
    injectedTabs[sender.tab.id] = true;
  }
});

// --- Fetch raw .diff from GitHub ---
function handleFetchDiffSync(url) {
  return fetch(url, { credentials: 'include' })
    .then(function(res) {
      if (!res.ok) throw new Error('GitHub returned ' + res.status);
      return res.text();
    })
    .then(function(text) {
      return { diff: text };
    })
    .catch(function(err) {
      return { error: err.message };
    });
}

function handleFetchDiff(port, msg) {
  fetch(msg.url, { credentials: 'include' })
    .then(function(res) {
      if (!res.ok) throw new Error('GitHub returned ' + res.status);
      return res.text();
    })
    .then(function(text) {
      port.postMessage({ type: 'DIFF_READY', diff: text });
    })
    .catch(function(err) {
      port.postMessage({ type: 'ERROR', error: err.message });
    });
}

// --- Stream Claude API response ---
function handleClaudeStream(port, msg) {
  var apiKey = msg.apiKey;
  var model = msg.model;
  var systemPrompt = msg.systemPrompt;
  var diff = msg.diff;
  var repoContext = msg.repoContext;

  var userMessage = buildUserMessage(diff, repoContext);

  fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      max_tokens: 1500,
      stream: true,
      system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  })
  .then(function(res) {
    if (!res.ok) {
      return res.text().then(function(errorBody) {
        port.postMessage({ type: 'ERROR', error: 'API error ' + res.status + ': ' + errorBody });
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function readChunk() {
      return reader.read().then(function(result) {
        if (result.done) {
          port.postMessage({ type: 'DONE' });
          return;
        }

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') !== 0) continue;
          var data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            var event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
              port.postMessage({ type: 'CHUNK', text: event.delta.text });
            } else if (event.type === 'message_stop') {
              port.postMessage({ type: 'DONE' });
            }
          } catch (e) {
            // skip malformed SSE lines
          }
        }

        return readChunk();
      });
    }

    return readChunk();
  })
  .catch(function(err) {
    port.postMessage({ type: 'ERROR', error: err.message });
  });
}

// --- Prompt builders ---
var DEFAULT_SYSTEM_PROMPT = 'Based on this diff, write a concise PR title and a description in markdown. Output as:\nTITLE: <title>\nBODY:\n<description>';

function buildUserMessage(diff, ctx) {
  var parts = [];
  if (ctx) {
    parts.push('Repository: ' + ctx.repo);
    parts.push('Base branch: ' + ctx.base);
    parts.push('Head branch: ' + ctx.head);
    if (ctx.commits && ctx.commits.length) {
      parts.push('\nCommit messages:\n' + ctx.commits.map(function(c) { return '- ' + c; }).join('\n'));
    }
    if (ctx.filesChanged !== undefined) {
      parts.push('Files changed: ' + ctx.filesChanged);
    }
  }
  parts.push('\n--- git diff ---\n' + diff);
  return parts.join('\n');
}
