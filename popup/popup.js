'use strict';

// --- Browser API compatibility shim ---
var _br = (
  typeof browser !== 'undefined' ? browser :
  typeof chrome  !== 'undefined' ? chrome  :
  null
);

var elDot        = document.getElementById('pop-dot');
var elStatusText = document.getElementById('pop-status-text');
var elInfo       = document.getElementById('pop-info');
var elNotCompare = document.getElementById('pop-not-compare');
var elRepo       = document.getElementById('pop-repo');
var elCompare    = document.getElementById('pop-compare');
var elSettings   = document.getElementById('pop-settings-btn');

// --- Open settings ---
elSettings.addEventListener('click', function() {
  _br.runtime.openOptionsPage();
});

// --- Query active tab ---
_br.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
  var tab = tabs[0];
  if (!tab || !tab.url) return setInactive('No active tab');

  var match = tab.url.match(/github\.com\/([^/]+\/[^/]+)\/compare\/(.+)/);
  if (!match) {
    setInactive('Not a compare page');
    elNotCompare.style.display = 'block';
    return;
  }

  var repo = match[1];
  // Remove query parameters or hashes
  var compareString = match[2].split('?')[0].split('#')[0];

  var base, head;
  if (compareString.indexOf('...') !== -1) {
    var parts = compareString.split('...');
    base = decodeURIComponent(parts[0]);
    head = decodeURIComponent(parts[1]);
  } else {
    base = 'default';
    head = decodeURIComponent(compareString);
  }

  elDot.className = 'pop-status-dot'; // green pulse
  elStatusText.textContent = 'Active on this page';
  elInfo.style.display = 'flex';
  elRepo.textContent = repo;
  elCompare.textContent = base + ' ... ' + head;
});

function setInactive(msg) {
  elDot.classList.add('inactive');
  elStatusText.textContent = msg;
  elStatusText.style.color = '#64748b';
}
