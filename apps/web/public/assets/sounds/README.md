# Sound asset drop folder

Replace the generated development cues in this directory with the finished, licensed one-shot WAV files below. Keep the filenames exact; the web client already maps game events to them.

Incoming source packs and custom recordings belong in `source/`; see `source/README.md`. Keep source filenames and license documents intact until the final cues have been selected.

## Required cues

- `deal.wav` - one card leaving the shoe and landing; short and soft
- `flip.wav` - a single card turning face-up
- `chip.wav` - chips moving into or across the betting area
- `chip-land.wav` - a chip or small stack landing with weight
- `button.wav` - restrained interface press, suitable for frequent use
- `win.wav` - positive round result without a musical fanfare
- `loss.wav` - compact impact used with the loss animation and table shake
- `blackjack.wav` - the strongest positive cue, distinct from a normal win
- `reveal.wav` - dealer hole-card reveal with brief tension
- `notice.wav` - neutral turn, join, reconnect, or table notification

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
