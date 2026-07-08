/**
 * content.js - Injected into github.com/[owner]/[repo]/compare/... pages
 *
 * Responsibilities:
 *  1. Parse page URL and DOM for repo context (repo, base, head, commits)
 *  2. Inject the floating PR Assistant panel
 *  3. Handle "Generate JSON" - fetch raw diff - build JSON blob
 *  4. Handle "Use Claude API" - stream from background - render result
 *
 * Compatibility: Firefox, Floorp, and other Firefox-based browsers.
 */

(function () {
  'use strict';

  // --- Browser API compatibility shim ---
  // Firefox exposes browser, Chrome-compat forks may only expose chrome.
  // Some Floorp builds bridge both; this shim handles all cases.
  var _br = (
    typeof browser !== 'undefined' ? browser :
    typeof chrome  !== 'undefined' ? chrome  :
    null
  );

  if (!_br) {
    console.error('[PR Assistant] No browser extension API found. Extension cannot run.');
    return;
  }

  // Prevent double-injection
  if (document.getElementById('pra-panel')) {
    console.log('[PR Assistant] Panel already exists, skipping re-injection.');
    return;
  }

  console.log('[PR Assistant] Content script loaded on', location.href);

  // Signal to background that we are alive in this tab
  try { _br.runtime.sendMessage({ type: 'PRA_ALIVE' }); } catch (e) {}

  // --- URL Parsing ---
  function parseCompareURL() {
    // Matches: github.com/{owner}/{repo}/compare/{branch_or_compare_string}
    var match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/compare\/(.+)/);
    if (!match) return null;

    var owner = match[1];
    var repo = match[1] + '/' + match[2];
    var repoSlug = match[2];
    var compareString = match[3];

    var base, head;
    if (compareString.indexOf('...') !== -1) {
      var parts = compareString.split('...');
      base = decodeURIComponent(parts[0]);
      head = decodeURIComponent(parts[1]);
    } else {
      // If there's no '...', the base is implicitly the default branch.
      // E.g., /compare/feat-branch
      base = 'default';
      head = decodeURIComponent(compareString);
    }

    return {
      owner: owner,
      repo: repo,
      repoSlug: repoSlug,
      base: base,
      head: head,
      // location.pathname cleanly drops query params like ?expand=1
      rawDiffUrl: location.origin + location.pathname + '.diff'
    };
  }

  var ctx = parseCompareURL();
  if (!ctx) {
    console.warn('[PR Assistant] URL did not match compare pattern:', location.pathname);
    return;
  }

  // --- DOM Helpers ---
  function getCommits() {
    var commitEls = document.querySelectorAll(
      '.commit-message, [data-testid="commit-list-item"] .markdown-title, .commits-listing .message'
    );
    var results = [];
    for (var i = 0; i < commitEls.length && i < 30; i++) {
      var text = commitEls[i].textContent.trim();
      if (text) results.push(text);
    }
    return results;
  }

  function getFilesChangedCount() {
    var el = document.querySelector(
      '#files_tab_counter, .toc-diff-stats strong, [data-testid="files-changed-count"]'
    );
    return el ? (parseInt(el.textContent.trim(), 10) || null) : null;
  }

  // --- Panel HTML ---
  function createPanel() {
    var panel = document.createElement('div');
    panel.id = 'pra-panel';
    panel.innerHTML = [
      '<div id="pra-header" title="Click to expand/collapse">',
      '  <div class="pra-logo" style="font-size: 16px; line-height: 1; padding-top: 2px;">✦</div>',
      '  <div style="flex:1;min-width:0">',
      '    <div class="pra-title">PR Assistant</div>',
      '  </div>',
      '  <button class="pra-toggle-btn" id="pra-toggle" title="Toggle panel">&#9662;</button>',
      '</div>',
      '<div id="pra-body">',
      '  <div class="pra-context" id="pra-context">',
      '    <div class="pra-pill"><span>' + ctx.repo + '</span></div>',
      '    <div class="pra-pill">base: <span>' + ctx.base + '</span></div>',
      '    <div class="pra-pill">head: <span>' + ctx.head + '</span></div>',
      '  </div>',
      '  <div class="pra-actions">',
      '    <button class="pra-btn pra-btn-json" id="pra-btn-json">',
      '      <span class="pra-btn-icon">{ }</span>',
      '      Generate JSON',
      '    </button>',
      '    <button class="pra-btn pra-btn-claude" id="pra-btn-claude">',
      '      <span class="pra-btn-icon">AI</span>',
      '      Use Claude API',
      '    </button>',
      '  </div>',
      '  <div id="pra-model-display" style="text-align: right; font-size: 11px; color: #8b949e; margin-top: 4px; padding-right: 4px;"></div>',
      '  <div class="pra-status" id="pra-status">',
      '    <div class="pra-status-dot" id="pra-status-dot"></div>',
      '    <span id="pra-status-text">Ready - click an action above</span>',
      '  </div>',
      '  <div class="pra-output" id="pra-output">',
      '    <div class="pra-divider"></div>',
      '    <div id="pra-title-section" style="display:none;flex-direction:column;gap:6px">',
      '      <div class="pra-result-title-label">PR Title</div>',
      '      <div class="pra-result-title-box" id="pra-result-title">-</div>',
      '      <div class="pra-copy-row">',
      '        <button class="pra-copy-btn" id="pra-copy-title">Copy title</button>',
      '      </div>',
      '    </div>',
      '    <div style="display:flex;flex-direction:column;gap:6px">',
      '      <div class="pra-result-desc-label" id="pra-output-label">Output</div>',
      '      <textarea class="pra-result-textarea" id="pra-result-body" readonly rows="8"',
      '        placeholder="Result will appear here..."></textarea>',
      '      <div class="pra-copy-row">',
      '        <button class="pra-copy-btn" id="pra-copy-body">Copy</button>',
      '        <button class="pra-copy-btn" id="pra-download-json" style="display:none">Download</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');
    return panel;
  }

  // --- Inject Panel ---
  var panel = createPanel();
  document.body.appendChild(panel);

  console.log('[PR Assistant] Panel injected successfully.');

  // --- Element refs ---
  var elToggle       = panel.querySelector('#pra-toggle');
  var elHeader       = panel.querySelector('#pra-header');
  var elBtnJson      = panel.querySelector('#pra-btn-json');
  var elBtnClaude    = panel.querySelector('#pra-btn-claude');
  var elStatusDot    = panel.querySelector('#pra-status-dot');
  var elStatusText   = panel.querySelector('#pra-status-text');
  var elOutput       = panel.querySelector('#pra-output');
  var elTitleSection = panel.querySelector('#pra-title-section');
  var elResultTitle  = panel.querySelector('#pra-result-title');
  var elResultBody   = panel.querySelector('#pra-result-body');
  var elOutputLabel  = panel.querySelector('#pra-output-label');
  var elCopyTitle    = panel.querySelector('#pra-copy-title');
  var elCopyBody     = panel.querySelector('#pra-copy-body');
  var elDownloadJson = panel.querySelector('#pra-download-json');
  var elModelDisplay = panel.querySelector('#pra-model-display');

  // --- Toggle collapse ---
  var collapsed = false;
  function setCollapsedState(isCollapsed) {
    collapsed = isCollapsed;
    panel.classList.toggle('pra-collapsed', collapsed);
    elToggle.innerHTML = collapsed ? '&#9656;' : '&#9662;';
  }

  function togglePanel() {
    setCollapsedState(!collapsed);
    _br.storage.local.set({ panelCollapsed: collapsed });
  }

  elHeader.addEventListener('click', function(e) {
    if (e.target === elToggle || elToggle.contains(e.target)) return;
    togglePanel();
  });
  elToggle.addEventListener('click', togglePanel);

  // Load selected model and panel state on startup
  _br.storage.local.get(['claudeModel', 'panelCollapsed']).then(function(settings) {
    if (settings.claudeModel) {
      elModelDisplay.textContent = 'Model: ' + settings.claudeModel;
    }
    if (settings.panelCollapsed) {
      setCollapsedState(true);
    }
  });

  // --- Status helpers ---
  function setStatus(text, state) {
    state = state || 'idle';
    elStatusText.textContent = text;
    var cls = 'pra-status-dot';
    if (state === 'loading') cls += ' pra-loading';
    else if (state === 'error') cls += ' pra-error';
    elStatusDot.className = cls;
  }

  function showOutput(showTitle) {
    elOutput.classList.add('pra-visible');
    elTitleSection.style.display = showTitle ? 'flex' : 'none';
  }

  function resetOutput() {
    elOutput.classList.remove('pra-visible');
    elResultTitle.textContent = '-';
    elResultBody.value = '';
    elTitleSection.style.display = 'none';
    elDownloadJson.style.display = 'none';
  }

  function setBusy(busy) {
    elBtnJson.disabled = busy;
    elBtnClaude.disabled = busy;
  }

  // --- Copy helpers ---
  function makeCopy(btn, getText, defaultLabel) {
    btn.addEventListener('click', function() {
      navigator.clipboard.writeText(getText()).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('pra-copied');
        setTimeout(function() {
          btn.textContent = defaultLabel;
          btn.classList.remove('pra-copied');
        }, 2000);
      });
    });
  }
  makeCopy(elCopyTitle, function() { return elResultTitle.textContent; }, 'Copy title');
  makeCopy(elCopyBody, function() { return elResultBody.value; }, 'Copy');

  // --- Fetch raw diff via background ---
  function fetchRawDiff() {
    return new Promise(function(resolve, reject) {
      _br.runtime.sendMessage(
        { type: 'FETCH_DIFF_SYNC', url: ctx.rawDiffUrl },
        function(response) {
          if (_br.runtime.lastError) return reject(new Error(_br.runtime.lastError.message));
          if (response && response.error) return reject(new Error(response.error));
          resolve(response.diff);
        }
      );
    });
  }

  // --- BUILD JSON ---
  elBtnJson.addEventListener('click', function() {
    resetOutput();
    setBusy(true);
    setStatus('Fetching diff...', 'loading');

    fetchRawDiff().then(function(diff) {
      var commits = getCommits();
      var filesChanged = getFilesChangedCount();

      // Parse file names from diff header lines
      var filesFromDiff = [];
      var re = /^diff --git a\/(.+?) b\/.+$/gm;
      var m;
      while ((m = re.exec(diff)) !== null) {
        filesFromDiff.push(m[1]);
      }

      var payload = {
        repo: ctx.repo,
        base: ctx.base,
        head: ctx.head,
        commits: commits,
        files_changed: filesFromDiff.length || filesChanged || 'unknown',
        file_list: filesFromDiff,
        diff: diff,
        generated_at: new Date().toISOString()
      };

      var jsonStr = JSON.stringify(payload, null, 2);
      elOutputLabel.textContent = 'JSON Payload';
      elResultBody.value = jsonStr;
      showOutput(false);
      elDownloadJson.style.display = 'inline-flex';
      elCopyBody.textContent = 'Copy JSON';

      // Download handler
      elDownloadJson.onclick = function() {
        var blob = new Blob([jsonStr], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pr-diff-' + ctx.repoSlug + '-' + Date.now() + '.json';
        a.click();
      };

      setStatus('Done - ' + filesFromDiff.length + ' files, ' + (jsonStr.length / 1024).toFixed(1) + ' KB', 'idle');
      setBusy(false);
    }).catch(function(err) {
      setStatus('Error: ' + err.message, 'error');
      setBusy(false);
    });
  });

  // --- USE CLAUDE API ---
  elBtnClaude.addEventListener('click', function() {
    // 1. Check for API key and settings
    _br.storage.local.get(['claudeApiKey', 'claudeModel', 'claudeSystemPrompt']).then(function(settings) {
      var claudeApiKey = settings.claudeApiKey;
      var claudeModel = settings.claudeModel;
      var claudeSystemPrompt = settings.claudeSystemPrompt;

      if (!claudeApiKey) {
        setStatus('No API key set', 'error');
        showApiKeyWarning();
        return;
      }
      
      if (claudeModel) {
        elModelDisplay.textContent = 'Model: ' + claudeModel;
      }

      resetOutput();
      setBusy(true);
      setStatus('Fetching diff...', 'loading');

      fetchRawDiff().then(function(diff) {
        var commits = getCommits();
        var filesChanged = getFilesChangedCount();

        // Truncate diff if very large (Claude context limit awareness)
        var MAX_DIFF_CHARS = 80000;
        var truncated = diff.length > MAX_DIFF_CHARS;
        var diffPayload = truncated ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated for length...]' : diff;

        setStatus('Generating with Claude...', 'loading');
        elOutputLabel.textContent = 'Claude Response';
        elResultBody.value = '';
        showOutput(true);
        elResultTitle.textContent = '...generating...';

        // Open streaming port
        var port = _br.runtime.connect({ name: 'pra-claude-stream' });
        var fullText = '';

        port.onMessage.addListener(function(msg) {
          if (msg.type === 'CHUNK') {
            fullText += msg.text;
            renderClaudeResponse(fullText);
          } else if (msg.type === 'DONE') {
            port.disconnect();
            setBusy(false);
            setStatus('Done' + (truncated ? ' (diff was truncated)' : ''), 'idle');
            elCopyBody.textContent = 'Copy description';
          } else if (msg.type === 'ERROR') {
            port.disconnect();
            setBusy(false);
            setStatus('Error: ' + msg.error, 'error');
            elResultBody.value = 'Error: ' + msg.error;
          }
        });

        port.postMessage({
          type: 'CLAUDE_REQUEST',
          apiKey: claudeApiKey,
          model: claudeModel || 'claude-sonnet-4-5',
          systemPrompt: claudeSystemPrompt, // PASS THE CUSTOM PROMPT
          diff: diffPayload,
          repoContext: { repo: ctx.repo, base: ctx.base, head: ctx.head, commits: commits, filesChanged: filesChanged }
        });

      }).catch(function(err) {
        setStatus('Error: ' + err.message, 'error');
        setBusy(false);
      });
    });
  });

  // --- Parse and render Claude streamed response ---
  function renderClaudeResponse(text) {
    var newTitle = '';
    var newBody = '';

    // Extract TITLE (supports both PR_TITLE and just TITLE)
    var titleMatch = text.match(/(?:PR_)?TITLE:\s*\*?\*?([^\n]+?)\*?\*?(?:\r?\n|$)/i);
    if (titleMatch) {
      newTitle = titleMatch[1].trim();
      // Remove any surrounding backticks or quotes if Claude added them
      newTitle = newTitle.replace(/^[`"']|[`"']$/g, '');
      elResultTitle.textContent = newTitle;
    }

    // Extract BODY (supports PR_DESCRIPTION and BODY)
    var descMatch = text.match(/(?:PR_DESCRIPTION|BODY):\s*([\s\S]*)/i);
    if (descMatch) {
      newBody = descMatch[1].trim();
      elResultBody.value = newBody;
    } else if (!titleMatch) {
      // If format not yet parsed, show raw
      elResultBody.value = text;
      newBody = text;
    }

    // Auto-fill GitHub's actual PR fields if they exist on this page
    var ghTitle = document.querySelector('input[name="pull_request[title]"]');
    var ghBody = document.querySelector('textarea[name="pull_request[body]"]');
    
    // Fallbacks just in case GitHub changes their DOM again
    if (!ghTitle) ghTitle = document.getElementById('pull_request_title');
    if (!ghBody) ghBody = document.getElementById('pull_request_body');
    
    if (ghTitle && newTitle) {
      ghTitle.value = newTitle;
      // Trigger input event so GitHub's character counter/validation updates
      ghTitle.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    if (ghBody && newBody) {
      ghBody.value = newBody;
      ghBody.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // --- API key warning ---
  function showApiKeyWarning() {
    // Remove existing warning if any
    var existing = panel.querySelector('.pra-warning');
    if (existing) existing.remove();

    var warning = document.createElement('div');
    warning.className = 'pra-warning';
    warning.innerHTML = 'No Anthropic API key saved. <a id="pra-open-options">Open settings</a>';
    panel.querySelector('#pra-body').appendChild(warning);

    warning.querySelector('#pra-open-options').addEventListener('click', function() {
      _br.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });
  }

})();
