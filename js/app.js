// ===== App =====
// Depends on: timer.js, storage.js, audio.js, ui.js, settings.js
// This file is loaded last.

// Global shared state
var App = {
  timers: new Map(),
  volumeSlider: null,
  loopId: null,
  liveRegion: null,
};

function announce(message) {
  if (App.liveRegion) App.liveRegion.textContent = message;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('multitimer_theme', theme); } catch(e) {}
}

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyCompact(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-compact', 'true');
  } else {
    document.documentElement.removeAttribute('data-compact');
  }
  try { localStorage.setItem('multitimer_compact', enabled ? 'true' : ''); } catch(e) {}
}

function toggleCompact() {
  var isCompact = document.documentElement.hasAttribute('data-compact');
  applyCompact(!isCompact);
}

// Apply saved settings immediately (before init)
(function() {
  try {
    var saved = localStorage.getItem('multitimer_theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    if (localStorage.getItem('multitimer_compact') === 'true') {
      document.documentElement.setAttribute('data-compact', 'true');
    }
  } catch(e) {}
})();

function init() {
  var configs = loadTimers();
  if (configs.length === 0) configs.push(getDefaultTimerConfig());

  App.volumeSlider = document.getElementById('volume-slider');
  App.volumeSlider.value = loadVolume();

  configs.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
  configs.forEach(function(cfg) {
    var t = Timer.fromJSON(cfg);
    App.timers.set(t.id, t);
    renderTimerCard(t);
    if (t.state !== 'idle') {
      // Running timer whose duration elapsed while the app was closed:
      // mark it completed silently — don't replay the alarm on reopen.
      if (t.state === 'running' && t.remainingMs <= 0) t.complete();
      updateTimerCard(t);
    }
  });

  // Create aria-live region
  App.liveRegion = document.createElement('div');
  App.liveRegion.setAttribute('aria-live', 'polite');
  App.liveRegion.setAttribute('role', 'status');
  App.liveRegion.className = 'sr-only';
  document.body.appendChild(App.liveRegion);

  startMainLoop();
  attachToolbarListeners();
  attachGridListeners();
  attachSettingsModalListeners();
  rebuildAddTimerMenu();

  window.addEventListener('beforeunload', flushTimers);
}

// === Constants ===
var TICK_INTERVAL = 250;
var TIMER_REPEAT_DELAY = 1500;
var CHEVRON_INITIAL_DELAY = 400;
var CHEVRON_MIN_DELAY = 80;
var CHEVRON_ACCEL = 0.75;
var SOUND_PICKER_MAX_HEIGHT = 260;
var BG_CHECK_INTERVAL = 1000;

// === Main Loop ===
var lastTickTime = 0;

function mainLoop(timestamp) {
  if (timestamp - lastTickTime >= TICK_INTERVAL) {
    lastTickTime = timestamp;
    App.timers.forEach(function(timer) {
      if (timer.state === 'running') {
        if (timer.remainingMs <= 0) handleTimerComplete(timer);
        updateTimerCard(timer);
      }
    });
  }
  App.loopId = requestAnimationFrame(mainLoop);
}

function startMainLoop() {
  if (App.loopId !== null) return;
  App.loopId = requestAnimationFrame(mainLoop);
}

// Background tab watchdog — setInterval still fires (~1s) when RAF is paused
setInterval(function() {
  if (document.visibilityState === 'visible') return;
  App.timers.forEach(function(timer) {
    if (timer.state === 'running' && timer.remainingMs <= 0) {
      handleTimerComplete(timer);
    }
  });
}, BG_CHECK_INTERVAL);

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    // Resume audio context in case it was suspended in background
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    App.timers.forEach(function(timer) {
      if (timer.state === 'running' && timer.remainingMs <= 0) {
        handleTimerComplete(timer);
      }
      if (timer.state === 'running' || timer.state === 'completed') {
        updateTimerCard(timer);
      }
    });
  }
});

