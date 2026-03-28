// ===== Settings Modal =====
// Depends on: storage.js, audio.js, ui.js, App.timers, App.volumeSlider

// ===== Voices =====
var cachedVoices = null;

function getAvailableVoices() {
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  if (!('speechSynthesis' in window)) return [];
  cachedVoices = speechSynthesis.getVoices();
  return cachedVoices;
}

if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', function() {
    cachedVoices = speechSynthesis.getVoices();
  });
}

function populateVoiceDropdown() {
  var select = document.getElementById('msg-voice');
  var voices = getAvailableVoices();
  var currentVal = select.value;
  select.innerHTML = '<option value="">Default</option>';
  voices.forEach(function(v) {
    var opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name + ' (' + v.lang + ')';
    select.appendChild(opt);
  });
  if (currentVal) select.value = currentVal;
}

// ===== Settings Modal Open/Close =====
function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  renderPresetsTab();
  renderMessagesTab();
  renderSoundsTab();
  updateStorageBar();
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tabName);
    t.setAttribute('aria-selected', t.dataset.tab === tabName ? 'true' : 'false');
  });
  document.querySelectorAll('.settings-tab-content').forEach(function(c) {
    c.classList.add('hidden');
  });
  var target = document.getElementById('tab-' + tabName);
  if (target) target.classList.remove('hidden');
  if (tabName === 'messages') populateVoiceDropdown();
}

