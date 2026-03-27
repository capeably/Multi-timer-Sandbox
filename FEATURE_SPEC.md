# Multi-Timer App — Complete Feature Specification

## Purpose
This document describes every feature of the Multi-Timer App in implementation-agnostic terms. It is intended to be given to a developer (or Claude Code) as a specification for rebuilding the app from scratch with a new UI/UX while preserving all functionality.

## Constraints
- The app MUST be a single self-contained HTML file with all CSS and JS inline (no ES modules, no external dependencies)
- Must work when opened directly via `file://` protocol (no server required)
- No external CDNs, frameworks, or build tools

---

## 1. Timer Engine

### 1.1 Timer Object
Each timer has these properties:
- **id** — unique identifier (UUID)
- **title** — display name (default: "Timer")
- **durationMs** — total duration in milliseconds (default: 60000)
- **color** — hex color code for visual theming (default: "#D4A843")
- **soundKey** — identifier for the sound to play on completion (default: "alarm"). Can be a built-in sound name, a `msg:` prefixed built-in message, a `cmsg:` prefixed custom message ID, or a `csnd:` prefixed custom sound ID
- **repeat** — boolean: auto-restart the timer when it completes
- **repeatSound** — boolean: loop the completion sound until the user manually stops it
- **soundEnabled** — boolean: whether to play any sound on completion (default: true)
- **order** — integer for display ordering

### 1.2 Timer States
Four states with these transitions:
- **idle** — initial state. Can transition to **running** (start)
- **running** — actively counting down. Can transition to **paused** (pause) or **completed** (when remainingMs reaches 0)
- **paused** — frozen mid-countdown. Can transition to **running** (resume)
- **completed** — timer finished. Triggers sound/notification behavior
- Any state can transition to **idle** via reset

### 1.3 Computed Properties
- **elapsedMs** — time elapsed since start. In running state: `now - startedAt`. In paused state: `durationMs - remainingAtPause`. In idle: 0. In completed: `durationMs`
- **remainingMs** — `max(0, durationMs - elapsedMs)`
- **progressPercent** — `(elapsedMs / durationMs) * 100`, clamped 0–100

### 1.4 Main Loop
- Uses `requestAnimationFrame` with a 250ms tick interval
- Each tick: for every running timer, check if `remainingMs <= 0` → trigger completion. Update UI for all running timers
- On browser tab visibility change (hidden → visible): immediately catch up — check all running timers for completion and update UI. This handles timers that expired while the tab was backgrounded

### 1.5 Timer Completion Behavior
When a timer completes:
1. Set state to **completed**
2. If `soundEnabled`: play the configured sound
3. If `repeatSound` AND `soundEnabled`: loop the sound every 10 seconds until user cancels
4. Announce completion to screen readers via aria-live region
5. If `repeat` AND NOT `repeatSound`: after a 1.5-second delay, automatically reset and restart the timer
6. If `repeat` AND `repeatSound`: wait for user to manually stop the sound (which also resets the timer)

---

## 2. Sound System

### 2.1 Built-in Sounds (Generated via Web Audio API)
All sounds are synthesized — no audio files needed:

| Key | Description |
|-----|-------------|
| **alarm** | 4 bursts of 800Hz square wave, 300ms apart, 150ms decay each |
| **bells** | 3 sine wave tones (523Hz, 659Hz, 784Hz — C-E-G chord), staggered 150ms, 1.5s exponential decay |
| **ding** | Single 1047Hz sine wave (C6), 1.2s exponential decay |
| **klaxon** | 3 bursts of sawtooth wave sweeping 400Hz→800Hz→400Hz, 600ms each, harsh/urgent |

### 2.2 Built-in TTS Messages
Three pre-configured spoken messages using the browser's `speechSynthesis` API:
- "Get back to work!"
- "Get up and stretch"
- "Keep going!"

When a TTS message plays, a "ding" sound plays first, followed by the spoken message after 800ms.

