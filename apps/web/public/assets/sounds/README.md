# Sound library and custom drop folder

The 54 Kenney source effects in `source/kenney-casino-audio/` provide complete local fallbacks for cards, chips, controls, results, reveals, and notices. The web client varies repetitive card/chip sounds and never depends on a remote audio service.

Custom one-shots belong in `source/custom/`. The client automatically prefers the exact filenames below when they exist and falls back to the reviewed Kenney mapping when they do not. No code change is needed after dropping in a custom file.

## Required cues

- `button.wav` - restrained interface press, suitable for frequent use
- `win.wav` - positive round result without a musical fanfare
- `loss.wav` - compact impact used with the loss animation and table shake
- `blackjack.wav` - the strongest positive cue, distinct from a normal win
- `reveal.wav` - dealer hole-card reveal with brief tension
- `notice.wav` - neutral turn, join, reconnect, or table notification

`button.wav` and `loss.wav` are already present. Deal, flip, chip movement, and chip landing use the Kenney variations directly.

## Delivery specification

- uncompressed PCM WAV
- 48 kHz preferred; 44.1 kHz is acceptable
- 16-bit or 24-bit
- mono for focused impacts; stereo only when the width is intentional
- no leading silence and no hard cut at the tail
- keep normal cues under 700 ms; `win.wav`, `blackjack.wav`, and `reveal.wav` may run up to 1.5 seconds
- peak at or below -1 dBFS and leave the files un-normalized against one another so their intended relative loudness remains intact
- no spoken words, music loops, copyrighted samples, or baked-in casino ambience

The app is muted until the player enables sound. Effects and notification volume are controlled independently in Settings.

Keep the original license/provenance document for every source pack and custom cue alongside the source files before production distribution. `sound-manifest.json` records the custom and fallback mapping used by validation.