// ===== Presets Tab =====
function renderPresetsTab() {
  var presets = loadPresets();
  var list = document.getElementById('presets-list');
  var empty = document.getElementById('presets-empty');
  list.innerHTML = '';

  if (presets.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  presets.forEach(function(p) {
    var soundLabel = getSoundLabel(p.soundKey);
    var durLabel = formatDuration(p.durationMs);
    var div = document.createElement('div');
    div.className = 'settings-list-item';
    div.innerHTML = '<div class="item-color" style="background:' + p.color + '"></div>' +
      '<div class="item-info"><div class="item-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="item-detail">' + escapeHtml(p.title) + ' &middot; ' + durLabel + ' &middot; ' + escapeHtml(soundLabel) + '</div></div>' +
      '<div class="item-actions">' +
      '<button class="btn-edit-preset" data-id="' + p.id + '">Edit</button>' +
      '<button class="btn-delete-item btn-delete-preset" data-id="' + p.id + '">Delete</button></div>';
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-edit-preset').forEach(function(btn) {
    btn.addEventListener('click', function() { openPresetEditor(btn.dataset.id); });
  });
  list.querySelectorAll('.btn-delete-preset').forEach(function(btn) {
    btn.addEventListener('click', function() { deletePreset(btn.dataset.id); });
  });
}

function saveTimerAsPreset(timerId) {
  var timer = App.timers.get(timerId);
  if (!timer) return;
  var name = prompt('Preset name:', timer.title);
  if (!name) return;
  var presets = loadPresets();
  presets.push({
    id: generateId(), name: name, title: timer.title, durationMs: timer.durationMs,
    color: timer.color, soundKey: timer.soundKey, repeat: timer.repeat,
    repeatSound: timer.repeatSound, soundEnabled: timer.soundEnabled,
  });
  savePresets(presets);
  rebuildAddTimerMenu();
  renderPresetsTab();
}

function openPresetEditor(id) {
  var presets = loadPresets();
  var p = presets.find(function(x) { return x.id === id; });
  if (!p) return;

  var overlay = document.getElementById('preset-edit-overlay');
  document.getElementById('pe-id').value = p.id;
  document.getElementById('pe-name').value = p.name || '';
  document.getElementById('pe-title').value = p.title || '';

  var totalSec = Math.floor((p.durationMs || 0) / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  document.getElementById('pe-hours').value = String(h).padStart(2, '0');
  document.getElementById('pe-minutes').value = String(m).padStart(2, '0');
  document.getElementById('pe-seconds').value = String(s).padStart(2, '0');

  var soundSelect = document.getElementById('pe-sound');
  soundSelect.innerHTML = buildDropdownHTML();
  var soundVal = getSoundDisplayValue(p.soundKey);
  for (var i = 0; i < soundSelect.options.length; i++) {
    if (soundSelect.options[i].value === soundVal) { soundSelect.options[i].selected = true; break; }
  }

  var colorBtns = document.getElementById('pe-colors').querySelectorAll('.color-btn');
  colorBtns.forEach(function(btn) {
    var isSelected = btn.dataset.color === p.color;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });

  document.getElementById('pe-repeat').checked = !!p.repeat;
  document.getElementById('pe-repeatSound').checked = !!p.repeatSound;
  document.getElementById('pe-soundEnabled').checked = p.soundEnabled !== false;

  overlay.classList.remove('hidden');
}

function closePresetEditor() {
  document.getElementById('preset-edit-overlay').classList.add('hidden');
  document.getElementById('pe-id').value = '';
}

function savePresetEdits() {
  var id = document.getElementById('pe-id').value;
  if (!id) return;

  var name = document.getElementById('pe-name').value.trim();
  var title = document.getElementById('pe-title').value.trim();
  if (!name) { alert('Please enter a preset name.'); return; }

  var h = parseInt(document.getElementById('pe-hours').value, 10) || 0;
  var m = parseInt(document.getElementById('pe-minutes').value, 10) || 0;
  var s = parseInt(document.getElementById('pe-seconds').value, 10) || 0;
  var durationMs = ((h * 3600) + (m * 60) + s) * 1000;
  if (durationMs <= 0) { alert('Duration must be greater than zero.'); return; }

  var soundVal = document.getElementById('pe-sound').value;
  var soundKey;
  if (soundVal.startsWith('sound:')) soundKey = soundVal.slice(6);
  else if (soundVal.startsWith('msg:') || soundVal.startsWith('cmsg:') || soundVal.startsWith('csnd:')) soundKey = soundVal;
  else soundKey = 'alarm';

  var activeColor = document.querySelector('#pe-colors .color-btn.active');
  var color = activeColor ? activeColor.dataset.color : '#D4A843';

  var presets = loadPresets();
  presets = presets.map(function(p) {
    if (p.id !== id) return p;
    return {
      id: p.id, name: name, title: title || name, durationMs: durationMs,
      color: color, soundKey: soundKey,
      repeat: document.getElementById('pe-repeat').checked,
      repeatSound: document.getElementById('pe-repeatSound').checked,
      soundEnabled: document.getElementById('pe-soundEnabled').checked,
    };
  });
  savePresets(presets);
  closePresetEditor();
  renderPresetsTab();
  rebuildAddTimerMenu();
  rebuildAllDropdowns();
}

function deletePreset(id) {
  if (!confirm('Delete this preset?')) return;
  var presets = loadPresets().filter(function(x) { return x.id !== id; });
  savePresets(presets);
  renderPresetsTab();
  rebuildAddTimerMenu();
}

function addTimerFromPreset(preset) {
  var cfg = {
    title: preset.title, durationMs: preset.durationMs, color: preset.color,
    soundKey: preset.soundKey, repeat: preset.repeat, repeatSound: preset.repeatSound,
    soundEnabled: preset.soundEnabled, order: App.timers.size,
  };
  var t = new Timer(cfg);
  App.timers.set(t.id, t);
  renderTimerCard(t);
  persist();
}

function rebuildAddTimerMenu() {
  var menu = document.getElementById('add-timer-menu');
  if (!menu) return;
  var existingSection = menu.querySelector('.preset-menu-section');
  if (existingSection) existingSection.remove();

  var presets = loadPresets();
  if (presets.length === 0) return;

  var section = document.createElement('div');
  section.className = 'preset-menu-section';
  section.style.borderTop = '1px solid #e0e0e0';
  section.style.marginTop = '4px';
  section.style.paddingTop = '4px';

  var label = document.createElement('div');
  label.style.padding = '4px 12px';
  label.style.fontSize = '11px';
  label.style.color = '#999';
  label.style.fontWeight = '500';
  label.textContent = 'SAVED PRESETS';
  section.appendChild(label);

  presets.forEach(function(p) {
    var btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    btn.dataset.presetId = p.id;
    btn.textContent = p.name;
    btn.addEventListener('click', function() {
      addTimerFromPreset(p);
      menu.classList.add('hidden');
    });
    section.appendChild(btn);
  });
  menu.appendChild(section);
}

// ===== Messages Tab =====
function renderMessagesTab() {
  var messages = loadCustomMessages();
  var list = document.getElementById('messages-list');
  var empty = document.getElementById('messages-empty');
  list.innerHTML = '';

  if (messages.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  messages.forEach(function(m) {
    var div = document.createElement('div');
    div.className = 'settings-list-item';
    var voiceLabel = m.voiceName || 'Default';
    div.innerHTML = '<div class="item-info"><div class="item-name">' + escapeHtml(m.name || m.text) + '</div>' +
      '<div class="item-detail">"' + escapeHtml(m.text) + '" &middot; ' + escapeHtml(voiceLabel) + ' &middot; Speed ' + (m.rate || 1).toFixed(1) + ' &middot; Pitch ' + (m.pitch || 1).toFixed(1) + '</div></div>' +
      '<div class="item-actions">' +
      '<button class="btn-preview-msg" data-id="' + m.id + '">Preview</button>' +
      '<button class="btn-edit-msg" data-id="' + m.id + '">Edit</button>' +
      '<button class="btn-delete-item btn-delete-msg" data-id="' + m.id + '">Delete</button></div>';
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-preview-msg').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var msgs = loadCustomMessages();
      var m = msgs.find(function(x) { return x.id === btn.dataset.id; });
      if (m) { initAudio(); playDing(); setTimeout(function() { speakCustomMessage(m); }, 800); }
    });
  });
  list.querySelectorAll('.btn-edit-msg').forEach(function(btn) {
    btn.addEventListener('click', function() { editMessage(btn.dataset.id); });
  });
  list.querySelectorAll('.btn-delete-msg').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteMessage(btn.dataset.id); });
  });
}

