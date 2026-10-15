#!/bin/env python3

import math
import numpy as np
import pathlib
import soundfile as sf
import subprocess
import tempfile

from scipy.signal import butter, sosfiltfilt

NOTES = {
        'C': -9,
        'Csh': -8,
        'D': -7,
        'Dsh': -6,
        'E': -5,
        'F': -4,
        'Fsh': -3,
        'G': -2,
        'Gsh': -1,
        'A': 0,
        'Ash': 1,
        'B': 2, 
        }

SAMPLERATE = 44100
DURATION = 1.0 # length of generated audio in seconds
N_PARTIALS = 12  # number of partials for partial decay tones
FREQ_CUTOFF = 5000
LP_CUTOFF = 1200


def calculate_frequency(note, octave):
    if note not in NOTES.keys():
        raise ValueError(f'Bad note: {note}')
    freq = 440 * 2**(((octave - 4)*12 + NOTES[note]) / 12)
    return freq


def make_empty_signal_array(freq):
    # set duration to an integer number of periods, for clean looping
    period = 1 / freq
    duration = math.floor(DURATION / period) * period

    linspace = np.linspace(0, duration, int(SAMPLERATE * duration), False)
    signal_array = np.zeros_like(linspace)
    return linspace, signal_array


def make_decay_partials_tone(freq, decay_power):
    linspace, signal_array = make_empty_signal_array(freq)

    for partial in range(1, N_PARTIALS):
        if freq * partial > FREQ_CUTOFF:
            print(f'Frequency {freq * partial} skipped')
            break
        amplitude = 1 / partial**decay_power
        signal_array += amplitude * np.sin(2 * np.pi * freq * partial * linspace)
    return signal_array


def make_custom_partials_tone(freq, amplitudes):
    linspace, signal_array = make_empty_signal_array(freq)

    for n, amplitude in enumerate(amplitudes):
        partial = n + 1
        if freq * partial > FREQ_CUTOFF:
            print(f'Frequency {freq * partial} skipped')
            break
        signal_array += amplitude * np.sin(2 * np.pi * freq * partial * linspace)
    return signal_array


def apply_lowpass_filter(signal_array, cutoff_freq):
    sos = butter(4, cutoff_freq, btype='low', fs=SAMPLERATE, output='sos')
    return sosfiltfilt(sos, signal_array)


def trim_signal_periods(signal_array, freq):
    samples_per_period = int(SAMPLERATE / freq)
    return signal_array[samples_per_period : -samples_per_period]


def write_file(signal_array, note, octave, opus_dir=None, mp3_dir=None):
    if not (opus_dir or mp3_dir):
        raise ValueError('Must give either opus_dir or mp3_dir')

    if opus_dir:
        pathlib.Path.mkdir(opus_dir, exist_ok=True)
    if mp3_dir:
        pathlib.Path.mkdir(mp3_dir, exist_ok=True)

    AMPLITUDE_LIMIT = 0.94
    max_abs_amplitude = np.max(np.abs(signal_array))
    print(f'amplitude: {max_abs_amplitude}')
    if max_abs_amplitude > AMPLITUDE_LIMIT:
        signal_array *= AMPLITUDE_LIMIT / max_abs_amplitude

    filename = f"{note}{octave}"
    with tempfile.TemporaryDirectory() as tempdir:
        tempwav = pathlib.Path(tempdir) / 'temp.wav'
        sf.write(tempwav, signal_array, SAMPLERATE)
        if opus_dir:
            subprocess.run([
                "ffmpeg",
                "-loglevel", "error",
                "-y",
                "-i", tempwav,
                "-c:a", "libopus",
                "-b:a", "256k",
                f"{opus_dir}/{filename}.opus"
                ], check=True)
        if mp3_dir:
            subprocess.run([
                "ffmpeg",
                "-loglevel", "error",
                "-y",
                "-i", tempwav,
                "-codec:a", "libmp3lame",
                "-b:a", "320k",
                f"{mp3_dir}/{filename}.mp3"
                ], check=True)


def make_synth_tones(output_dir):
    decay_power = 1.25

    custom_amplitudes = {
            "drone1": [1.0, 1.1, 0.2, 0.2, 0, 0, 0, 0],
            "drone2": [1.0, 1.0, 0.3, 0.3, 0, 0.0, 0, 0.08],
            "drone3": [1.0, 0.95, 0.5, 0.45, 0, 0.15, 0, 0.18],
            "drone4": [1.0, 0.9, 0.5, 0.6, 0, 0.25, 0, 0.24],
            }

    START_NOTE = 'C'
    START_OCTAVE = 2

    END_NOTE = 'D'
    END_OCTAVE = 4

    note_letters = list(NOTES)
    note_i = note_letters.index(START_NOTE)
    octave = START_OCTAVE

    opus_dir = pathlib.Path(output_dir) / './opus'
    mp3_dir = pathlib.Path(output_dir) / './mp3'

    pathlib.Path.mkdir(opus_dir, parents=True, exist_ok=True)
    pathlib.Path.mkdir(mp3_dir, parents=True, exist_ok=True)

    print(f'Saving to {opus_dir} and {mp3_dir}')

    MAKE_DECAY_TONES = True
    MAKE_CUSTOM_TONES = True

    while True:
        note = note_letters[note_i]
        freq = calculate_frequency(note, octave)

        if MAKE_DECAY_TONES:
            print(f'{note}{octave} decay partials')
            signal = make_decay_partials_tone(freq, decay_power)
            signal = apply_lowpass_filter(signal, LP_CUTOFF)
            signal = trim_signal_periods(signal, freq)
            write_file(signal, note, octave,
                       opus_dir=opus_dir / f'{decay_power:.2f}',
                       mp3_dir=mp3_dir / f'{decay_power:.2f}')
        if MAKE_CUSTOM_TONES:
            print(f'{note}{octave} custom partials')
            for name, amplitudes in custom_amplitudes.items():
                print(f'{name}: {amplitudes}')
                signal = make_custom_partials_tone(freq, amplitudes)
                signal = apply_lowpass_filter(signal, LP_CUTOFF)
                signal = trim_signal_periods(signal, freq)
                write_file(signal, note, octave,
                           opus_dir=opus_dir / name,
                           mp3_dir=mp3_dir / name)

        if note == END_NOTE and octave == END_OCTAVE:
            break
        note_i = (note_i + 1) % len(note_letters)
        if note_i == 0:
            octave += 1



if __name__ == '__main__':
    print('Running main')
    make_synth_tones('../assets/audio/')
