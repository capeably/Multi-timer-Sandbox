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

// Apply saved theme immediately (before init)
(function() {
  try {
    var saved = localStorage.getItem('multitimer_theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch(e) {}
})();

function init() {
  var configs = loadTimers();
  if (configs.length === 0) configs.push(getDefaultTimerConfig());

  configs.sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
  configs.forEach(function(cfg) {
    var t = Timer.fromJSON(cfg);
    App.timers.set(t.id, t);
    renderTimerCard(t);
    if (t.state !== 'idle') {
      if (t.state === 'running' && t.remainingMs <= 0) {
        handleTimerComplete(t);
      } else {
        updateTimerCard(t);
      }
    }
  });

  App.volumeSlider = document.getElementById('volume-slider');
  App.volumeSlider.value = loadVolume();

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

// === Main Loop ===
var lastTickTime = 0;
var TICK_INTERVAL = 250;

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

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
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
    }, 1500);
  }

  updateTimerCard(timer);
  persist();
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

  document.addEventListener('click', function() {
    dropdownMenu.classList.add('hidden');
    volWrap.classList.add('hidden');
  });
}

// === Timer Grid Event Delegation ===
function attachGridListeners() {
  var gridEl = document.getElementById('timer-grid');
  var dragSrcId = null;

  // === Card-level drag (reorder timers) ===
  gridEl.addEventListener('mousedown', function(e) {
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
    // Reset all segment rows draggable
    if (card) card.querySelectorAll('.segment-row').forEach(function(r) { r.draggable = false; });
  });

  gridEl.addEventListener('dragstart', function(e) {
    // Segment drag is handled separately
    if (e.target.closest('.seg-drag-handle')) return;
    var card = e.target.closest('.timer-card');
    if (!card) return;
    dragSrcId = card.dataset.timerId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcId);
  });

  gridEl.addEventListener('dragend', function(e) {
    var card = e.target.closest('.timer-card');
    if (card) card.classList.remove('dragging');
    gridEl.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    dragSrcId = null;
  });

  gridEl.addEventListener('dragover', function(e) {
    if (segDragSrcId) return; // Skip card-level styling during segment drag
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var card = e.target.closest('.timer-card');
    if (card && card.dataset.timerId !== dragSrcId) {
      gridEl.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
      card.classList.add('drag-over');
    }
  });

  gridEl.addEventListener('dragleave', function(e) {
    var card = e.target.closest('.timer-card');
    if (card) card.classList.remove('drag-over');
  });

  gridEl.addEventListener('drop', function(e) {
    e.preventDefault();
    var targetCard = e.target.closest('.timer-card');
    if (!targetCard || !dragSrcId) return;
    var targetId = targetCard.dataset.timerId;
    if (targetId === dragSrcId) return;

    var srcCard = gridEl.querySelector('[data-timer-id="' + dragSrcId + '"]');
    if (!srcCard) return;

    // Swap positions
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
  });

  // === Segment drag (reorder segments within a timer) ===
  var segDragSrcId = null;
  var segDragTimerId = null;

  gridEl.addEventListener('dragstart', function(e) {
    var segRow = e.target.closest('.segment-row[draggable="true"]');
    if (!segRow) return;
    e.stopPropagation();
    segDragSrcId = segRow.dataset.segmentId;
    segDragTimerId = segRow.closest('.timer-card').dataset.timerId;
    segRow.classList.add('seg-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'seg:' + segDragSrcId);
  }, true);

  var segDropPosition = null; // 'before' or 'after'

  gridEl.addEventListener('dragover', function(e) {
    if (!segDragSrcId) return;
    var segRow = e.target.closest('.segment-row');
    if (!segRow || segRow.dataset.segmentId === segDragSrcId) return;
    e.preventDefault();
    var container = segRow.closest('.segments-container');
    container.querySelectorAll('.seg-drag-over-top, .seg-drag-over-bottom').forEach(function(el) {
      el.classList.remove('seg-drag-over-top');
      el.classList.remove('seg-drag-over-bottom');
    });
    // Determine if cursor is in top or bottom half
    var rect = segRow.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      segRow.classList.add('seg-drag-over-top');
      segDropPosition = 'before';
    } else {
      segRow.classList.add('seg-drag-over-bottom');
      segDropPosition = 'after';
    }
  });

  gridEl.addEventListener('drop', function(e) {
    if (!segDragSrcId) return;
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

    // Remove source from array
    var seg = timer.segments.splice(srcIdx, 1)[0];
    // Recalculate target index after removal
    var insertIdx = -1;
    for (var i = 0; i < timer.segments.length; i++) {
      if (timer.segments[i].id === targetRow.dataset.segmentId) { insertIdx = i; break; }
    }
    if (insertIdx === -1) return;
    // Insert before or after target
    if (segDropPosition === 'after') insertIdx++;
    timer.segments.splice(insertIdx, 0, seg);

    renderSegments(card, timer);
    persist();
    segDropPosition = null;
  });

  gridEl.addEventListener('dragend', function(e) {
    if (segDragSrcId) {
      gridEl.querySelectorAll('.seg-dragging').forEach(function(el) { el.classList.remove('seg-dragging'); });
      gridEl.querySelectorAll('.seg-drag-over-top, .seg-drag-over-bottom').forEach(function(el) {
        el.classList.remove('seg-drag-over-top');
        el.classList.remove('seg-drag-over-bottom');
      });
      segDragSrcId = null;
      segDragTimerId = null;
    }
  });

  // Click: actions + color buttons
  gridEl.addEventListener('click', function(e) {
    var colorBtn = e.target.closest('.color-btn');
    if (colorBtn) {
      var ctx = getTimerFromEvent(e);
      if (!ctx) return;
      var color = colorBtn.dataset.color;
      ctx.timer.color = color;
      applyTitleBarColors(ctx.card, color);
      ctx.card.querySelectorAll('.color-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.color === color);
      });
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

    // Find which segment this action belongs to (if any)
    var segId = getSegmentFromEvent(e);
    var segIndex = -1;
    if (segId) {
      for (var i = 0; i < timer.segments.length; i++) {
        if (timer.segments[i].id === segId) { segIndex = i; break; }
      }
    }

    switch (action) {
      case 'play':
        initAudio();
        setGlobalVolume(Number(App.volumeSlider.value));
        if (timer.state === 'idle') {
          // Sync all segment durations from DOM before starting
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
          renderSegments(ctx.card, timer);
        }
        updateTimerCard(timer);
        persist();
        break;
      case 'pause':
        timer.pause();
        updateTimerCard(timer);
        persist();
        break;
      case 'reset':
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
      case 'stop-sound':
        stopRepeatSound();
        timer.reset();
        if (timer.repeat) {
          timer.start();
        }
        renderSegments(ctx.card, timer);
        updateTimerCard(timer);
        persist();
        break;
    }
  });

  // Change: settings toggles + segment preset select
  gridEl.addEventListener('change', function(e) {
    var settingInput = e.target.closest('[data-setting]');
    if (settingInput) {
      var ctx = getTimerFromEvent(e);
      if (!ctx) return;
      var setting = settingInput.dataset.setting;
      ctx.timer[setting] = settingInput.checked;
      persist();
      return;
    }

    if (e.target.matches('.preset-select')) {
      var ctx = getTimerFromEvent(e);
      if (!ctx) return;
      var val = e.target.value;

      // Find which segment this select belongs to
      var segId = getSegmentFromEvent(e);
      var seg = null;
      if (segId) {
        for (var i = 0; i < ctx.timer.segments.length; i++) {
          if (ctx.timer.segments[i].id === segId) { seg = ctx.timer.segments[i]; break; }
        }
      }
      if (!seg) seg = ctx.timer.activeSegment;

      if (val.startsWith('sound:') || val.startsWith('msg:') || val.startsWith('cmsg:') || val.startsWith('csnd:')) {
        seg.soundKey = val.startsWith('sound:') ? val.slice(6) : val;
      } else {
        var ms = Number(val);
        if (ms > 0 && ctx.timer.state !== 'running') {
          seg.durationMs = ms;
          // Update the time inputs for this segment
          var segRow = e.target.closest('.segment-row');
          if (segRow) setSegmentTimeInputs(segRow, ms);
        }
      }
      persist();
    }
  });

  // Blur: time input validation + title save
  gridEl.addEventListener('blur', function(e) {
    if (e.target.matches('.time-input')) {
      var ctx = getTimerFromEvent(e);
      if (!ctx || ctx.timer.state === 'running') return;
      var unit = e.target.dataset.unit;
      var val = parseInt(e.target.value, 10) || 0;
      if (unit === 'hours') val = Math.min(99, Math.max(0, val));
      else val = Math.min(59, Math.max(0, val));
      e.target.value = String(val).padStart(2, '0');

      // Find which segment this input belongs to and update its duration
      var segRow = e.target.closest('.segment-row');
      var segId = segRow ? segRow.dataset.segmentId : null;
      if (segId) {
        for (var i = 0; i < ctx.timer.segments.length; i++) {
          if (ctx.timer.segments[i].id === segId) {
            ctx.timer.segments[i].durationMs = readSegmentTimeInputs(segRow);
            break;
          }
        }
      }
      ctx.timer._remainingAtPause = ctx.timer.activeSegment.durationMs;
      persist();
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
  }, true);

  gridEl.addEventListener('focus', function(e) {
    if (!e.target.matches('.time-input')) return;
    var ctx = getTimerFromEvent(e);
    if (ctx && ctx.timer.state === 'running') return;
    e.target.select();
  }, true);

  // Keydown: time input + title editing
  gridEl.addEventListener('keydown', function(e) {
    if (e.target.matches('.time-input')) {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
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
  });

  // Double-click: title editing
  gridEl.addEventListener('dblclick', function(e) {
    var titleEl = e.target.closest('.timer-title');
    if (!titleEl) return;
    titleEl.contentEditable = 'true';
    titleEl.focus();
    var range = document.createRange();
    range.selectNodeContents(titleEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
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