function editMessage(id) {
  var msgs = loadCustomMessages();
  var m = msgs.find(function(x) { return x.id === id; });
  if (!m) return;
  document.getElementById('msg-text').value = m.text;
  document.getElementById('msg-rate').value = m.rate || 1;
  document.getElementById('msg-pitch').value = m.pitch || 1;
  document.getElementById('msg-rate-val').textContent = (m.rate || 1).toFixed(1);
  document.getElementById('msg-pitch-val').textContent = (m.pitch || 1).toFixed(1);
  document.getElementById('msg-edit-id').value = m.id;
  populateVoiceDropdown();
  if (m.voiceName) document.getElementById('msg-voice').value = m.voiceName;
  document.getElementById('msg-save').textContent = 'Update Message';
}

function deleteMessage(id) {
  var key = 'cmsg:' + id;
  var count = 0;
  App.timers.forEach(function(t) { if (t.soundKey === key) count++; });
  var msg = count > 0
    ? 'This message is used by ' + count + ' timer(s). They will revert to Alarm. Delete?'
    : 'Delete this custom message?';
  if (!confirm(msg)) return;

  if (count > 0) {
    App.timers.forEach(function(t) { if (t.soundKey === key) t.soundKey = 'alarm'; });
    persist();
  }

  var msgs = loadCustomMessages().filter(function(x) { return x.id !== id; });
  saveCustomMessages(msgs);
  renderMessagesTab();
  rebuildAllDropdowns();
}

// ===== Sounds Tab =====
var pendingSoundDataURI = null;

