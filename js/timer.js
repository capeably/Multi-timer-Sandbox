// ===== Timer Class =====
// No dependencies — loaded first

function Timer(opts) {
  opts = opts || {};
  this.id = opts.id || (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
  this.title = opts.title || 'Timer';
  this.color = opts.color || '#D4A843';
  this.repeat = !!opts.repeat;
  this.repeatSound = !!opts.repeatSound;
  this.autoAdvance = opts.autoAdvance !== undefined ? !!opts.autoAdvance : true;
  this.order = opts.order || 0;
  this._state = 'idle';
  this._startedAt = null;
  this._activeSegmentIndex = opts._activeSegmentIndex || 0;

  // Segments: each has { id, durationMs, soundKey, soundEnabled }
  if (opts.segments && opts.segments.length > 0) {
    this.segments = opts.segments.map(function(s) {
      return {
        id: s.id || Timer._genId(),
        durationMs: s.durationMs || 60000,
        soundKey: s.soundKey || 'alarm',
        soundEnabled: s.soundEnabled !== undefined ? !!s.soundEnabled : true,
      };
    });
  } else {
    // Single segment from legacy top-level properties
    this.segments = [{
      id: Timer._genId(),
      durationMs: opts.durationMs || 60000,
      soundKey: opts.soundKey || 'alarm',
      soundEnabled: opts.soundEnabled !== undefined ? !!opts.soundEnabled : true,
    }];
  }

  this._remainingAtPause = this.activeSegment.durationMs;
}

Timer._genId = function() {
  return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
};

Object.defineProperty(Timer.prototype, 'state', { get: function() { return this._state; } });

Object.defineProperty(Timer.prototype, 'activeSegment', { get: function() {
  return this.segments[this._activeSegmentIndex] || this.segments[0];
}});

// Legacy accessors — point to active segment
Object.defineProperty(Timer.prototype, 'durationMs', {
  get: function() { return this.activeSegment.durationMs; },
  set: function(v) { this.activeSegment.durationMs = v; }
});
Object.defineProperty(Timer.prototype, 'soundKey', {
  get: function() { return this.activeSegment.soundKey; },
  set: function(v) { this.activeSegment.soundKey = v; }
});
Object.defineProperty(Timer.prototype, 'soundEnabled', {
  get: function() { return this.activeSegment.soundEnabled; },
  set: function(v) { this.activeSegment.soundEnabled = v; }
});

Object.defineProperty(Timer.prototype, 'totalDurationMs', { get: function() {
  var total = 0;
  this.segments.forEach(function(s) { total += s.durationMs; });
  return total;
}});

Object.defineProperty(Timer.prototype, 'elapsedMs', { get: function() {
  if (this._state === 'running') return Date.now() - this._startedAt;
  if (this._state === 'paused') return this.activeSegment.durationMs - this._remainingAtPause;
  if (this._state === 'completed') return this.activeSegment.durationMs;
  return 0;
}});

Object.defineProperty(Timer.prototype, 'remainingMs', { get: function() {
  return Math.max(0, this.activeSegment.durationMs - this.elapsedMs);
}});

Object.defineProperty(Timer.prototype, 'progressPercent', { get: function() {
  if (this.activeSegment.durationMs === 0) return 0;
  return Math.min(100, (this.elapsedMs / this.activeSegment.durationMs) * 100);
}});

Timer.prototype.start = function() {
  if (this._state === 'running') return;
  this._remainingAtPause = this.activeSegment.durationMs;
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
  this._startedAt = Date.now() - (this.activeSegment.durationMs - this._remainingAtPause);
  this._state = 'running';
};
Timer.prototype.reset = function() {
  this._state = 'idle';
  this._startedAt = null;
  this._activeSegmentIndex = 0;
  this._remainingAtPause = this.segments[0].durationMs;
};
Timer.prototype.complete = function() {
  this._state = 'completed';
  this._startedAt = null;
  this._remainingAtPause = 0;
};

// Advance to next segment. Returns true if advanced, false if no more segments.
Timer.prototype.advanceSegment = function() {
  if (this._activeSegmentIndex >= this.segments.length - 1) return false;
  this._activeSegmentIndex++;
  this._remainingAtPause = this.activeSegment.durationMs;
  this._startedAt = Date.now();
  this._state = 'running';
  return true;
};

Timer.prototype.hasNextSegment = function() {
  return this._activeSegmentIndex < this.segments.length - 1;
};

Timer.prototype.setDuration = function(ms) {
  if (this._state === 'running') return;
  this.activeSegment.durationMs = Math.max(0, ms);
  this._remainingAtPause = this.activeSegment.durationMs;
  if (this._state === 'paused') this._state = 'idle';
};

Timer.prototype.addSegment = function(opts) {
  opts = opts || {};
  var seg = {
    id: Timer._genId(),
    durationMs: opts.durationMs || 60000,
    soundKey: opts.soundKey || 'alarm',
    soundEnabled: opts.soundEnabled !== undefined ? !!opts.soundEnabled : true,
  };
  this.segments.push(seg);
  return seg;
};

Timer.prototype.removeSegment = function(segId) {
  if (this.segments.length <= 1) return false;
  var idx = -1;
  for (var i = 0; i < this.segments.length; i++) {
    if (this.segments[i].id === segId) { idx = i; break; }
  }
  if (idx === -1) return false;
  this.segments.splice(idx, 1);
  if (this._activeSegmentIndex >= this.segments.length) {
    this._activeSegmentIndex = this.segments.length - 1;
  }
  return true;
};

Timer.prototype.toJSON = function() {
  return {
    id: this.id, title: this.title,
    color: this.color, repeat: this.repeat,
    repeatSound: this.repeatSound, autoAdvance: this.autoAdvance, order: this.order,
    segments: this.segments.map(function(s) {
      return { id: s.id, durationMs: s.durationMs, soundKey: s.soundKey, soundEnabled: s.soundEnabled };
    }),
    _state: this._state, _startedAt: this._startedAt,
    _remainingAtPause: this._remainingAtPause,
    _activeSegmentIndex: this._activeSegmentIndex,
  };
};
Timer.fromJSON = function(obj) {
  var t = new Timer(obj);
  if (obj._state) t._state = obj._state;
  if (obj._startedAt) t._startedAt = obj._startedAt;
  if (obj._remainingAtPause !== undefined) t._remainingAtPause = obj._remainingAtPause;
  if (obj._activeSegmentIndex !== undefined) t._activeSegmentIndex = obj._activeSegmentIndex;
  return t;
};
