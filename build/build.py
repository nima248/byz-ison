#! /bin/env python3

'''
Simple build script to run before deployment
'''

import tone_generator
from pathlib import Path
import json

VERSION = 4  # for cache busting

def generate_audio_file_manifest(audio_dir):
    FILE_FORMATS = ['mp3', 'opus']
    save_file = audio_dir / 'audio-files.json'

    data = {}
    for format in FILE_FORMATS:
        top_dir = audio_dir / format

        dirs = [
            top_dir / d.name
            for d in sorted(top_dir.iterdir())
            if d.is_dir()
        ]
        print(f'{format} dirs:')
        for d in dirs:
            print(f'\t{d.name}')

        this_format = {}
        for category_dir in dirs:
            this_category = {}
            files = [
                f'{f.name}?v={VERSION}'
                for f in sorted(category_dir.iterdir())
                if f.is_file() and f.suffix.lower() == f'.{format}'
            ]

            for file in files:
                note, _ = file.split('-') if '-' in file else file.split('.')
                if note not in this_category.keys():
                    this_category[note] = []
                this_category[note].append(file)
            this_format[category_dir.name] = this_category
        data[format] = this_format

    data["version"] = str(VERSION)
    with save_file.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    print(f'Saved {len(data)} formats to {save_file}:')
    for format, categories in data.items():
        n_notes = 0
        n_files = 0
        try:
            for _, notes in categories.items():
                n_notes += len(notes)
                for note, files in notes.items():
                    n_files += len(files)
        except AttributeError:
            pass
        print(f'  - {format}: {len(categories)} categories, {n_notes} notes, {n_files} files')


def main():
    MAKE_SYNTH_TONES = False

    audio_dir = Path(__file__).resolve().parent.parent / 'assets' / 'audio'

    if MAKE_SYNTH_TONES:
        print('\n1. making synth tones')
        tone_generator.make_synth_tones(audio_dir)

    print('\n2. generating audio manifest')
    generate_audio_file_manifest(audio_dir)


if __name__ == '__main__':
    main()