function renderSoundsTab() {
  var sounds = loadCustomSounds();
  var list = document.getElementById('sounds-list');
  var empty = document.getElementById('sounds-empty');
  list.innerHTML = '';

  if (sounds.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  sounds.forEach(function(s) {
    var sizeLabel = s.sizeBytes > 1024 * 1024
      ? (s.sizeBytes / (1024 * 1024)).toFixed(1) + ' MB'
      : Math.round(s.sizeBytes / 1024) + ' KB';
    var div = document.createElement('div');
    div.className = 'settings-list-item';
    div.innerHTML = '<div class="item-info"><div class="item-name">' + escapeHtml(s.name) + '</div>' +
      '<div class="item-detail">' + sizeLabel + '</div></div>' +
      '<div class="item-actions">' +
      '<button class="btn-preview-snd" data-id="' + s.id + '">Preview</button>' +
      '<button class="btn-delete-item btn-delete-snd" data-id="' + s.id + '">Delete</button></div>';
    list.appendChild(div);
  });

  list.querySelectorAll('.btn-preview-snd').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var snds = loadCustomSounds();
      var s = snds.find(function(x) { return x.id === btn.dataset.id; });
      if (s) playCustomSound(s);
    });
  });
  list.querySelectorAll('.btn-delete-snd').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteSound(btn.dataset.id); });
  });
}

function deleteSound(id) {
  var key = 'csnd:' + id;
  var count = 0;
  App.timers.forEach(function(t) { if (t.soundKey === key) count++; });
  var msg = count > 0
    ? 'This sound is used by ' + count + ' timer(s). They will revert to Alarm. Delete?'
    : 'Delete this custom sound?';
  if (!confirm(msg)) return;

  if (count > 0) {
    App.timers.forEach(function(t) { if (t.soundKey === key) t.soundKey = 'alarm'; });
    persist();
  }

  var snds = loadCustomSounds().filter(function(x) { return x.id !== id; });
  saveCustomSounds(snds);
  renderSoundsTab();
  updateStorageBar();
  rebuildAllDropdowns();
}

function getCustomSoundsTotalBytes() {
  var sounds = loadCustomSounds();
  var total = 0;
  sounds.forEach(function(s) { total += s.sizeBytes || 0; });
  return total;
}

function updateStorageBar() {
  var total = getCustomSoundsTotalBytes();
  var maxBytes = 3 * 1024 * 1024;
  var pct = Math.min(100, (total / maxBytes) * 100);
  var fill = document.getElementById('storage-bar-fill');
  var label = document.getElementById('storage-label');
  if (fill) fill.style.width = pct + '%';
  if (label) {
    var used = total > 1024 * 1024
      ? (total / (1024 * 1024)).toFixed(1) + ' MB'
      : Math.round(total / 1024) + ' KB';
    label.textContent = used + ' / 3 MB used';
  }
}

// ===== Import/Export =====
function exportSettings() {
  var data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    presets: loadPresets(),
    customMessages: loadCustomMessages(),
    customSounds: loadCustomSounds(),
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'multi-timer-settings-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function previewImport(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      var parts = [];
      if (data.presets && data.presets.length) parts.push(data.presets.length + ' preset(s)');
      if (data.customMessages && data.customMessages.length) parts.push(data.customMessages.length + ' message(s)');
      if (data.customSounds && data.customSounds.length) parts.push(data.customSounds.length + ' sound(s)');
      var preview = document.getElementById('import-preview');
      preview.textContent = parts.length > 0
        ? 'Found: ' + parts.join(', ')
        : 'No customization data found in file.';
      preview.classList.remove('hidden');
      document.getElementById('btn-import').classList.remove('hidden');
      document.getElementById('btn-import').dataset.pending = e.target.result;
    } catch(err) {
      var preview = document.getElementById('import-preview');
      preview.textContent = 'Error: Invalid JSON file.';
      preview.classList.remove('hidden');
      document.getElementById('btn-import').classList.add('hidden');
    }
  };
  reader.readAsText(file);
}

