'use strict';

// --- Browser API compatibility shim ---
var _br = (
  typeof browser !== 'undefined' ? browser :
  typeof chrome  !== 'undefined' ? chrome  :
  null
);

var elApiKey     = document.getElementById('api-key');
var elRevealBtn  = document.getElementById('reveal-btn');
var elModelSel   = document.getElementById('model-select');
var elSysPrompt  = document.getElementById('system-prompt');
var elResetBtn   = document.getElementById('reset-prompt');
var elSaveBtn    = document.getElementById('save-btn');
var elSaveStatus = document.getElementById('save-status');

// --- Load saved settings ---
_br.storage.local.get(['claudeApiKey', 'claudeModel', 'claudeSystemPrompt'])
  .then(function(data) {
    if (data.claudeApiKey)       elApiKey.value    = data.claudeApiKey;
    if (data.claudeModel)        elModelSel.value  = data.claudeModel;
    if (data.claudeSystemPrompt) elSysPrompt.value = data.claudeSystemPrompt;
  });

// --- Reveal toggle ---
elRevealBtn.addEventListener('click', function() {
  var isPassword = elApiKey.type === 'password';
  elApiKey.type = isPassword ? 'text' : 'password';
  elRevealBtn.textContent = isPassword ? 'Hide' : 'Show';
});

// --- Fetch Models ---
var elFetchBtn = document.getElementById('fetch-models-btn');
if (elFetchBtn) {
  elFetchBtn.addEventListener('click', function() {
    var key = elApiKey.value.trim();
    if (!key) {
      showStatus('Please enter an API key first', 'error');
      return;
    }
    
    elFetchBtn.textContent = 'Fetching...';
    elFetchBtn.disabled = true;
    
    fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    })
    .then(function(res) {
      if (!res.ok) throw new Error('API Error ' + res.status);
      return res.json();
    })
    .then(function(data) {
      if (!data.data || !data.data.length) throw new Error('No models returned');
      
      var currentVal = elModelSel.value;
      elModelSel.innerHTML = '';
      
      // Sort models to put newer ones first roughly
      var models = data.data.sort(function(a, b) {
        return b.id.localeCompare(a.id);
      });
      
      for (var i = 0; i < models.length; i++) {
        var opt = document.createElement('option');
        opt.value = models[i].id;
        opt.textContent = models[i].id + ' (' + models[i].type + ')';
        elModelSel.appendChild(opt);
      }
      
      // Keep selected value if it still exists
      var optionExists = Array.prototype.some.call(elModelSel.options, function(o) { return o.value === currentVal; });
      if (optionExists) elModelSel.value = currentVal;
      
      showStatus('Fetched ' + models.length + ' models!', 'success');
    })
    .catch(function(err) {
      showStatus('Failed to fetch: ' + err.message, 'error');
    })
    .finally(function() {
      elFetchBtn.textContent = '↻ Fetch available models';
      elFetchBtn.disabled = false;
    });
  });
}

// --- Reset system prompt ---
elResetBtn.addEventListener('click', function() {
  elSysPrompt.value = '';
  showStatus('Reset to default prompt', 'success');
});

// --- Save ---
elSaveBtn.addEventListener('click', function() {
  var key = elApiKey.value.trim();

  if (!key) {
    showStatus('API key is required', 'error');
    elApiKey.focus();
    return;
  }

  if (key.indexOf('sk-ant-') !== 0) {
    showStatus('Key should start with sk-ant-', 'error');
    return;
  }

  _br.storage.local.set({
    claudeApiKey: key,
    claudeModel: elModelSel.value,
    claudeSystemPrompt: elSysPrompt.value.trim()
  }).then(function() {
    showStatus('Settings saved', 'success');
  }).catch(function(err) {
    showStatus('Error: ' + err.message, 'error');
  });
});

function showStatus(msg, type) {
  elSaveStatus.textContent = msg;
  elSaveStatus.className = 'opts-save-status ' + type;
  setTimeout(function() {
    elSaveStatus.textContent = '';
    elSaveStatus.className = 'opts-save-status';
  }, 3000);
}
