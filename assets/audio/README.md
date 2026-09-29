# Highlights video sound files (optional)

The highlights video generates all its sound in the browser. To use real recordings instead,
put audio files (mp3, wav or ogg) in this folder and list them in `sounds.json`:

```json
{
  "crowd": "crowd-loop.mp3",
  "cheer": "goal-cheer.mp3",
  "ooh": "crowd-ooh.mp3",
  "boo": "crowd-boo.mp3",
  "applause": "applause.mp3",
  "whistle": "whistle.mp3",
  "ref-talk": "referee-red-card.mp3"
}
```

| Name | Used for | Tips |
|---|---|---|
| crowd | background crowd noise throughout each clip (its volume follows the play) | a loop of 20 s or more, no big cheers in it |
| cheer | goals | 5-7 s, starts loud |
| ooh | near misses, saves, off the woodwork | 2-3 s |
| boo | yellow and red cards | 3 s |
| applause | after saves, goals and at full time | 5 s or more |
| whistle | fouls, half-time, full-time | one short blast |
| ref-talk | the referee speaking on a red card (plays during REF CAM) | 2-3 s |

Only list the sounds you have; anything missing uses the generated version. Use sounds you
have the rights to (e.g. CC0 / royalty-free sound libraries).
