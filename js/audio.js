// ===== Audio =====
// Depends on: storage.js (loadCustomMessages, loadCustomSounds), App.volumeSlider

var audioCtx = null;
var masterGain = null;
var repeatInterval = null;
var activeSources = [];

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.connect(audioCtx.destination);
}

function setGlobalVolume(value) {
  if (!masterGain) return;
  masterGain.gain.setValueAtTime(value / 100, audioCtx.currentTime);
}

function playSound(soundKey) {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  switch (soundKey) {
    case 'alarm': return playAlarm();
    case 'bells': return playBells();
    case 'ding': return playDing();
    case 'klaxon': return playKlaxon();
    default:
      if (soundKey.startsWith('cmsg:')) {
        var msgId = soundKey.slice(5);
        var msgObj = loadCustomMessages().find(function(m) { return m.id === msgId; });
        if (msgObj) { playDing(); setTimeout(function() { speakCustomMessage(msgObj); }, 800); }
        else { playDing(); }
        return;
      }
      if (soundKey.startsWith('csnd:')) {
        var sndId = soundKey.slice(5);
        var sndObj = loadCustomSounds().find(function(s) { return s.id === sndId; });
        if (sndObj) { playCustomSound(sndObj); }
        else { playDing(); }
        return;
      }
      if (soundKey.startsWith('msg:')) {
        playDing();
        setTimeout(function() { speakMessage(soundKey.slice(4)); }, 800);
        return;
      }
      return playDing();
  }
}

function startRepeatSound(soundKey, intervalMs) {
  intervalMs = intervalMs || 20000;
  stopRepeatSound();
  playSound(soundKey);
  repeatInterval = setInterval(function() { playSound(soundKey); }, intervalMs);
}

function stopRepeatSound() {
  if (repeatInterval) { clearInterval(repeatInterval); repeatInterval = null; }
  activeSources.forEach(function(s) { try { s.stop(); } catch(e) {} });
  activeSources = [];
}

function trackSource(source) {
  activeSources.push(source);
  source.onended = function() { activeSources = activeSources.filter(function(s) { return s !== source; }); };
}

function playAlarm() {
  var now = audioCtx.currentTime;
  for (var i = 0; i < 4; i++) {
    var osc = audioCtx.createOscillator();
    var env = audioCtx.createGain();
    osc.type = 'square'; osc.frequency.value = 800;
    env.gain.setValueAtTime(0.3, now + i * 0.3);
    env.gain.setValueAtTime(0, now + i * 0.3 + 0.15);
    osc.connect(env); env.connect(masterGain);
    osc.start(now + i * 0.3); osc.stop(now + i * 0.3 + 0.15);
    trackSource(osc);
  }
}

function playBells() {
  var now = audioCtx.currentTime;
  [523, 659, 784].forEach(function(freq, i) {
    var osc = audioCtx.createOscillator();
    var env = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    env.gain.setValueAtTime(0.4, now + i * 0.15);
    env.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 1.5);
    osc.connect(env); env.connect(masterGain);
    osc.start(now + i * 0.15); osc.stop(now + i * 0.15 + 1.5);
    trackSource(osc);
  });
}

function playDing() {
  var now = audioCtx.currentTime;
  var osc = audioCtx.createOscillator();
  var env = audioCtx.createGain();
  osc.type = 'sine'; osc.frequency.value = 1047;
  env.gain.setValueAtTime(0.5, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  osc.connect(env); env.connect(masterGain);
  osc.start(now); osc.stop(now + 1.2);
  trackSource(osc);
}

function playKlaxon() {
  var now = audioCtx.currentTime;
  for (var i = 0; i < 3; i++) {
    var osc = audioCtx.createOscillator();
    var env = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now + i * 0.6);
    osc.frequency.linearRampToValueAtTime(800, now + i * 0.6 + 0.3);
    osc.frequency.linearRampToValueAtTime(400, now + i * 0.6 + 0.6);
    env.gain.setValueAtTime(0.25, now + i * 0.6);
    env.gain.setValueAtTime(0, now + i * 0.6 + 0.55);
    osc.connect(env); env.connect(masterGain);
    osc.start(now + i * 0.6); osc.stop(now + i * 0.6 + 0.6);
    trackSource(osc);
  }
}

function speakMessage(text) {
  if (!('speechSynthesis' in window)) return;
  var utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1; utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

function speakCustomMessage(msgObj) {
  if (!('speechSynthesis' in window)) return;
  var utter = new SpeechSynthesisUtterance(msgObj.text);
  utter.rate = msgObj.rate || 1;
  utter.pitch = msgObj.pitch || 1;
  if (msgObj.voiceName) {
    var voices = speechSynthesis.getVoices();
    var match = voices.find(function(v) { return v.name === msgObj.voiceName; });
    if (match) utter.voice = match;
  }
  speechSynthesis.speak(utter);
}

function playCustomSound(sndObj) {
  var audio = new Audio(sndObj.dataURI);
  audio.volume = App.volumeSlider ? (Number(App.volumeSlider.value) || 80) / 100 : 0.8;
  audio.play().catch(function() {});
}
