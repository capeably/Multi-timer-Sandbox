// ===== UI =====
// Depends on: timer.js, storage.js, audio.js

// ===== Helpers =====
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(ms) {
  var s = Math.floor(ms / 1000);
  var h = Math.floor(s / 3600); s %= 3600;
  var m = Math.floor(s / 60); s %= 60;
  var parts = [];
  if (h > 0) parts.push(h + 'h');
  if (m > 0) parts.push(m + 'm');
  if (s > 0 || parts.length === 0) parts.push(s + 's');
  return parts.join(' ');
}

function isLightColor(hex) {
  hex = hex.replace('#', '');
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
}

function applyTitleBarColors(card, color) {
  var titleBar = card.querySelector('.timer-title-bar');
  var title = card.querySelector('.timer-title');
  var handle = card.querySelector('.drag-handle');
  var fill = card.querySelector('.progress-bar-fill');
  titleBar.style.background = color;
  if (fill) fill.style.background = color;
  if (isLightColor(color)) {
    title.style.color = '#333';
    title.style.textShadow = 'none';
    handle.style.color = 'rgba(0,0,0,0.4)';
  } else {
    title.style.color = '#fff';
    title.style.textShadow = '0 1px 2px rgba(0,0,0,0.15)';
    handle.style.color = 'rgba(255,255,255,0.7)';
  }
}

function getSoundDisplayValue(soundKey) {
  if (soundKey.startsWith('msg:') || soundKey.startsWith('cmsg:') || soundKey.startsWith('csnd:')) return soundKey;
  return 'sound:' + soundKey;
}

function getSoundLabel(soundKey) {
  if (soundKey === 'alarm') return 'Alarm';
  if (soundKey === 'bells') return 'Bells';
  if (soundKey === 'ding') return 'Ding';
  if (soundKey === 'klaxon') return 'Klaxon';
  if (soundKey.startsWith('msg:')) return soundKey.slice(4);
  if (soundKey.startsWith('cmsg:')) {
    var msgs = loadCustomMessages();
    var m = msgs.find(function(x) { return x.id === soundKey.slice(5); });
    return m ? m.name || m.text : 'Unknown';
  }
  if (soundKey.startsWith('csnd:')) {
    var snds = loadCustomSounds();
    var s = snds.find(function(x) { return x.id === soundKey.slice(5); });
    return s ? s.name : 'Unknown';
  }
  return soundKey;
}

// ===== Dropdown Synchronization =====
function buildDropdownHTML() {
  var html = '<optgroup label="Time Presets">';
  html += '<option value="60000">1 minute</option>';
  html += '<option value="300000">5 minutes</option>';
  html += '<option value="600000">10 minutes</option>';
  html += '<option value="900000">15 minutes</option>';
  html += '<option value="1800000">30 minutes</option>';
  html += '<option value="2700000">45 minutes</option>';
  html += '<option value="3600000">1 hour</option>';
  html += '</optgroup>';
  html += '<optgroup label="Sounds">';
  html += '<option value="sound:alarm">Alarm</option>';
  html += '<option value="sound:bells">Bells</option>';
  html += '<option value="sound:ding">Ding</option>';
  html += '<option value="sound:klaxon">Klaxon</option>';
  html += '</optgroup>';
  html += '<optgroup label="Messages">';
  html += '<option value="msg:Get back to work!">Get back to work!</option>';
  html += '<option value="msg:Get up and stretch">Get up and stretch</option>';
  html += '<option value="msg:Keep going!">Keep going!</option>';
  html += '</optgroup>';

  var customMsgs = loadCustomMessages();
  if (customMsgs.length > 0) {
    html += '<optgroup label="Custom Messages">';
    customMsgs.forEach(function(m) {
      html += '<option value="cmsg:' + m.id + '">' + escapeHtml(m.name || m.text) + '</option>';
    });
    html += '</optgroup>';
  }

  var customSnds = loadCustomSounds();
  if (customSnds.length > 0) {
    html += '<optgroup label="Custom Sounds">';
    customSnds.forEach(function(s) {
      html += '<option value="csnd:' + s.id + '">' + escapeHtml(s.name) + '</option>';
    });
    html += '</optgroup>';
  }

  return html;
}

function rebuildDropdown(card, timer) {
  var select = card.querySelector('.preset-select');
  if (!select) return;
  select.innerHTML = buildDropdownHTML();
  var val = getSoundDisplayValue(timer.soundKey);
  var matched = false;
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].value === val) { select.options[i].selected = true; matched = true; break; }
  }
  if (!matched && (timer.soundKey.startsWith('cmsg:') || timer.soundKey.startsWith('csnd:'))) {
    timer.soundKey = 'alarm';
    select.value = 'sound:alarm';
    saveTimers();
  }
}

function rebuildAllDropdowns() {
  App.timers.forEach(function(timer) {
    var card = document.querySelector('[data-timer-id="' + timer.id + '"]');
    if (card) rebuildDropdown(card, timer);
  });
}

