# Ilyra Voss and Brann Rook: playable Duel integration

Both fighters now use their complete armed animation sets in Duel. Each has ten melee attacks, an additional airborne jump, directional casts, four throws, grabs, shield reactions, dodges, recovery, ledges, movement transitions, status reactions and result poses. These changes run in local matches and on the LAN host. Guest controls request the same actions through protocol version 2.

## Controls

Default bindings are shown; remapped action and direction keys work too.

| Action | Keyboard | Standard controller |
| --- | --- | --- |
| Ground opener | F | A |
| Ground launcher | W + F | Up + A |
| Ground finisher | S + F | Down + A / sideways right stick |
| Up smash | Shift + W + F | Right stick up |
| Down smash | Shift + S + F | Right stick down |
| Neutral air | F in air, no direction | A in air, neutral left stick |
| Forward / back air | Forward / back + F in air | Forward / back + A in air |
| Up / down air | W / S + F in air | Up / down + A in air |
| Double jump | Release jump, then press it again in air | Release X/Y, then press again in air |
| Wall cling | Hold Shift beside a wall | Hold LB/RB beside a wall |

Forward and back are relative to the facing at attack startup. A back air hits behind the fighter; down air launches downward; neutral air and down smash cover either side. Landing or respawning refreshes the extra jump. Action locks, knockback and recovery prevent using it. The CPU can select the expanded attacks and preserves the facing used to select an aerial's contact volume.

Ilyra's added attacks are Cinderwheel, Recoil heel, Ember arc, Cinder heel, Phoenix uppercut and Ash sweep. Brann's are Boiler spin, Backplate strike, Chimney sweep, Iron plummet, Boiler uppercut and Foundry sweep. Each has separate timing, damage, reach and launch tuning.

## Kits and effects

Ilyra's Flash Crucible, Phoenix Draft, trail, burst, charge, fragments, priming spark and Scorch use the effect atlas. Brann's Boiler Guard, guard impacts, Pressure, Redline, jets, vents and armor fragments use the corresponding atlas. Effects follow simulation time, respect reduced-flash settings, expire, and clear on reset.

Stock hits now notify damage-taken passives without health loss. Landed melee, throws and projectiles notify damage-dealt passives and grant charge only when damage was accepted. This restores Brann's Pressure and Ilyra's Volatile Mixture in Stock combat. Scorch is a follow-up to an accepted hit, so the hit's newly granted invulnerability cannot swallow its bonus damage; its burn reaches the actual opponent body.

## Artwork and playback

- Each fighter has 63 armed runtime body clips. The export library also includes all 63 unarmed variants per fighter. Duel equips these fighters with their weapons; unarmed exports do not imply a separate unarmed control mode.
- This pass replaced locomotion, tumble, Ilyra's up-smash and ultimate, crucible rotation, forward throw and tactical equipment continuity, and added four Ilyra effects. Brann's earlier completion supplied its missing body and effect targets. Source prompts, receipts, registration and hashes are retained.
- Attack frames follow authoritative startup, active and recovery windows. One-shots restart on state changes; repeated drawing and hitstop cannot advance animation time.
- Locomotion and reactions select their dedicated clips. Pickup follows the existing equipment-swap timer; taunt follows the existing idle-fidget state. These are poses, not additional commands.
- Feet, center and ledge-grip anchors control placement. Per-frame cosmetic muzzle, hand, chest and feet sockets are included. Projectile origins and collision remain simulation geometry.
- Mirrored opponents retain their alternate costume colors. KO/result selection and reset behavior are connected to match state.

## Verification

The reproducible probes run against the actual local engine:

- `node scripts/verify-brann-playable.mjs <url> <fighter>`: controller and keyboard input, all six added attacks dealing damage, directional launch, extra jump and rejected third jump, effect drawing, expiry and reset. Run once per fighter ID.
- `node scripts/verify-brann-animations.mjs <url> <fighter>`: ten attacks across 30 animation phases per fighter, idle advancement, hitstop, both ledge grips and mirror-match rendering.
- `node scripts/verify-duo-completion.mjs <url>`: actual Pressure venting and Mixture/Scorch damage, burn and consumption; 23 additional pose selections per fighter; exact muzzle-to-blit agreement in both facings.
- `node scripts/verify-duel-lan.mjs <url> --duo`: independent host and guest browsers, Brann versus Ilyra, guest heavy/aerial input, damage, terrain, pause, results, rematch and reconnection. A two-physical-computer check remains separate.
- `node docs/arena/platform-fighter/sprite-library/animation-v2/tools/verify.mjs`: every export's transparency, bounds, timing and offline browser playback.

Evidence lives in `evidence/duo-*`, `evidence/ilyra-*` and `evidence/brann-*`. Rebuild each runtime atlas with `node scripts/arena-sprites/build-brann-animations.mjs ilyra-voss` and `node scripts/arena-sprites/build-brann-animations.mjs brann-rook`.

The full ten-character library remains `productionReady: false`: the other eight fighters and shared support targets remain in [completion.csv](completion.csv). This work is a local branch change; it does not publish a new public game build.
