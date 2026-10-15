import { SoundSource } from "./SoundSource.js";
import * as math from "./math.js";
import * as util from "./util.js";
import { DEBUG } from "./config.js";

const audioDir = "/assets/audio/";

const N_VOICES_POLY = 10;
const NOTE_CHANGE_SPREAD_MS = 350;
const TOTAL_RESTART_TIME_MS = 9000; // should be approx length of audios

const AUDIO_TYPES_MONO = ["1.25", "drone1", "drone2", "drone3", "drone4"]; // mono types will loop without fading
const AUDIO_TYPES_POLY = ["vox1"]; // poly types will playback in unison and stagger fade

export class SoundManager {
  /* Manages SoundSource objects by directing them which audio
   *  files to play.
   */
  constructor() {
    this._soundSources = new Map();
    this.audioManifest = null;
    this._audioManifestLoadedPromise = new Promise((resolve) => {
      this._audioManifestLoadedPromiseResolve = resolve;
    });
    this._audioType = null;
    this._playbackType = null;
    this._audioFormat = null;
    this._nVoices = null;
    this._playbackRequested = false;
    this._lastNote = null;
    this._playTimeoutIds = new Set();
    this._playingSources = [];
    this._restartTimeoutId = null;
    this._nextRestart = 0;
  }

  initialise(audioType) {
    this._audioFormat = util.getSupportedAudioFormat();
    if (this._audioFormat) {
      console.info(`Audio format: ${this._audioFormat}`);
    } else {
      throw "No supported audio format!";
    }
    this.startFetchAudioManifest().then(() => {
      this._audioManifestLoadedPromiseResolve();
      this.setAudioType(audioType);
    });
    this._refreshNoteChangeSpread();
    this._calculatePanValues();
  }

  audioTypeAvailable(audioType) {
    if (
      Object.keys(this.audioManifest[this._audioFormat]).includes(audioType)
    ) {
      return true;
    }
    return false;
  }

  setAudioType(audioType) {
    if (!this.audioTypeAvailable(audioType)) {
      throw new Error(`Audio type ${audioType} unavailable!`);
    }
    if (audioType === this._audioType) {
      return;
    }
    this._stop(true);
    this._audioType = audioType;
    if (!this._soundSources[audioType]) {
      this._soundSources[audioType] = new Map();
    }
    if (AUDIO_TYPES_POLY.includes(audioType)) {
      this._playbackType = "poly";
      this._nVoices = N_VOICES_POLY;
    } else {
      if (!AUDIO_TYPES_MONO.includes(audioType)) {
        throw `audioType "${audioType}" doesn't appear in AUDIO_TYPES_MONO or AUDIO_TYPES_POLY`;
      }
      this._playbackType = "mono";
      this._nVoices = 1;
    }
    if (this._playbackRequested) {
      const playOk = this.playNote(this._lastNote, true);
      if (!playOk) {
        this._playbackRequested = false; // we can no longer honor the request
      }
    }
  }

  getPlaybackRequestedState() {
    return this._playbackRequested;
  }

  getAudioType() {
    return this._audioType;
  }