// ===== Timer Card Rendering =====
function setTimeInputs(card, ms) {
  var totalSec = Math.floor(ms / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  var inputs = card.querySelectorAll('.time-input');
  inputs[0].value = String(h).padStart(2, '0');
  inputs[1].value = String(m).padStart(2, '0');
  inputs[2].value = String(s).padStart(2, '0');
}

function readTimeInputs(card) {
  var inputs = card.querySelectorAll('.time-input');
  var h = parseInt(inputs[0].value, 10) || 0;
  var m = parseInt(inputs[1].value, 10) || 0;
  var s = parseInt(inputs[2].value, 10) || 0;
  return (h * 3600 + m * 60 + s) * 1000;
}

function renderTimerCard(timer) {
  var clone = document.getElementById('timer-card-template').content.cloneNode(true);
  var card = clone.querySelector('.timer-card');
  card.dataset.timerId = timer.id;
  card.draggable = true;
  card.querySelector('.timer-title').textContent = timer.title;
  applyTitleBarColors(card, timer.color);
  setTimeInputs(card, timer.durationMs);

  rebuildDropdown(card, timer);

  card.querySelector('[data-setting="repeat"]').checked = timer.repeat;
  card.querySelector('[data-setting="repeatSound"]').checked = timer.repeatSound;
  card.querySelector('[data-setting="soundEnabled"]').checked = timer.soundEnabled;
  if (!timer.soundEnabled) card.querySelector('.btn-sound-toggle').classList.add('muted');

  card.querySelectorAll('.color-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.color === timer.color);
  });

  document.getElementById('timer-grid').appendChild(clone);
}

function updateTimerCard(timer) {
  var card = document.querySelector('[data-timer-id="' + timer.id + '"]');
  if (!card) return;

  var isRunning = timer.state === 'running';
  var isPaused = timer.state === 'paused';
  var isCompleted = timer.state === 'completed';

  setTimeInputs(card, timer.remainingMs);

  var fill = card.querySelector('.progress-bar-fill');
  var pct = timer.progressPercent;
  fill.style.width = pct + '%';
  fill.style.backgroundPosition = (100 - pct) + '% 0';

  var btnPlay = card.querySelector('.btn-play');
  var btnPause = card.querySelector('.btn-pause');
  var btnStop = card.querySelector('.btn-stop');

  if (isRunning) {
    btnPlay.classList.add('hidden');
    btnPause.classList.remove('hidden');
    btnStop.classList.remove('hidden');
  } else if (isPaused) {
    btnPlay.classList.remove('hidden');
    btnPlay.innerHTML = '&#9654;';
    btnPlay.dataset.action = 'play';
    btnPlay.title = 'Resume';
    btnPlay.setAttribute('aria-label', 'Resume');
    btnPause.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else if (isCompleted) {
    btnPlay.classList.remove('hidden');
    btnPlay.innerHTML = '&#8634;';
    btnPlay.dataset.action = 'reset';
    btnPlay.title = 'Reset';
    btnPlay.setAttribute('aria-label', 'Reset');
    btnPause.classList.add('hidden');
    btnStop.classList.add('hidden');
  } else {
    btnPlay.classList.remove('hidden');
    btnPlay.innerHTML = '&#9654;';
    btnPlay.dataset.action = 'play';
    btnPlay.title = 'Start';
    btnPlay.setAttribute('aria-label', 'Start');
    btnPause.classList.add('hidden');
    btnStop.classList.add('hidden');
  }

  card.querySelectorAll('.time-input').forEach(function(inp) {
    inp.classList.toggle('running', isRunning);
  });
  card.classList.toggle('completed', isCompleted);

  if (isCompleted && timer.repeatSound && timer.soundEnabled) {
    if (!card.querySelector('.stop-sound-banner')) {
      var banner = document.createElement('div');
      banner.className = 'stop-sound-banner';
      banner.textContent = 'Click to stop sound';
      banner.dataset.action = 'stop-sound';
      card.insertBefore(banner, card.firstChild);
    }
  } else {
    var banner = card.querySelector('.stop-sound-banner');
    if (banner) banner.remove();
  }
}

function removeTimerCard(timerId) {
  var card = document.querySelector('[data-timer-id="' + timerId + '"]');
  if (card) card.remove();
}

function showSettingsPanel(timerId) {
  var card = document.querySelector('[data-timer-id="' + timerId + '"]');
  if (!card) return;
  var panel = card.querySelector('.settings-panel');
  var opening = panel.classList.contains('hidden');

  document.querySelectorAll('.settings-panel:not(.hidden)').forEach(function(p) {
    p.classList.add('hidden');
    p.closest('.timer-card').classList.remove('settings-open');
  });
  var oldBackdrop = document.querySelector('.settings-backdrop');
  if (oldBackdrop) oldBackdrop.remove();

  if (opening) {
    panel.classList.remove('hidden');
    card.classList.add('settings-open');
    var backdrop = document.createElement('div');
    backdrop.className = 'settings-backdrop';
    backdrop.addEventListener('click', function() {
      panel.classList.add('hidden');
      card.classList.remove('settings-open');
      backdrop.remove();
    });
    document.body.appendChild(backdrop);
  }
}

function getTimerFromEvent(e) {
  var card = e.target.closest('.timer-card');
  if (!card) return null;
  var timerId = card.dataset.timerId;
  var timer = App.timers.get(timerId);
  if (!timer) return null;
  return { timer: timer, card: card, timerId: timerId };
}