function handleTimerComplete(timer) {
  var segment = timer.activeSegment;

  // Play sound for completed segment
  if (segment.soundEnabled) {
    initAudio();
    setGlobalVolume(Number(App.volumeSlider.value));
    if (timer.repeatSound && !timer.hasNextSegment()) {
      startRepeatSound(segment.soundKey);
    } else {
      playSound(segment.soundKey);
    }
  }

  // Check if we should auto-advance to next segment
  if (timer.autoAdvance && timer.hasNextSegment()) {
    // Read durations from DOM for upcoming segments (in case user edited them)
    syncSegmentDurationsFromDOM(timer);
    timer.advanceSegment();
    announce(timer.title + ' segment ' + timer._activeSegmentIndex + ' started');
    updateTimerCard(timer);
    persist();
    return;
  }

  // No more segments or auto-advance off: complete the timer
  timer.complete();
  announce(timer.title + ' timer completed');

  if (timer.repeat && !timer.repeatSound) {
    setTimeout(function() {
      timer.reset();
      timer.start();
      renderSegments(document.querySelector('[data-timer-id="' + timer.id + '"]'), timer);
      updateTimerCard(timer);
      persist();
    }, TIMER_REPEAT_DELAY);
  }

  updateTimerCard(timer);
  persist();
}

// Find index of segment by ID within a timer's segments array; returns -1 if not found
function findSegmentIndex(timer, segId) {
  for (var i = 0; i < timer.segments.length; i++) {
    if (timer.segments[i].id === segId) return i;
  }
  return -1;
}

// Sync all segment durations from DOM inputs (for segments not yet played)
function syncSegmentDurationsFromDOM(timer) {
  var card = document.querySelector('[data-timer-id="' + timer.id + '"]');
  if (!card) return;
  var segEls = card.querySelectorAll('.segment-row');
  segEls.forEach(function(el, i) {
    if (i > timer._activeSegmentIndex && timer.segments[i]) {
      var ms = readSegmentTimeInputs(el);
      if (ms > 0) timer.segments[i].durationMs = ms;
    }
  });
}

// === Time Input Helpers (chevron/wheel) ===
function adjustTimeInput(input, dir) {
  var unit = input.dataset.unit;
  var max = unit === 'hours' ? 99 : 59;
  var val = parseInt(input.value, 10) || 0;
  val += dir;
  if (val > max) val = 0;
  if (val < 0) val = max;
  input.value = String(val).padStart(2, '0');
}

function snapTimeInput(input, dir) {
  var unit = input.dataset.unit;
  var max = unit === 'hours' ? 99 : 59;
  var val = parseInt(input.value, 10) || 0;
  if (dir > 0) {
    val = Math.ceil((val + 1) / 5) * 5;
  } else {
    val = Math.floor((val - 1) / 5) * 5;
  }
  if (val > max) val = 0;
  if (val < 0) val = max;
  input.value = String(val).padStart(2, '0');
}

function commitTimeInput(input) {
  var segRow = input.closest('.segment-row');
  if (!segRow) return;
  var card = input.closest('.timer-card');
  if (!card) return;
  var timerId = card.dataset.timerId;
  var timer = App.timers.get(timerId);
  if (!timer || timer.state === 'running') return;
  var segId = segRow.dataset.segmentId;
  if (segId) {
    var idx = findSegmentIndex(timer, segId);
    if (idx !== -1) timer.segments[idx].durationMs = readSegmentTimeInputs(segRow);
  }
  timer._remainingAtPause = timer.activeSegment.durationMs;
  persist();
}

function commitPresetTimeInput(input) {
  var unit = input.dataset.unit || input.id.replace('pe-', '');
  var val = parseInt(input.value, 10) || 0;
  var max = (unit === 'hours' || input.id === 'pe-hours') ? 99 : 59;
  val = Math.min(max, Math.max(0, val));
  input.value = String(val).padStart(2, '0');
}