  startFetchAudioManifest() {
    return fetch(audioDir + "audio-files.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP error " + response.status);
        }
        return response.json();
      })
      .then((json) => {
        this.audioManifest = json;
      })
      .catch((e) => {
        console.error(`audio manifest initialisation error: ${e}`);
      });
  }

  audioManifestLoaded() {
    return this._audioManifestLoadedPromise;
  }

  /* To be called on startup, and when.
   * Loads a single voice for each
   */
  loadSound(frequencies) {
    const notes = frequencies.map((f) => util.calculateWestNote(f));
    notes.forEach((n) => {
      this._getSources(n.name, 1); // create a new source if none are present
    });
  }

  /* Return the list of SoundSource objects
   * which have an audio file for the given note name.
   * For nCreate > 0, that many new SoundSources
   * are created if they do not already exist.
   * The maximum number of SoundSources for each
   * note is the number of different audio files
   * available for that note.
   */
  _getSources(noteName, nCreate = 0) {
    if (!this._soundSources[this._audioType].has(noteName)) {
      this._soundSources[this._audioType].set(noteName, []);
    }
    if (nCreate > 0) {
      const currNSources =
        this._soundSources[this._audioType].get(noteName).length;
      const nUrls = this.urlsOfNote(noteName).length;
      nCreate = Math.min(nCreate, nUrls);
      for (let i = currNSources; i < nCreate; i++) {
        const url = this.urlsOfNote(noteName)[i];
        let loopWithoutFade, volume;
        if (this._playbackType == "mono") {
          loopWithoutFade = true;
          volume = 0.4;
        } else {
          loopWithoutFade = false;
          volume = 0.8 / this._nVoices ** (3 / 5);
        }
        this._soundSources[this._audioType]
          .get(noteName)
          .push(new SoundSource(url, loopWithoutFade, volume));
      }
    }
    return this._soundSources[this._audioType].get(noteName);
  }

  playFrequency(frequency) {
    const note = util.calculateWestNote(frequency);
    return this.playNote(note);
  }

  playNote(note, noMatchOk = false) {
    if (!this._haveAudioForNote(note)) {
      if (!noMatchOk) {
        console.warn(`Note ${note.name} has no matching audio file`);
      }
      return false;
    }
    this._playbackRequested = true;
    if (this._lastNote) {
      if (DEBUG) console.debug(`Stopping _lastNote ${this._lastNote.name}`);
      this._stop(true);
    }
    this._lastNote = note;
    if (DEBUG) console.debug(`Scheduling note ${note.name}`);
    const sources = this._getSources(note.name, this._nVoices);
    sources.forEach((source) => {
      source.setSemitonesOffset(note.semitonesOffset);
    });
    const startSourceI = math.randomInt(sources.length);
    for (let i = 0; i < this._nVoices; i++) {
      const thisSourceI = (startSourceI + i) % sources.length;
      const id = setTimeout(() => {
        const pan = this._panValues[i];
        sources[thisSourceI].play(pan);
        this._playingSources.push(sources[thisSourceI]);
      }, this._noteChangeSpreadMs[i]);
      this._playTimeoutIds.add(id);
    }
    this._nextRestartIndex = 0;
    if (this._playbackType == "poly") {
      this._scheduleNextRestart();
    }
    return true;
  }

  stop(fast = false) {
    this._playbackRequested = false;
    this._stop(fast);
  }

  _stop(fast = false) {
    /* Cancel all pending activities */
    this._playTimeoutIds.forEach((id) => {
      clearTimeout(id);
    });
    this._playTimeoutIds.clear();
    clearTimeout(this._restartTimeoutId);
    this._restartTimeoutId = null;
    this._playingSources = [];
    const sourceIdPairs = [];
    if (this._lastNote) {
      this._getSources(this._lastNote.name).forEach((source) => {
        source.cancelScheduledPlays();
        source.getPlayingIds().forEach((id) => {
          sourceIdPairs.push([source, id]);
        });
      });
    }
    /* Schedule the stop actions */
    this._refreshNoteChangeSpread();
    for (const [i, pair] of sourceIdPairs.entries()) {
      setTimeout(() => {
        const source = pair[0];
        const id = pair[1];
        source.stopId(id, fast);
      }, this._noteChangeSpreadMs[i]);
    }
  }

  _scheduleNextRestart() {
    let restartMs = TOTAL_RESTART_TIME_MS / this._nVoices;
    restartMs -= math.randomInt(restartMs * 0.25);
    this._restartTimeoutId = setTimeout(() => {
      if (this._nextRestartIndex > this._playingSources.length - 1) {
        this._nextRestartIndex = 0;
      }
      this._playingSources[this._nextRestartIndex].restartOldest();
      this._nextRestartIndex += 1;
      this._scheduleNextRestart();
    }, restartMs);
  }

  haveAudioForFreq(frequency) {
    const note = util.calculateWestNote(frequency);
    return this._haveAudioForNote(note);
  }

  _haveAudioForNote(note) {
    if (this._audioType == null) {
      return false;
    }
    return Object.keys(
      this.audioManifest[this._audioFormat][this._audioType],
    ).includes(note.name);
  }

  urlsOfNote(noteName) {
    const files =
      this.audioManifest[this._audioFormat][this._audioType][noteName];
    return files.map(
      (f) => `${audioDir}${this._audioFormat}/${this._audioType}/${f}`,
    );
  }

  _refreshNoteChangeSpread() {
    this._noteChangeSpreadMs = [0];
    if (this._nVoices > 1) {
      const inc = NOTE_CHANGE_SPREAD_MS / (this._nVoices - 1);
      const random = Math.floor(inc * 0.3);
      let last = 0;
      for (let i = 1; i < this._nVoices; i++) {
        last += inc + math.randomInt(random) - random / 2;
        this._noteChangeSpreadMs.push(last);
      }
    }
  }

  _calculatePanValues() {
    const pans = [];
    let maxPan = 0;
    if (this._nVoices === 1) {
      pans.push(0);
    } else {
      maxPan = Math.min((this._nVoices - 1) * 0.2, 1.0);
      const interval = (2 / (this._nVoices - 1)) * maxPan;
      const nLevels = Math.floor(this._nVoices / 2); // Excludes center level
      let level;
      if (this._nVoices % 2 === 1) {
        // Odd - one voice dead center
        pans.push(0);
        level = interval;
      } else {
        // Even - all voices panned
        level = interval / 2;
      }
      for (let i = 0; i < nLevels; i++) {
        pans.push(level, -level);
        level += interval;
      }
    }
    this._panValues = pans;
    if (DEBUG)
      console.debug(
        `Pans ${this._nVoices} (${maxPan.toFixed(2)}): ${pans.map((p) => p.toFixed(2))}`,
      );
  }
}
