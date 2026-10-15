import { GamepadManager } from "./GamepadManager.js";
import { SoundManager } from "./SoundManager.js?v=4";
import { ScaleManager } from "./ScaleManager.js?v=2";

const MAX_PITCH_SHIFT = 6;
const MIN_PITCH_SHIFT = -8;
const DEFAULT_AUDIO_TYPE = "drone2";

const ACTIVE_NOTE_CLASS = "active-note";
const NO_AUDIO_AVAILABLE_CLASS = "no-audio-available";

const GAMEPAD = "8bitdo_zero_2";

const SETTINGS_LOCAL_STORAGE = "app_settings";

const DEFAULT_SETTINGS = {
  audio_type: null,
  semitones_shift: -2,
};

function saveSettings() {
  localStorage.setItem(SETTINGS_LOCAL_STORAGE, JSON.stringify(settings));
  console.log(`saved settings: ${JSON.stringify(settings)}`);
}

const saved_settings = localStorage.getItem(SETTINGS_LOCAL_STORAGE);
let settings = DEFAULT_SETTINGS;
if (saved_settings) {
  settings = {
    ...settings,
    ...JSON.parse(saved_settings),
  };
}

const soundManager = new SoundManager();
const audioType = settings["audio_type"] || DEFAULT_AUDIO_TYPE;
console.log("initial audio type set to ", audioType);
soundManager.initialise(audioType);
const scaleManager = new ScaleManager();
scaleManager.setSemitonesShift(settings["semitones_shift"]);
const gamepadManager = new GamepadManager(GAMEPAD, (action) => {
  console.log("Gamepad action ", action);
  if (action == "off") {
    turnOffSound();
  } else if (action) {
    const id = "note-" + action;
    const button = document.getElementById(id);
    noteHandler(button, false);
  }
});

const noteButtons = document.querySelectorAll(".note-btn");
const pitchButtons = document.querySelectorAll(".pitch-btn");
const body = document.querySelector("body");

let activeNoteButton = null;

const settingsPanel = document.getElementById("settings-panel");
const settingsBackdrop = document.getElementById("settings-backdrop");

function freqOfButton(button) {
  let note = button.id.replace("note-", "");
  let octave = 0;
  if (note.startsWith("low-")) {
    note = note.replace("low-", "");
    octave = -1;
  } else if (note.startsWith("high-")) {
    note = note.replace("high-", "");
    octave = 1;
  }
  note = note.replace("-", "_");
  return scaleManager.getFreq(note, octave);
}

async function setNotesAudioAvailableStatusAsync() {
  await soundManager.audioManifestLoaded();
  let haveAnyAudio = false;
  noteButtons.forEach((button) => {
    const freq = freqOfButton(button);
    if (soundManager.haveAudioForFreq(freq)) {
      haveAnyAudio = true;
      button.classList.remove(NO_AUDIO_AVAILABLE_CLASS);
    } else {
      button.classList.add(NO_AUDIO_AVAILABLE_CLASS);
    }
  });
  if (!haveAnyAudio) {
    console.error(
      "No available audio for audio type ",
      soundManager.getAudioType(),
    );
  }
}

function loadAudioAvailableNotes() {
  const enBut = getAudioAvailableButtons();
  const freqs = enBut.map((b) => freqOfButton(b));
  soundManager.loadSound(freqs);
}

function getAudioAvailableButtons() {
  const audioAvailableButtons = [];
  noteButtons.forEach((button) => {
    if (!button.classList.contains(NO_AUDIO_AVAILABLE_CLASS)) {
      audioAvailableButtons.push(button);
    }
  });
  return audioAvailableButtons;
}

function activateNoteButton(button) {
  button.classList.add(ACTIVE_NOTE_CLASS);
  activeNoteButton = button;
}

async function turnOffSound() {
  soundManager.stop();
  if (activeNoteButton) {
    activeNoteButton.classList.remove(ACTIVE_NOTE_CLASS);
    activeNoteButton = null;
  }
}

// Help with glitchy vertical height calculation on first load
function forceReflow() {
  setTimeout(() => {
    window.scrollTo(0, 0);
  }, 100);
}
if (document.readyState === "complete") {
  forceReflow();
} else {
  window.addEventListener("load", () => {
    forceReflow();
  });
}

addEventListener("DOMContentLoaded", () => {
  setNotesAudioAvailableStatusAsync().then(() => loadAudioAvailableNotes());
});

noteButtons.forEach((button) => {
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    noteHandler(button);
  });
});