### 2.3 Custom Messages (User-Created TTS)
Users can create custom spoken messages with:
- **text** — the message to speak (up to 200 characters)
- **voiceName** — selected from available system voices via `speechSynthesis.getVoices()`
- **rate** — speech speed, 0.5x to 2.0x (step 0.1)
- **pitch** — voice pitch, 0.0 to 2.0 (step 0.1)
- **name** — auto-generated from first 30 characters of text
- **id** — unique identifier

Users can preview messages before saving. Custom messages appear in every timer's sound dropdown and can be edited or deleted.

### 2.4 Custom Sounds (User-Uploaded Audio)
Users can upload audio files:
- **Accepted formats**: MP3, WAV, OGG
- **Storage**: base64-encoded data URI in localStorage
- **Per-file warning**: files over 1 MB show a size warning
- **Total quota**: 3 MB across all custom sounds, with a visual storage usage bar
- **Properties**: id, name (max 50 chars), dataURI, mimeType, sizeBytes

Custom sounds appear in every timer's sound dropdown and can be previewed or deleted.

### 2.5 Global Volume
- Slider control: 0–100 range (default: 80)
- Affects all Web Audio API generated sounds via a master GainNode
- Also applied to custom sound Audio element playback
- Persisted to localStorage independently

---

## 3. Timer UI Controls

### 3.1 Per-Timer Controls
Each timer card provides:
- **Editable title** — double-click (or equivalent) to rename inline
- **Play button** — starts the timer from idle, or resumes from paused
- **Pause button** — visible only while running; pauses the countdown
- **Stop/Reset button** — visible while running or paused; returns to idle
- **Completed state button** — when completed, the play button becomes a reset button
- **Progress bar** — visual fill showing elapsed percentage, colored with the timer's theme color
- **Time display** — shows remaining time as HH:MM:SS. Editable when idle (user can type custom durations). Hours: 0–99, Minutes: 0–59, Seconds: 0–59
- **Sound/Preset dropdown** — combined selector with option groups (see 3.2)
- **Sound toggle** — mute/unmute button per timer
- **Settings button** — opens per-timer settings panel

### 3.2 Sound/Preset Dropdown
A single dropdown per timer with these option groups:
1. **Time Presets** — quick duration shortcuts: 1m, 5m, 10m, 15m, 30m, 45m, 1h. Selecting one changes the timer's duration
2. **Sounds** — built-in sounds: Alarm, Bells, Ding, Klaxon. Selecting one changes the completion sound
3. **Messages** — built-in TTS messages. Selecting one sets the completion sound to that message
4. **Custom Messages** — user-created TTS messages (if any exist)
5. **Custom Sounds** — user-uploaded audio files (if any exist)