// === Toolbar ===
function attachToolbarListeners() {
  document.getElementById('btn-add-timer').addEventListener('click', function() {
    addTimer(60000);
  });

  var dropdownBtn = document.getElementById('btn-add-timer-dropdown');
  var dropdownMenu = document.getElementById('add-timer-menu');

  dropdownBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    dropdownMenu.classList.toggle('hidden');
  });

  dropdownMenu.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-duration]');
    if (btn) {
      addTimer(Number(btn.dataset.duration));
      dropdownMenu.classList.add('hidden');
    }
  });

  var volBtn = document.getElementById('btn-volume');
  var volWrap = document.getElementById('volume-slider-wrap');
  volBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    volWrap.classList.toggle('hidden');
  });

  App.volumeSlider.addEventListener('input', function(e) {
    var val = Number(e.target.value);
    initAudio();
    setGlobalVolume(val);
    saveVolume(val);
  });

  document.getElementById('btn-theme').addEventListener('click', function() {
    toggleTheme();
  });
  document.getElementById('btn-compact').addEventListener('click', function() {
    toggleCompact();
  });

  document.getElementById('btn-info').addEventListener('click', function() {
    document.getElementById('info-modal').classList.remove('hidden');
  });
  document.getElementById('info-modal-close').addEventListener('click', function() {
    document.getElementById('info-modal').classList.add('hidden');
  });
  document.getElementById('info-modal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) e.target.classList.add('hidden');
  });

  var settingsModal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', function() {
    openSettingsModal();
  });
  document.getElementById('settings-modal-close').addEventListener('click', function() {
    closeSettingsModal();
  });
  settingsModal.addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeSettingsModal();
  });

  settingsModal.querySelectorAll('.settings-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchSettingsTab(tab.dataset.tab);
    });
  });

  document.addEventListener('click', function(e) {
    dropdownMenu.classList.add('hidden');
    volWrap.classList.add('hidden');
    if (!e.target.closest('.sound-picker')) closeAllSoundPickers();
  });

  window.addEventListener('scroll', function(e) {
    if (e.target.closest && e.target.closest('.sound-picker-panel')) return;
    closeAllSoundPickers();
  }, true);

  // Keyboard support for sound pickers
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var openPicker = document.querySelector('.sound-picker.open');
      if (openPicker) {
        closeAllSoundPickers();
        var trigger = openPicker.querySelector('.sound-picker-trigger');
        if (trigger) trigger.focus();
        e.stopPropagation();
      }
    }
  });
}

function closeAllSoundPickers() {
  document.querySelectorAll('.sound-picker.open').forEach(function(p) {
    p.classList.remove('open');
  });
}

// === Timer Grid Event Delegation ===
// Shared drag state (used by both card and segment drag handlers)
var dragSrcId = null;
var segDragSrcId = null;
var segDragTimerId = null;
var segDropPosition = null;

function handleGridMousedown(e) {
  // Chevron hold-to-repeat
  var chevron = e.target.closest('.time-chevron');
  if (chevron) {
    e.preventDefault();
    var wrap = chevron.closest('.time-input-wrap');
    var input = wrap.querySelector('.time-input');
    if (input.classList.contains('running')) return;
    var dir = chevron.dataset.dir === 'up' ? 1 : -1;
    startChevronRepeat(input, dir, commitTimeInput);
    return;
  }

  // Segment drag handle
  var segHandle = e.target.closest('.seg-drag-handle');
  if (segHandle) {
    var segRow = segHandle.closest('.segment-row');
    if (segRow) segRow.draggable = true;
    var card = e.target.closest('.timer-card');
    if (card) card.draggable = false;
    return;
  }

  // Card drag handle
  var handle = e.target.closest('.drag-handle');
  var card = e.target.closest('.timer-card');
  if (card) card.draggable = !!handle;
  if (card) card.querySelectorAll('.segment-row').forEach(function(r) { r.draggable = false; });
}

