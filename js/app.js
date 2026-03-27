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
  timer.complete();

  if (timer.soundEnabled) {
    initAudio();
    setGlobalVolume(Number(App.volumeSlider.value));
    if (timer.repeatSound) {
      startRepeatSound(timer.soundKey);
    } else {
      playSound(timer.soundKey);
    }
  }

  announce(timer.title + ' timer completed');

  if (timer.repeat && !timer.repeatSound) {
    setTimeout(function() {
      timer.reset();
      timer.start();
      updateTimerCard(timer);
      persist();
    }, 1500);
  }

  updateTimerCard(timer);
  persist();
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

  gridEl.addEventListener('mousedown', function(e) {
    var handle = e.target.closest('.drag-handle');
    var card = e.target.closest('.timer-card');
    if (card) card.draggable = !!handle;
  });

  gridEl.addEventListener('dragstart', function(e) {
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

    var rect = targetCard.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      gridEl.insertBefore(srcCard, targetCard);
    } else {
      gridEl.insertBefore(srcCard, targetCard.nextSibling);
    }

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

    switch (action) {
      case 'play':
        initAudio();
        setGlobalVolume(Number(App.volumeSlider.value));
        if (timer.state === 'idle') {
          var ms = readTimeInputs(ctx.card);
          if (ms > 0) { timer.setDuration(ms); timer.start(); }
        } else if (timer.state === 'paused') {
          timer.resume();
        } else if (timer.state === 'completed') {
          stopRepeatSound();
          timer.reset();
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
      case 'toggle-sound':
        timer.soundEnabled = !timer.soundEnabled;
        actionEl.classList.toggle('muted', !timer.soundEnabled);
        persist();
        break;
      case 'stop-sound':
        stopRepeatSound();
        timer.reset();
        if (timer.repeat) {
          timer.start();
        }
        updateTimerCard(timer);
        persist();
        break;
    }
  });

  // Change: settings toggles + preset select
  gridEl.addEventListener('change', function(e) {
    var settingInput = e.target.closest('[data-setting]');
    if (settingInput) {
      var ctx = getTimerFromEvent(e);
      if (!ctx) return;
      var setting = settingInput.dataset.setting;
      ctx.timer[setting] = settingInput.checked;
      if (setting === 'soundEnabled') {
        ctx.card.querySelector('.btn-sound-toggle').classList.toggle('muted', !ctx.timer.soundEnabled);
      }
      persist();
      return;
    }

    if (e.target.matches('.preset-select')) {
      var ctx = getTimerFromEvent(e);
      if (!ctx) return;
      var val = e.target.value;
      if (val.startsWith('sound:') || val.startsWith('msg:') || val.startsWith('cmsg:') || val.startsWith('csnd:')) {
        ctx.timer.soundKey = val.startsWith('sound:') ? val.slice(6) : val;
      } else {
        var ms = Number(val);
        if (ms > 0 && ctx.timer.state !== 'running') {
          ctx.timer.setDuration(ms);
          updateTimerCard(ctx.timer);
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
      var ms = readTimeInputs(ctx.card);
      ctx.timer.setDuration(ms);
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
