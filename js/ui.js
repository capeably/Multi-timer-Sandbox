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

function rebuildSegmentDropdown(segEl, segment) {
  var select = segEl.querySelector('.preset-select');
  if (!select) return;
  select.innerHTML = buildDropdownHTML();
  var val = getSoundDisplayValue(segment.soundKey);
  var matched = false;
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].value === val) { select.options[i].selected = true; matched = true; break; }
  }
  if (!matched && (segment.soundKey.startsWith('cmsg:') || segment.soundKey.startsWith('csnd:'))) {
    segment.soundKey = 'alarm';
    select.value = 'sound:alarm';
    saveTimers();
  }
}

// Legacy wrappers for settings.js compatibility
function rebuildDropdown(card, timer) {
  var segments = card.querySelectorAll('.segment-row');
  for (var i = 0; i < segments.length; i++) {
    var seg = timer.segments[i];
    if (seg) rebuildSegmentDropdown(segments[i], seg);
  }
}

function rebuildAllDropdowns() {
  App.timers.forEach(function(timer) {
    var card = document.querySelector('[data-timer-id="' + timer.id + '"]');
    if (card) rebuildDropdown(card, timer);
  });
}

// ===== Segment Rendering =====
function createSegmentElement(segment, index, total) {
  var row = document.createElement('div');
  row.className = 'segment-row';
  row.dataset.segmentId = segment.id;

  var totalSec = Math.floor(segment.durationMs / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;

  row.innerHTML =
    '<span class="seg-drag-handle" title="Reorder segment">&#9776;</span>' +
    '<button class="seg-delete-btn" data-action="delete-segment" title="Remove segment" aria-label="Remove segment">&times;</button>' +
    '<div class="seg-time-display">' +
      '<div class="time-input-wrap">' +
        '<button class="time-chevron time-chevron-up" data-dir="up" tabindex="-1" aria-label="Increase hours">&#9650;</button>' +
        '<input type="text" class="time-input" data-unit="hours" value="' + String(h).padStart(2, '0') + '" maxlength="2" inputmode="numeric" aria-label="Hours">' +
        '<button class="time-chevron time-chevron-down" data-dir="down" tabindex="-1" aria-label="Decrease hours">&#9660;</button>' +
      '</div>' +
      '<span class="time-sep" aria-hidden="true">:</span>' +
      '<div class="time-input-wrap">' +
        '<button class="time-chevron time-chevron-up" data-dir="up" tabindex="-1" aria-label="Increase minutes">&#9650;</button>' +
        '<input type="text" class="time-input" data-unit="minutes" value="' + String(m).padStart(2, '0') + '" maxlength="2" inputmode="numeric" aria-label="Minutes">' +
        '<button class="time-chevron time-chevron-down" data-dir="down" tabindex="-1" aria-label="Decrease minutes">&#9660;</button>' +
      '</div>' +
      '<span class="time-sep" aria-hidden="true">:</span>' +
      '<div class="time-input-wrap">' +
        '<button class="time-chevron time-chevron-up" data-dir="up" tabindex="-1" aria-label="Increase seconds">&#9650;</button>' +
        '<input type="text" class="time-input" data-unit="seconds" value="' + String(s).padStart(2, '0') + '" maxlength="2" inputmode="numeric" aria-label="Seconds">' +
        '<button class="time-chevron time-chevron-down" data-dir="down" tabindex="-1" aria-label="Decrease seconds">&#9660;</button>' +
      '</div>' +
    '</div>' +
    '<div class="seg-bottom-row">' +
      '<select class="preset-select" data-action="seg-preset" aria-label="Presets and sounds"></select>' +
      '<button class="btn-icon btn-sound-toggle' + (segment.soundEnabled ? '' : ' muted') + '" data-action="seg-toggle-sound" title="Sound on/off" aria-label="Toggle sound">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
          '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
        '</svg>' +
      '</button>' +
    '</div>';

  return row;
}

function renderSegments(card, timer) {
  var container = card.querySelector('.segments-container');
  container.innerHTML = '';
  container.classList.toggle('single-segment', timer.segments.length === 1);

  timer.segments.forEach(function(seg, i) {
    var el = createSegmentElement(seg, i, timer.segments.length);
    // Mark active/completed
    if (i === timer._activeSegmentIndex && timer.state !== 'idle') {
      el.classList.add('active');
    }
    if (timer.state !== 'idle' && i < timer._activeSegmentIndex) {
      el.classList.add('completed-seg');
    }
    container.appendChild(el);
    rebuildSegmentDropdown(el, seg);
    // Disable time inputs when running
    if (timer.state === 'running') {
      el.querySelectorAll('.time-input').forEach(function(inp) { inp.classList.add('running'); });
    }
  });
}

// ===== Timer Card Rendering =====
function setSegmentTimeInputs(segEl, ms) {
  var totalSec = Math.floor(ms / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  var inputs = segEl.querySelectorAll('.time-input');
  inputs[0].value = String(h).padStart(2, '0');
  inputs[1].value = String(m).padStart(2, '0');
  inputs[2].value = String(s).padStart(2, '0');
}

function readSegmentTimeInputs(segEl) {
  var inputs = segEl.querySelectorAll('.time-input');
  var h = parseInt(inputs[0].value, 10) || 0;
  var m = parseInt(inputs[1].value, 10) || 0;
  var s = parseInt(inputs[2].value, 10) || 0;
  return (h * 3600 + m * 60 + s) * 1000;
}

// Legacy wrappers
function setTimeInputs(card, ms) {
  var activeSeg = card.querySelector('.segment-row.active') || card.querySelector('.segment-row');
  if (activeSeg) setSegmentTimeInputs(activeSeg, ms);
}

function readTimeInputs(card) {
  var activeSeg = card.querySelector('.segment-row.active') || card.querySelector('.segment-row');
  if (activeSeg) return readSegmentTimeInputs(activeSeg);
  return 0;
}

function renderTimerCard(timer) {
  var clone = document.getElementById('timer-card-template').content.cloneNode(true);
  var card = clone.querySelector('.timer-card');
  card.dataset.timerId = timer.id;
  card.draggable = true;
  card.querySelector('.timer-title').textContent = timer.title;
  applyTitleBarColors(card, timer.color);

  // Render segments
  renderSegments(card, timer);

  // Settings panel
  card.querySelector('[data-setting="autoAdvance"]').checked = timer.autoAdvance;
  card.querySelector('[data-setting="repeat"]').checked = timer.repeat;
  card.querySelector('[data-setting="repeatSound"]').checked = timer.repeatSound;

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

  // Update segment states
  var segEls = card.querySelectorAll('.segment-row');
  segEls.forEach(function(el, i) {
    el.classList.toggle('active', i === timer._activeSegmentIndex && timer.state !== 'idle');
    el.classList.toggle('completed-seg', timer.state !== 'idle' && i < timer._activeSegmentIndex);
    var isActiveRunning = isRunning && i === timer._activeSegmentIndex;
    el.querySelectorAll('.time-input').forEach(function(inp) {
      inp.classList.toggle('running', isActiveRunning);
    });
    el.querySelectorAll('.time-input-wrap').forEach(function(wrap) {
      wrap.classList.toggle('running', isActiveRunning);
    });
  });

  // Update active segment's time display
  var activeSegEl = segEls[timer._activeSegmentIndex];
  if (activeSegEl) {
    setSegmentTimeInputs(activeSegEl, timer.remainingMs);
  }

  var fill = card.querySelector('.progress-bar-fill');
  var pct = timer.progressPercent;
  fill.style.width = pct + '%';

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

  card.classList.toggle('completed', isCompleted);

  if (isCompleted && timer.repeatSound && timer.activeSegment.soundEnabled) {
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

function getSegmentFromEvent(e) {
  var segRow = e.target.closest('.segment-row');
  if (!segRow) return null;
  return segRow.dataset.segmentId || null;
}
