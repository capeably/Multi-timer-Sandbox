// ===== Storage =====
// Depends on: timer.js (Timer), App.timers (set by app.js at runtime)

var TIMERS_KEY = 'multitimer_timers';
var VOLUME_KEY = 'multitimer_globalVolume';
var PRESETS_KEY = 'multitimer_presets';
var CUSTOM_MESSAGES_KEY = 'multitimer_customMessages';
var CUSTOM_SOUNDS_KEY = 'multitimer_customSounds';

var saveTimeout = null;

function saveTimers() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(flushTimers, 300);
}

function flushTimers() {
  clearTimeout(saveTimeout);
  var data = Array.from(App.timers.values()).map(function(t) { return t.toJSON(); });
  localStorage.setItem(TIMERS_KEY, JSON.stringify(data));
}

function loadTimers() {
  try {
    var raw = localStorage.getItem(TIMERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch(e) { return []; }
}

function saveVolume(value) { localStorage.setItem(VOLUME_KEY, String(value)); }

function loadVolume() {
  var raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null) return 80;
  return Number(raw) || 80;
}

function getDefaultTimerConfig() {
  return {
    title: 'Your First Timer', durationMs: 60000, color: '#333333',
    soundKey: 'alarm', repeat: false, repeatSound: false, soundEnabled: true, order: 0,
  };
}

function loadPresets() {
  try { var raw = localStorage.getItem(PRESETS_KEY); return raw ? JSON.parse(raw) : []; }
  catch(e) { return []; }
}
function savePresets(arr) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); }
  catch(e) { alert('Could not save presets: storage full.'); }
}
function loadCustomMessages() {
  try { var raw = localStorage.getItem(CUSTOM_MESSAGES_KEY); return raw ? JSON.parse(raw) : []; }
  catch(e) { return []; }
}
function saveCustomMessages(arr) {
  try { localStorage.setItem(CUSTOM_MESSAGES_KEY, JSON.stringify(arr)); }
  catch(e) { alert('Could not save messages: storage full.'); }
}
function loadCustomSounds() {
  try { var raw = localStorage.getItem(CUSTOM_SOUNDS_KEY); return raw ? JSON.parse(raw) : []; }
  catch(e) { return []; }
}
function saveCustomSounds(arr) {
  try { localStorage.setItem(CUSTOM_SOUNDS_KEY, JSON.stringify(arr)); }
  catch(e) { alert('Could not save sounds: storage full.'); }
}

function persist() {
  saveTimers();
}

function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
}