function handleGridDragStart(e) {
  // Segment drag
  var segRow = e.target.closest('.segment-row[draggable="true"]');
  if (segRow) {
    e.stopPropagation();
    segDragSrcId = segRow.dataset.segmentId;
    segDragTimerId = segRow.closest('.timer-card').dataset.timerId;
    segRow.classList.add('seg-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'seg:' + segDragSrcId);
    return;
  }

  // Card drag
  var card = e.target.closest('.timer-card');
  if (!card) return;
  dragSrcId = card.dataset.timerId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function handleGridDragOver(e) {
  var gridEl = document.getElementById('timer-grid');

  // Segment drag-over
  if (segDragSrcId) {
    var segRow = e.target.closest('.segment-row');
    if (!segRow || segRow.dataset.segmentId === segDragSrcId) return;
    e.preventDefault();
    var container = segRow.closest('.segments-container');
    container.querySelectorAll('.seg-drag-over-top, .seg-drag-over-bottom').forEach(function(el) {
      el.classList.remove('seg-drag-over-top');
      el.classList.remove('seg-drag-over-bottom');
    });
    var rect = segRow.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      segRow.classList.add('seg-drag-over-top');
      segDropPosition = 'before';
    } else {
      segRow.classList.add('seg-drag-over-bottom');
      segDropPosition = 'after';
    }
    return;
  }

  // Card drag-over
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var card = e.target.closest('.timer-card');
  if (card && card.dataset.timerId !== dragSrcId) {
    gridEl.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    card.classList.add('drag-over');
  }
}

function handleGridDrop(e) {
  var gridEl = document.getElementById('timer-grid');

  // Segment drop
  if (segDragSrcId) {
    e.preventDefault();
    e.stopPropagation();
    var targetRow = e.target.closest('.segment-row');
    if (!targetRow || targetRow.dataset.segmentId === segDragSrcId) return;

    var card = targetRow.closest('.timer-card');
    var timer = App.timers.get(card.dataset.timerId);
    if (!timer) return;

    var srcIdx = -1, tgtIdx = -1;
    timer.segments.forEach(function(s, i) {
      if (s.id === segDragSrcId) srcIdx = i;
      if (s.id === targetRow.dataset.segmentId) tgtIdx = i;
    });
    if (srcIdx === -1 || tgtIdx === -1) return;

    var seg = timer.segments.splice(srcIdx, 1)[0];
    var insertIdx = findSegmentIndex(timer, targetRow.dataset.segmentId);
    if (insertIdx === -1) return;
    if (segDropPosition === 'after') insertIdx++;
    timer.segments.splice(insertIdx, 0, seg);

    renderSegments(card, timer);
    persist();
    segDropPosition = null;
    return;
  }

  // Card drop
  e.preventDefault();
  var targetCard = e.target.closest('.timer-card');
  if (!targetCard || !dragSrcId) return;
  var targetId = targetCard.dataset.timerId;
  if (targetId === dragSrcId) return;

  var srcCard = gridEl.querySelector('[data-timer-id="' + dragSrcId + '"]');
  if (!srcCard) return;

  var placeholder = document.createElement('div');
  gridEl.insertBefore(placeholder, srcCard);
  gridEl.insertBefore(srcCard, targetCard);
  gridEl.insertBefore(targetCard, placeholder);
  gridEl.removeChild(placeholder);

  targetCard.classList.remove('drag-over');

  var cards = gridEl.querySelectorAll('.timer-card');
  var newTimers = new Map();
  cards.forEach(function(c, i) {
    var id = c.dataset.timerId;
    var timer = App.timers.get(id);
    if (timer) { timer.order = i; newTimers.set(id, timer); }
  });
  App.timers = newTimers;
  persist();
}

function handleGridDragEnd(e) {
  var gridEl = document.getElementById('timer-grid');

  if (segDragSrcId) {
    gridEl.querySelectorAll('.seg-dragging').forEach(function(el) { el.classList.remove('seg-dragging'); });
    gridEl.querySelectorAll('.seg-drag-over-top, .seg-drag-over-bottom').forEach(function(el) {
      el.classList.remove('seg-drag-over-top');
      el.classList.remove('seg-drag-over-bottom');
    });
    segDragSrcId = null;
    segDragTimerId = null;
    return;
  }

  var card = e.target.closest('.timer-card');
  if (card) card.classList.remove('dragging');
  gridEl.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
  dragSrcId = null;
}

function handleGridDragLeave(e) {
  var card = e.target.closest('.timer-card');
  if (card) card.classList.remove('drag-over');
}

function openCompactTimeEdit(card, timer) {
  var display = card.querySelector('.compact-time-display');
  var edit = card.querySelector('.compact-time-edit');
  if (!display || !edit) return;
  display.classList.add('hidden');
  edit.classList.remove('hidden');
  var t = msToHMS(timer.activeSegment.durationMs);
  var inputs = edit.querySelectorAll('.compact-time-input');
  inputs[0].value = String(t.h).padStart(2, '0');
  inputs[1].value = String(t.m).padStart(2, '0');
  inputs[2].value = String(t.s).padStart(2, '0');
  inputs[1].focus();
  inputs[1].select();
}

function closeCompactTimeEdit(card, commit) {
  var display = card.querySelector('.compact-time-display');
  var edit = card.querySelector('.compact-time-edit');
  if (!display || !edit || edit.classList.contains('hidden')) return;
  if (commit) {
    var ctx = getTimerFromEvent({target: card});
    if (ctx && ctx.timer.state === 'idle') {
      var inputs = edit.querySelectorAll('.compact-time-input');
      var h = Math.min(99, Math.max(0, parseInt(inputs[0].value, 10) || 0));
      var m = Math.min(59, Math.max(0, parseInt(inputs[1].value, 10) || 0));
      var s = Math.min(59, Math.max(0, parseInt(inputs[2].value, 10) || 0));
      var ms = (h * 3600 + m * 60 + s) * 1000;
      if (ms > 0) {
        ctx.timer.activeSegment.durationMs = ms;
        // Also update the hidden segment row inputs
        var segEl = ctx.card.querySelector('.segment-row.active') || ctx.card.querySelector('.segment-row');
        if (segEl) setSegmentTimeInputs(segEl, ms);
        display.textContent = formatCompactTime(ms);
        persist();
      }
    }
  }
  edit.classList.add('hidden');
  display.classList.remove('hidden');
}

function handleGridClick(e) {
  var gridEl = document.getElementById('timer-grid');

  // Compact time edit: click display to open
  var compactDisplay = e.target.closest('.compact-time-display');
  if (compactDisplay) {
    var ctx = getTimerFromEvent(e);
    if (ctx && ctx.timer.state === 'idle') {
      openCompactTimeEdit(ctx.card, ctx.timer);
    }
    return;
  }

  var colorBtn = e.target.closest('.color-btn');
  if (colorBtn) {
    var ctx = getTimerFromEvent(e);
    if (!ctx) return;
    var color = colorBtn.dataset.color;
    ctx.timer.color = color;
    applyTitleBarColors(ctx.card, color);
    ctx.card.querySelectorAll('.color-btn').forEach(function(btn) {
      var isSelected = btn.dataset.color === color;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
    persist();
    return;
  }

  // Sound picker item selection
  var pickerItem = e.target.closest('.sound-picker-item');
  if (pickerItem && !e.target.closest('.sound-picker-preview')) {
    var pickerCtx = getTimerFromEvent(e);
    if (!pickerCtx) return;
    var val = pickerItem.dataset.value;
    var pickerSegId = getSegmentFromEvent(e);
    var pickerSegIdx = pickerSegId ? findSegmentIndex(pickerCtx.timer, pickerSegId) : -1;
    var pickerSeg = pickerSegIdx !== -1 ? pickerCtx.timer.segments[pickerSegIdx] : pickerCtx.timer.activeSegment;
    pickerSeg.soundKey = val.startsWith('sound:') ? val.slice(6) : val;
    var pickerEl = pickerItem.closest('.sound-picker');
    if (pickerEl) {
      pickerEl.querySelector('.sound-picker-label').textContent = pickerItem.querySelector('.sound-picker-item-label').textContent;
      pickerEl.dataset.value = val;
      pickerEl.classList.remove('open');
      pickerEl.querySelectorAll('.sound-picker-item').forEach(function(item) {
        item.classList.toggle('selected', item.dataset.value === val);
      });
    }
    persist();
    return;
  }

  var actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  var ctx = getTimerFromEvent(e);
  if (!ctx) return;
  var timer = ctx.timer;
  var timerId = ctx.timerId;
  var action = actionEl.dataset.action;
  var segId = getSegmentFromEvent(e);
  var segIndex = segId ? findSegmentIndex(timer, segId) : -1;

  switch (action) {
    case 'play':
      closeAllSoundPickers();
      initAudio();
      setGlobalVolume(Number(App.volumeSlider.value));
      if (timer.state === 'idle') {
        var segEls = ctx.card.querySelectorAll('.segment-row');
        segEls.forEach(function(el, i) {
          if (timer.segments[i]) {
            var ms = readSegmentTimeInputs(el);
            if (ms > 0) timer.segments[i].durationMs = ms;
          }
        });
        timer._remainingAtPause = timer.activeSegment.durationMs;
        timer.start();
      } else if (timer.state === 'paused') {
        timer.resume();
      } else if (timer.state === 'completed') {
        stopRepeatSound();
        timer.reset();
        if (timer.repeat) timer.start();
        renderSegments(ctx.card, timer);
      }
      updateTimerCard(timer);
      persist();
      break;
    case 'pause':
      closeAllSoundPickers();
      timer.pause();
      updateTimerCard(timer);
      persist();
      break;
    case 'reset':
      closeAllSoundPickers();
      stopRepeatSound();
      timer.reset();
      renderSegments(ctx.card, timer);
      updateTimerCard(timer);
      persist();
      break;
    case 'settings':
      showSettingsPanel(timerId);
      break;
    case 'save-preset':
      saveTimerAsPreset(timerId);
      break;
    case 'delete':
      stopRepeatSound();
      App.timers.delete(timerId);
      removeTimerCard(timerId);
      persist();
      break;
    case 'delete-x':
      if (actionEl.classList.contains('confirm')) {
        stopRepeatSound();
        App.timers.delete(timerId);
        removeTimerCard(timerId);
        persist();
      } else {
        actionEl.classList.add('confirm');
        actionEl.textContent = 'Delete?';
        actionEl._confirmTimeout = setTimeout(function() {
          actionEl.classList.remove('confirm');
          actionEl.textContent = '\u00D7';
        }, 3000);
      }
      break;
    case 'add-segment':
      if (timer.state !== 'idle') break;
      timer.addSegment();
      renderSegments(ctx.card, timer);
      persist();
      break;
    case 'delete-segment':
      if (timer.state !== 'idle') break;
      if (segId && timer.segments.length > 1) {
        timer.removeSegment(segId);
        renderSegments(ctx.card, timer);
        persist();
      }
      break;
    case 'seg-toggle-sound':
      if (segIndex >= 0) {
        timer.segments[segIndex].soundEnabled = !timer.segments[segIndex].soundEnabled;
        actionEl.classList.toggle('muted', !timer.segments[segIndex].soundEnabled);
        persist();
      }
      break;
    case 'compact-toggle-sound':
      var allMuted = timer.segments.every(function(s) { return !s.soundEnabled; });
      timer.segments.forEach(function(s) { s.soundEnabled = allMuted; });
      var compactSndBtn = ctx.card.querySelector('.btn-compact-sound');
      if (compactSndBtn) compactSndBtn.classList.toggle('muted', !allMuted);
      ctx.card.querySelectorAll('.btn-sound-toggle').forEach(function(btn, i) {
        if (timer.segments[i]) btn.classList.toggle('muted', !timer.segments[i].soundEnabled);
      });
      persist();
      break;
    case 'toggle-sound-picker':
      var picker = actionEl.closest('.sound-picker');
      if (picker) {
        gridEl.querySelectorAll('.sound-picker.open').forEach(function(p) {
          if (p !== picker) p.classList.remove('open');
        });
        var wasOpen = picker.classList.contains('open');
        picker.classList.toggle('open');
        if (!wasOpen) {
          var panel = picker.querySelector('.sound-picker-panel');
          var triggerRect = actionEl.getBoundingClientRect();
          var panelHeight = SOUND_PICKER_MAX_HEIGHT;
          if (triggerRect.top > panelHeight + 8) {
            panel.style.bottom = (window.innerHeight - triggerRect.top + 4) + 'px';
            panel.style.top = 'auto';
          } else {
            panel.style.top = (triggerRect.bottom + 4) + 'px';
            panel.style.bottom = 'auto';
          }
          panel.style.left = triggerRect.left + 'px';
          panel.style.width = Math.max(240, triggerRect.width) + 'px';
        }
      }
      break;
    case 'preview-sound':
      e.stopPropagation();
      initAudio();
      setGlobalVolume(Number(App.volumeSlider.value));
      var soundVal = actionEl.dataset.sound;
      var soundKey = soundVal.startsWith('sound:') ? soundVal.slice(6) : soundVal;
      playSound(soundKey);
      break;
    case 'stop-sound':
      stopRepeatSound();
      timer.reset();
      if (timer.repeat) timer.start();
      renderSegments(ctx.card, timer);
      updateTimerCard(timer);
      persist();
      break;
  }
}

function handleGridChange(e) {
  var settingInput = e.target.closest('[data-setting]');
  if (settingInput) {
    var ctx = getTimerFromEvent(e);
    if (!ctx) return;
    ctx.timer[settingInput.dataset.setting] = settingInput.checked;
    persist();
  }
}

function handleGridBlur(e) {
  if (e.target.matches('.time-input')) {
    var ctx = getTimerFromEvent(e);
    if (!ctx || ctx.timer.state === 'running') return;
    var unit = e.target.dataset.unit;
    var val = parseInt(e.target.value, 10) || 0;
    if (unit === 'hours') val = Math.min(99, Math.max(0, val));
    else val = Math.min(59, Math.max(0, val));
    e.target.value = String(val).padStart(2, '0');
    commitTimeInput(e.target);
    return;
  }

  // Compact time edit: close on blur (defer to let focus settle)
  if (e.target.matches('.compact-time-input')) {
    var card = e.target.closest('.timer-card');
    if (card) {
      setTimeout(function() {
        var edit = card.querySelector('.compact-time-edit');
        if (edit && !edit.contains(document.activeElement)) {
          closeCompactTimeEdit(card, true);
        }
      }, 0);
    }
    return;
  }

  var titleEl = e.target.closest('.timer-title');
  if (titleEl && titleEl.contentEditable === 'true') {
    titleEl.contentEditable = 'false';
    var ctx = getTimerFromEvent(e);
    if (!ctx) return;
    ctx.timer.title = titleEl.textContent.trim() || 'Timer';
    titleEl.textContent = ctx.timer.title;
    persist();
  }
}

function handleGridFocus(e) {
  if (e.target.matches('.compact-time-input')) {
    e.target.select();
    return;
  }
  if (!e.target.matches('.time-input')) return;
  var ctx = getTimerFromEvent(e);
  if (ctx && ctx.timer.state === 'running') return;
  e.target.select();
}

function handleGridKeydown(e) {
  if (e.target.matches('.time-input')) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); adjustTimeInput(e.target, 1); commitTimeInput(e.target); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); adjustTimeInput(e.target, -1); commitTimeInput(e.target); return; }
    if (!/^\d$/.test(e.key) && ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'].indexOf(e.key) === -1) {
      e.preventDefault();
    }
    return;
  }

  if (e.target.matches('.compact-time-input')) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
    if (!/^\d$/.test(e.key) && ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'].indexOf(e.key) === -1) {
      e.preventDefault();
    }
    return;
  }

  var titleEl = e.target.closest('.timer-title');
  if (titleEl && titleEl.contentEditable === 'true' && e.key === 'Enter') {
    e.preventDefault();
    titleEl.blur();
  }
}