async function noteHandler(button, gui_press = true) {
  if (
    (button.classList.contains(ACTIVE_NOTE_CLASS) && gui_press) ||
    button.classList.contains(NO_AUDIO_AVAILABLE_CLASS)
  ) {
    // deactivate
    turnOffSound();
  } else if (button === activeNoteButton) {
    // do nothing, it's already playing
  } else {
    // activate
    if (activeNoteButton) {
      activeNoteButton.classList.remove(ACTIVE_NOTE_CLASS);
    }
    button.classList.add(ACTIVE_NOTE_CLASS);
    activeNoteButton = button;
    const freq = freqOfButton(button);
    enableNoSleep();
    soundManager.playFrequency(freq);
  }
}

function setPitchShift(newShift) {
  const diff = newShift - scaleManager.getSemitonesShift();
  scaleManager.setSemitonesShift(newShift);
  setNotesAudioAvailableStatusAsync().then(() => loadAudioAvailableNotes());
  if (activeNoteButton !== null) {
    const freq = freqOfButton(activeNoteButton);
    if (soundManager.haveAudioForFreq(freq)) {
      soundManager.playFrequency(freq);
    } else {
      activeNoteButton.classList.add(NO_AUDIO_AVAILABLE_CLASS);
      turnOffSound();
    }
  }

  // update pitch buttons UI
  pitchShiftP.textContent = newShift;
  if (diff > 0) {
    pitchDownBtn.disabled = false;
    if (newShift === MAX_PITCH_SHIFT) {
      pitchUpBtn.disabled = true;
    }
  } else if (diff < 0) {
    pitchUpBtn.disabled = false;
    if (newShift === MIN_PITCH_SHIFT) {
      pitchDownBtn.disabled = true;
    }
  }
  settings["semitones_shift"] = newShift;
  saveSettings();
}

body.addEventListener("click", async (event) => {
  turnOffSound();
  console.log("body clicked");
});

const pitchDownBtn = document.querySelector("#pitch-down");
const pitchUpBtn = document.querySelector("#pitch-up");
const pitchShiftP = document.querySelector("#pitch-shift");
pitchShiftP.textContent = scaleManager.getSemitonesShift();

pitchButtons.forEach((button) => {
  button.addEventListener("click", async (event) => {
    event.stopPropagation();

    const semitonesChange = button.id === "pitch-up" ? 1 : -1;
    const newPitchShift = scaleManager.getSemitonesShift() + semitonesChange;
    setPitchShift(newPitchShift);
  });
});

// Settings panel  -----------------------------------------------------------
function openSettings() {
  settingsPanel.classList.add("open");
  settingsPanel.setAttribute("aria-hidden", "false");
  settingsBackdrop.hidden = false;
  //document.body.style.overflow = "hidden"; // prevent background scroll
}

function closeSettings() {
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
  settingsBackdrop.hidden = true;
  //document.body.style.overflow = "";
}

function toggleSettings() {
  settingsPanel.classList.contains("open") ? closeSettings() : openSettings();
}

settingsBackdrop.addEventListener("click", (event) => {
  event.stopPropagation();
  closeSettings();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && settingsPanel.classList.contains("open")) {
    closeSettings();
  }
});

document.getElementById("open-settings").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleSettings();
});
document.getElementById("close-settings").addEventListener("click", (event) => {
  event.stopPropagation();
  closeSettings();
});

settingsPanel.addEventListener("click", async (event) => {
  event.stopPropagation();
});

const audioTypeButtons = document.querySelectorAll("input[name=audioType]");
audioTypeButtons.forEach((button) => {
  if (button.value === settings["audio_type"]) {
    button.checked = true;
  }
  button.addEventListener("change", async (event) => {
    event.stopPropagation();
    if (button.checked) {
      let newAudioType = button.value;
      console.log(`Selected audio type: ${newAudioType}`);
      settings["audio_type"] = newAudioType;
      saveSettings();
      soundManager.setAudioType(newAudioType);
      await setNotesAudioAvailableStatusAsync();
      const playing = soundManager.getPlaybackRequestedState();
      if (!playing) {
        turnOffSound();
      }
      loadAudioAvailableNotes();
    }
  });
});

const noSleepVideo = document.getElementById('nosleep-video');

function enableNoSleep() {
  noSleepVideo.play().catch(err => {
    console.log('Video wake lock blocked: ', err);
  });
}

function disableNoSleep() {
  noSleepVideo.pause();
}