### 3.3 Per-Timer Settings Panel
A popup/panel per timer containing:
- **Repeat timer** toggle — auto-restart on completion
- **Repeat sound until cancelled** toggle — loop sound continuously
- **Sound enabled** toggle — master sound switch for this timer
- **Color picker** — 6 color options: Gold (#D4A843), Blue (#4A90D9), Green (#5CB85C), Red (#D9534F), Black (#333333), White (#E8E8E8)
- **Save as Preset** button — saves current timer configuration as a reusable preset
- **Delete Timer** button — removes the timer

### 3.4 Repeat Sound Stop Banner
When a timer completes with `repeatSound` enabled, a prominent banner/overlay appears on the timer card with a "click to stop sound" action. Clicking it stops the sound loop and resets the timer.

---

## 4. Timer Management

### 4.1 Add Timer
A split button in the toolbar:
- **Main button**: adds a new timer with default settings (1 minute, Alarm sound)
- **Dropdown**: offers quick-add options:
  - Duration presets: 1m, 5m, 10m, 15m, 30m, 45m, 1h
  - Saved presets (if any exist), shown under a "SAVED PRESETS" section header

### 4.2 Drag-and-Drop Reordering
- Timers can be reordered by dragging from a drag handle
- Visual feedback: dragged timer reduces opacity; drop target shows a dashed border
- Order values are updated and persisted after each reorder

### 4.3 Default Timer
If no timers exist in storage on load, a single default timer is created with title "Your First Timer"

---

## 5. Presets

### 5.1 Preset Properties
A preset captures a complete timer configuration:
- name, title, durationMs, color, soundKey, repeat, repeatSound, soundEnabled

### 5.2 Creating Presets
From any timer's settings panel, clicking "Save as Preset" prompts for a name and saves the current timer's full configuration.

### 5.3 Editing Presets
In the Settings modal > Presets tab, each preset has an "Edit" button that opens a form overlay with all preset fields (name, title, duration H:M:S, sound dropdown, color picker, all three toggles). "Save Changes" persists edits; "Cancel" discards.

### 5.4 Deleting Presets
Each preset has a "Delete" button with a confirmation dialog.

### 5.5 Preset Integration
- Presets appear in the Add Timer dropdown menu
- Presets are included in export/import

---

## 6. Persistence

### 6.1 localStorage Keys
| Key | Contents |
|-----|----------|
| `multitimer_timers` | All timer objects including runtime state |
| `multitimer_globalVolume` | Volume level (0-100) |
| `multitimer_presets` | Array of preset objects |
| `multitimer_customMessages` | Array of custom TTS message objects |
| `multitimer_customSounds` | Array of custom sound objects (with base64 audio data) |

### 6.2 Runtime State Persistence
Timer runtime state (`_state`, `_startedAt`, `_remainingAtPause`) is saved to localStorage. On page reload:
- **Running timers**: resume counting from where they were. If the timer expired while the page was closed, immediately trigger completion
- **Paused timers**: restore to paused state with correct remaining time
- **Completed timers**: show as completed

### 6.3 Save Debouncing
Timer saves are debounced with a 300ms delay to avoid excessive writes. A `beforeunload` listener flushes any pending save.

### 6.4 State Change Persistence
All state transitions (start, pause, resume, reset, complete) trigger a persist operation, ensuring runtime state survives a page reload at any point.

---

## 7. Export / Import

### 7.1 Export
Exports a JSON file containing:
```json
{
  "version": 1,
  "exportedAt": "ISO-8601 timestamp",
  "presets": [...],
  "customMessages": [...],
  "customSounds": [...]
}
```
Filename format: `multi-timer-settings-YYYY-MM-DD.json`

Note: Active timers are NOT exported — only customization data (presets, messages, sounds).

### 7.2 Import
- User selects a JSON file
- **Preview**: shows count of presets, messages, and sounds before importing
- **Merge behavior**: if an imported item's ID matches an existing item, the existing item is updated. New items are appended
- After import: all dropdowns, menus, and lists are rebuilt

---

## 8. Settings Modal

A modal dialog with 4 tabs:

### 8.1 Presets Tab
- Descriptive text explaining how to create presets
- List of saved presets showing: color swatch, name, title, duration, sound label
- Edit and Delete buttons per preset
- Preset edit overlay (sub-modal) for full editing

### 8.2 Messages Tab
- Form: text input (200 char max), voice dropdown (system voices), speed slider (0.5-2x), pitch slider (0-2)
- Preview and Save buttons
- List of saved custom messages with preview, edit, and delete buttons

### 8.3 Sounds Tab
- File upload input (MP3/WAV/OGG)
- Name input (50 char max)
- Preview and Save buttons (disabled until file loaded)
- Storage usage bar (0-3 MB visual indicator)
- List of saved custom sounds with preview and delete buttons

### 8.4 Import / Export Tab
- Export section: description + Export button
- Import section: file picker, preview area, Import button

---

## 9. Accessibility

- **aria-live region** for announcing timer completions to screen readers
- **ARIA roles and labels** throughout: toolbar, progressbar (with valuemin/valuemax/valuenow), tablist/tab/tabpanel, button labels, group labels for color pickers
- **Screen-reader-only text** (visually hidden, accessible to assistive tech)
- **Keyboard accessible** controls

---

## 10. Visual Theming

### 10.1 Timer Colors
Each timer has a configurable color that applies to:
- Title bar background
- Progress bar fill (with gradient effect)
- Color swatch in preset lists

### 10.2 Color Options
Six built-in colors: Gold, Blue, Green, Red, Black, White. The White color uses dark text for contrast.

### 10.3 General Theme
- The app uses a light/white theme
- All text on light backgrounds must be dark/black for readability
- Font stack uses system fonts with monospace for time displays