function doImport(jsonStr) {
  try {
    var data = JSON.parse(jsonStr);
    if (data.presets && data.presets.length) {
      var existing = loadPresets();
      var existingIds = {};
      existing.forEach(function(p) { existingIds[p.id] = true; });
      data.presets.forEach(function(p) {
        if (existingIds[p.id]) {
          existing = existing.map(function(x) { return x.id === p.id ? p : x; });
        } else {
          existing.push(p);
        }
      });
      savePresets(existing);
    }
    if (data.customMessages && data.customMessages.length) {
      var existing = loadCustomMessages();
      var existingIds = {};
      existing.forEach(function(m) { existingIds[m.id] = true; });
      data.customMessages.forEach(function(m) {
        if (existingIds[m.id]) {
          existing = existing.map(function(x) { return x.id === m.id ? m : x; });
        } else {
          existing.push(m);
        }
      });
      saveCustomMessages(existing);
    }
    if (data.customSounds && data.customSounds.length) {
      var existing = loadCustomSounds();
      var existingIds = {};
      existing.forEach(function(s) { existingIds[s.id] = true; });
      data.customSounds.forEach(function(s) {
        if (existingIds[s.id]) {
          existing = existing.map(function(x) { return x.id === s.id ? s : x; });
        } else {
          existing.push(s);
        }
      });
      saveCustomSounds(existing);
    }
    rebuildAllDropdowns();
    rebuildAddTimerMenu();
    renderPresetsTab();
    renderMessagesTab();
    renderSoundsTab();
    updateStorageBar();
    alert('Import complete!');
  } catch(err) {
    alert('Import failed: ' + err.message);
  }
}

