// ===== Timer Class =====
// No dependencies — loaded first

function Timer(opts) {
  opts = opts || {};
  this.id = opts.id || (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  this.title = opts.title || 'Timer';
  this.durationMs = opts.durationMs || 60000;
  this.color = opts.color || '#D4A843';
  this.soundKey = opts.soundKey || 'alarm';
  this.repeat = !!opts.repeat;
  this.repeatSound = !!opts.repeatSound;
  this.soundEnabled = opts.soundEnabled !== undefined ? !!opts.soundEnabled : true;
  this.order = opts.order || 0;
  this._state = 'idle';
  this._startedAt = null;
  this._remainingAtPause = this.durationMs;
}

Object.defineProperty(Timer.prototype, 'state', { get: function() { return this._state; } });

Object.defineProperty(Timer.prototype, 'elapsedMs', { get: function() {
  if (this._state === 'running') return Date.now() - this._startedAt;
  if (this._state === 'paused') return this.durationMs - this._remainingAtPause;
  if (this._state === 'completed') return this.durationMs;
  return 0;
}});

Object.defineProperty(Timer.prototype, 'remainingMs', { get: function() {
  return Math.max(0, this.durationMs - this.elapsedMs);
}});

Object.defineProperty(Timer.prototype, 'progressPercent', { get: function() {
  if (this.durationMs === 0) return 0;
  return Math.min(100, (this.elapsedMs / this.durationMs) * 100);
}});

Timer.prototype.start = function() {
  if (this._state === 'running') return;
  this._remainingAtPause = this.durationMs;
  this._startedAt = Date.now();
  this._state = 'running';
};
Timer.prototype.pause = function() {
  if (this._state !== 'running') return;
  this._remainingAtPause = this.remainingMs;
  this._startedAt = null;
  this._state = 'paused';
};
Timer.prototype.resume = function() {
  if (this._state !== 'paused') return;
  this._startedAt = Date.now() - (this.durationMs - this._remainingAtPause);
  this._state = 'running';
};
Timer.prototype.reset = function() {
  this._state = 'idle';
  this._startedAt = null;
  this._remainingAtPause = this.durationMs;
};
Timer.prototype.complete = function() {
  this._state = 'completed';
  this._startedAt = null;
  this._remainingAtPause = 0;
};
Timer.prototype.setDuration = function(ms) {
  if (this._state === 'running') return;
  this.durationMs = Math.max(0, ms);
  this._remainingAtPause = this.durationMs;
  if (this._state === 'paused') this._state = 'idle';
};
Timer.prototype.toJSON = function() {
  return {
    id: this.id, title: this.title, durationMs: this.durationMs,
    color: this.color, soundKey: this.soundKey, repeat: this.repeat,
    repeatSound: this.repeatSound, soundEnabled: this.soundEnabled, order: this.order,
    _state: this._state, _startedAt: this._startedAt, _remainingAtPause: this._remainingAtPause,
  };
};
Timer.fromJSON = function(obj) {
  var t = new Timer(obj);
  if (obj._state) t._state = obj._state;
  if (obj._startedAt) t._startedAt = obj._startedAt;
  if (obj._remainingAtPause !== undefined) t._remainingAtPause = obj._remainingAtPause;
  return t;
};
