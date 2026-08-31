# Source audio drop

Keep incoming audio untouched here. Runtime assets are served directly from these source subfolders so original filenames and provenance remain intact.

## Kenney Casino Audio Pack

Place the extracted pack, including its original filenames and license file, in:

`source/kenney-casino-audio/`

Do not rename the 54 effects. They will be auditioned for card dealing, card flipping, chip movement, chip landing, and useful variations. Keeping the original names preserves license provenance.

## Custom cues

Place the additional supplied sounds in:

`source/custom/`

Preferred names are:

- `notice.wav`
- `button.wav`
- `win.wav`
- `loss.wav`
- `blackjack.wav`
- `reveal.wav`

The client automatically prefers these custom filenames and falls back to the mapped Kenney cue when a file is absent. Extra variations are welcome, but require an explicit mapping. Preserve any license or authorship notes alongside the files.