// ===== Settings Modal Event Wiring =====
function attachSettingsModalListeners() {
  // Messages tab
  var rateSlider = document.getElementById('msg-rate');
  var pitchSlider = document.getElementById('msg-pitch');
  rateSlider.addEventListener('input', function() {
    document.getElementById('msg-rate-val').textContent = Number(rateSlider.value).toFixed(1);
  });
  pitchSlider.addEventListener('input', function() {
    document.getElementById('msg-pitch-val').textContent = Number(pitchSlider.value).toFixed(1);
  });

  document.getElementById('msg-preview').addEventListener('click', function() {
    var text = document.getElementById('msg-text').value.trim();
    if (!text) return;
    initAudio();
    playDing();
    setTimeout(function() {
      speakCustomMessage({
        text: text,
        voiceName: document.getElementById('msg-voice').value || null,
        rate: Number(document.getElementById('msg-rate').value),
        pitch: Number(document.getElementById('msg-pitch').value),
      });
    }, 800);
  });

  document.getElementById('msg-save').addEventListener('click', function() {
    var text = document.getElementById('msg-text').value.trim();
    if (!text) { alert('Please enter a message.'); return; }
    var msgs = loadCustomMessages();
    var editId = document.getElementById('msg-edit-id').value;
    if (editId) {
      msgs = msgs.map(function(m) {
        if (m.id === editId) {
          return {
            id: m.id, name: text.slice(0, 30), text: text,
            voiceName: document.getElementById('msg-voice').value || null,
            rate: Number(document.getElementById('msg-rate').value),
            pitch: Number(document.getElementById('msg-pitch').value),
          };
        }
        return m;
      });
    } else {
      msgs.push({
        id: generateId(), name: text.slice(0, 30), text: text,
        voiceName: document.getElementById('msg-voice').value || null,
        rate: Number(document.getElementById('msg-rate').value),
        pitch: Number(document.getElementById('msg-pitch').value),
      });
    }
    saveCustomMessages(msgs);
    document.getElementById('msg-text').value = '';
    document.getElementById('msg-rate').value = 1;
    document.getElementById('msg-pitch').value = 1;
    document.getElementById('msg-rate-val').textContent = '1.0';
    document.getElementById('msg-pitch-val').textContent = '1.0';
    document.getElementById('msg-voice').value = '';
    document.getElementById('msg-edit-id').value = '';
    document.getElementById('msg-save').textContent = 'Save Message';
    renderMessagesTab();
    rebuildAllDropdowns();
  });

  // Sounds tab
  var sndFile = document.getElementById('snd-file');
  var sndName = document.getElementById('snd-name');
  sndFile.addEventListener('change', function() {
    var file = sndFile.files[0];
    if (!file) { pendingSoundDataURI = null; return; }
    sndName.value = file.name.replace(/\.[^.]+$/, '');
    document.getElementById('snd-preview').disabled = true;
    document.getElementById('snd-save').disabled = true;

    if (file.size > 1024 * 1024) {
      alert('Warning: This file is larger than 1 MB. Large files may impact performance.');
    }
    var total = getCustomSoundsTotalBytes() + file.size;
    if (total > 3 * 1024 * 1024) {
      alert('Cannot add this sound: total custom sounds would exceed 3 MB limit.');
      sndFile.value = '';
      pendingSoundDataURI = null;
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      pendingSoundDataURI = e.target.result;
      document.getElementById('snd-preview').disabled = false;
      document.getElementById('snd-save').disabled = false;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('snd-preview').addEventListener('click', function() {
    if (!pendingSoundDataURI) return;
    var audio = new Audio(pendingSoundDataURI);
    audio.volume = App.volumeSlider ? (Number(App.volumeSlider.value) || 80) / 100 : 0.8;
    audio.play().catch(function() {});
  });

  document.getElementById('snd-save').addEventListener('click', function() {
    var name = sndName.value.trim();
    if (!name) { alert('Please enter a name.'); return; }
    if (!pendingSoundDataURI) { alert('Please select an audio file.'); return; }
    var file = sndFile.files[0];
    var snds = loadCustomSounds();
    snds.push({
      id: generateId(), name: name, dataURI: pendingSoundDataURI,
      mimeType: file ? file.type : 'audio/mpeg',
      sizeBytes: file ? file.size : 0,
    });
    saveCustomSounds(snds);
    sndFile.value = '';
    sndName.value = '';
    pendingSoundDataURI = null;
    document.getElementById('snd-preview').disabled = true;
    document.getElementById('snd-save').disabled = true;
    renderSoundsTab();
    updateStorageBar();
    rebuildAllDropdowns();
  });

  // Export/Import tab
  document.getElementById('btn-export').addEventListener('click', exportSettings);
  document.getElementById('import-file').addEventListener('change', function() {
    var file = this.files[0];
    if (file) previewImport(file);
  });
  document.getElementById('btn-import').addEventListener('click', function() {
    var jsonStr = this.dataset.pending;
    if (jsonStr) doImport(jsonStr);
  });

  // Preset editor
  document.getElementById('pe-cancel').addEventListener('click', closePresetEditor);
  document.getElementById('pe-save').addEventListener('click', savePresetEdits);

  // Preset editor: chevron + wheel for time inputs
  var peTimeRow = document.querySelector('.pe-time-row');
  if (peTimeRow) {
    peTimeRow.addEventListener('mousedown', function(e) {
      var chevron = e.target.closest('.time-chevron');
      if (!chevron) return;
      e.preventDefault();
      var wrap = chevron.closest('.time-input-wrap');
      var input = wrap.querySelector('.time-input');
      var dir = chevron.dataset.dir === 'up' ? 1 : -1;
      adjustTimeInput(input, dir);
      var delay = CHEVRON_INITIAL_DELAY;
      var timeoutId = null;
      function repeatAdjust() {
        adjustTimeInput(input, dir);
        delay = Math.max(CHEVRON_MIN_DELAY, delay * CHEVRON_ACCEL);
        timeoutId = setTimeout(repeatAdjust, delay);
      }
      timeoutId = setTimeout(repeatAdjust, delay);
      function stopRepeat() {
        clearTimeout(timeoutId);
        commitPresetTimeInput(input);
        document.removeEventListener('mouseup', stopRepeat);
        document.removeEventListener('mouseleave', stopRepeat);
      }
      document.addEventListener('mouseup', stopRepeat);
      document.addEventListener('mouseleave', stopRepeat);
    });
    peTimeRow.addEventListener('wheel', function(e) {
      var input = e.target.closest('.time-input');
      if (!input) return;
      e.preventDefault();
      var dir = e.deltaY < 0 ? 1 : -1;
      adjustTimeInput(input, dir);
      commitPresetTimeInput(input);
    }, { passive: false });
  }
  document.getElementById('pe-colors').addEventListener('click', function(e) {
    var btn = e.target.closest('.color-btn');
    if (!btn) return;
    document.getElementById('pe-colors').querySelectorAll('.color-btn').forEach(function(b) {
      b.classList.remove('active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');
  });
}
