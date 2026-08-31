# Dealer sprite drop folder

The finished transparent dealer images live in `source/` using these exact names:

- `idle.png` — relaxed neutral posture used between events
- `welcome.png` — open, welcoming posture for arrivals and reconnects
- `deal.png` — arm extended while dealing
- `waiting.png` — restrained impatient posture for turn timers
- `reveal.png` — hand on or lifting the hole card
- `dealer-win.png` — composed house-win posture
- `player-win.png` — conceding or presenting the player's win
- `blackjack.png` — stronger presentation for a natural blackjack
- `bust.png` — dry reaction to a player bust
- `table-event.png` — broad posture for pushes and multi-player results

Asset requirements:

- identical source-canvas dimensions for every file
- transparent background
- PNG with a clean alpha channel
- identical canvas, character scale, crop, lighting, and foot/waist anchor
- authoritative shared registration point: `X = 2205`, `Y = 304`
- do not trim or reposition individual poses; every pose must land correctly when placed at that same registration point
- keep hands, hair, and props inside a 70-pixel safe margin
- no baked-in text, cards, chips, table, glow, shadow, or background
- use the same costume, face, palette, and viewing angle in every pose

The current pack is complete: ten 1600 by 1600 PNGs are registered in `sprite-manifest.json`. The web renderer uses those exact source canvases and falls back to the local vector dealer only if an image cannot load. Use `/dev/dealer` in development to check every pose without changing table state.
