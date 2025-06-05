🔴 Dead Space | 24/7 Soundscape

This stream is generated using a custom algorithm that mixes ambient sounds, music, and sound effects from the Dead Space games.
The algorithm is modeled after the Dead Space games' sound design, after analyzing the sound files from the games, and the atmospheres produced by them in-game.

I have whittled the full 45,392 sound files down to (currently, wip) 1,298 ambience related files, such as:
* Room tones / ambiences
* Machinery sounds
* Announcements, radio chatter, & auditory hallucinations
* Metallic scrapes, clangs, and creaks
* Environmental sounds (wind, water, alarms, electricity)
* Necromorph sounds (roars, screeches, attacks)
* NPC Sounds (screams, grunts, panic)
* Isaac's heartbeat and breathing
* Ambient music tracks
* And more!

Different mixes of different layers are cycled through to produce a constantly evolving soundscape.
Changes in panning, reverb, and volume are applied to give directionality to environmental sounds, creating a sense of space.

Includes audio from:
* Dead Space (2008)
* Dead Space 2 (+ Severed)
* Dead Space 3 (+ Awakened)

Extraction in progress for:
* Dead Space: Extraction
* Dead Space (Mobile)
* Dead Space (2023)

And possibly:
* Dead Space: Ignition
* Dead Space: Downfall
* Dead Space: Aftermath
* Dead Space: Deep Cover
* No Known Survivors

3 tiered system:

Tier one is the director, it plans out what layers to add, when they should end / start / transition as well as changing the intensity.

Tier two is the writer, it uses the director's plans and transitions settings for each layer, to smoothly transition them as directed, as well as choosing individual files and scheduling them.

Tier three is the producer, it takes the schedule, adds reverb and directionality (panning & volume & audio effects), stitching them together to be streamed.

Files will have different config, like...
Volume, used to set a the baseline, which can be then influenced through the tiers
Fade durations (in and out), as some will loop naturally without, others needing to fade.
Tags, specifying what kind of sound it is, it's type and intensity, to allow them to be carefully picked by the writer.

The layers and tags will also determine how sounds are handled, if they are directional, if all sounds will share the same direction, the volume, if pitch can be varied, if the files should stop and start abruptly (during quiet parts), if they should fade between or have gaps, how long the gaps should be, maybe the gaps and volume will decrease / Increase when the layer is starting / stopping or when the intensity changes, and plenty more.


As well as directionality, we will have vectors, direction + speed.
Some sounds may be moving over their duration, to seem more realistic if the source may also be mobile.

Use a radial coordinate system, centered around the listener.
Only half of the coordinates need to be used, unless we can simulate z-axis directionality with ear / headphones.
Rotation represents panning, and depth represents volume / muffling effects.

Perhaps some pattern loops should be used for layed vectors, so all sounds can share a general vector instead of each being independent.

Intensity may act on a tag or multiple, using a filtering system.

Start with specific in mind: Dead Space
After that, we can adjust for additional streams, such as Saw, Alien: Isolation, Minecraft, 

Each sound will have tags, stating what layers the sound fill fulfil.
It ensures no clashing tags in the future, also to aid the transition of states.

AMB: Ambience
  - BGT: Background Tone
  - AIR: Air Sounds
  - MAC: Machine Sounds
  - MUS: Music

SFX: Sound Effects
  - DRP: Water Drips
  - CRK: Metal Creeks
  - BNG: Items Banging

NEC: Necromorph Sounds
  - HUN: Hunter Sounds
  - PUK: Puker Sounds

Each tag should be categories of sounds that should not have multiple layers, e.g. air sounds, speech, water drips, Necromorphs
Tags can be primary or secondary, having some count toward selection but not elimination.


V1, set layers, going through intensity and inactive phases.
V2, dynamic layers, with advanced layer logic
V3, time-based generation, with advanced director