function handleGridDblclick(e) {
  var titleEl = e.target.closest('.timer-title');
  if (!titleEl) return;
  titleEl.contentEditable = 'true';
  titleEl.focus();
  var range = document.createRange();
  range.selectNodeContents(titleEl);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function handleGridWheel(e) {
  var input = e.target.closest('.time-input') || e.target.closest('.compact-time-input');
  if (!input || input.classList.contains('running')) return;
  e.preventDefault();
  var dir = e.deltaY < 0 ? 1 : -1;
  snapTimeInput(input, dir);
  if (input.classList.contains('compact-time-input')) return; // commit happens on blur
  commitTimeInput(input);
}

function attachGridListeners() {
  var gridEl = document.getElementById('timer-grid');
  gridEl.addEventListener('mousedown', handleGridMousedown);
  gridEl.addEventListener('dragstart', handleGridDragStart, true);
  gridEl.addEventListener('dragover', handleGridDragOver);
  gridEl.addEventListener('drop', handleGridDrop);
  gridEl.addEventListener('dragend', handleGridDragEnd);
  gridEl.addEventListener('dragleave', handleGridDragLeave);
  gridEl.addEventListener('click', handleGridClick);
  gridEl.addEventListener('change', handleGridChange);
  gridEl.addEventListener('blur', handleGridBlur, true);
  gridEl.addEventListener('focus', handleGridFocus, true);
  gridEl.addEventListener('keydown', handleGridKeydown);
  gridEl.addEventListener('dblclick', handleGridDblclick);
  gridEl.addEventListener('wheel', handleGridWheel, { passive: false });
}

function addTimer(durationMs, title) {
  title = title || 'Timer';
  var t = new Timer({ durationMs: durationMs, title: title, color: '#D4A843', soundKey: 'alarm', order: App.timers.size });
  App.timers.set(t.id, t);
  renderTimerCard(t);
  persist();
}

// === Init on DOM ready ===
document.addEventListener('DOMContentLoaded', init);
