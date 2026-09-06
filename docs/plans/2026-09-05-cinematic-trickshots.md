# Cinematic Trickshots: Borrowed Time and Borrowed Limbs

Status: **design proposal; not implemented**. Requested September 5, 2026.
This plan expands the existing optional experiment. The equipment and habitat
physics fixes can ship independently; this document does not enable new combat.

## What exists, and why the expected animation is missing

The current **Controls & comfort → Combat experiment → Trickshot combat** setting
defaults off. `src/combat/Trickshot.ts` briefly slows the simulation after a kill,
leg sever, or hits on different enemies within a chain window. Defaults are 35%
speed, 700 ms duration and a 2.6-second chain window. A finisher gets about 945 ms
at 26% speed. Those are post-contact effects, not a directed action sequence.

An own-leg finisher currently requires that exact Weaver's leg, a real melee
contact, and health at or below `min(40, maxHp × 0.30)`. Its cue is a brass diamond
and “RETURNED WITH INTEREST.” There is no cinematic anticipation, multi-target
marking, coordinated projectile launch, or shared impact beat. Enabling the
current toggle cannot provide those missing sequences.

## Desired experience

The wizard sees an opportunity, chooses it, and performs something spectacular
using the same physical world. A knee snaps loose, the stolen limb whips around,
and its owner recognizes its own mistake. Elsewhere, three carefully selected
shots cross the room and strike on one satisfying beat. Movement, readable
hazards and believable contact remain central throughout.

Ship two independently tunable experiments: **Humiliation finishers** and
**Synchronized volleys**, beneath the existing master switch. Both default off
until playtesting establishes their parameters. Also separate camera movement,
hit pause and flash intensity from the mechanics for comfort settings.

## 1. Humiliation finisher: “Return to sender”

1. **Recognize the opportunity.** With the owner's leg equipped and the Weaver
   wounded, show a small bracket around its actual body and “LMB / F · Finish.”
   Show this only within plausible whip reach and clear contact geometry. The
   creature looks at the limb, retracts its surviving front legs and recoils.
   Use expression and posture, not a large modal prompt.
2. **Commit the wrist stroke.** LMB or F starts the same physical whip. The wizard
   plants a foot when grounded, twists the coat and draws the ankle back. The
   loose thigh still lags and folds at the knee; never straighten the limb for
   an animation. Airborne attempts use a shorter twisting pose.
3. **Anticipate contact.** During the final approach, ease toward 20–30% speed.
   Emphasize the knee arc with a short brass trail and quiet the ambience under
   a rising whip sound. Keep simulation timesteps unchanged; interpolate all
   articulated joints at render rate.
4. **Earn the impact.** Only a swept thigh/body collision confirms the finisher.
   On confirmation: a short real-time hit pause, compressed impact silhouette,
   leg recoil, and the Weaver buckling over its remaining feet. A heavy lateral
   strike can roll its corpse; an overhead strike folds it toward the ground.
   Blood, body impulse and debris use actual contact direction and momentum.
5. **Release the tension.** Show “RETURNED WITH INTEREST” once, play a dry shell
   crack followed by a small embarrassed chirr, then restore speed smoothly.
   Return camera framing without a snap. Preserve ordinary loot and limb
   durability; the spectacle should not generate duplicate rewards.

No automatic walk, teleport, guaranteed collision or invulnerability. If the
Weaver moves behind cover, another enemy intercepts the thigh, the player is
interrupted, or the limb breaks, resolve the physical outcome and return to
normal time. A miss gets a brief recovery, never the victory cue. The camera
must not hide an incoming hazard or move the cursor's world aim.

Initial whole sequence budget: **0.8–1.2 seconds of real time**, including at most
60 ms impact pause. Contact drives the phase change, not an arbitrary timer that
kills the creature before the leg lands. A stale opportunity expires after a
short bounded approach; it must not hold the world in slow motion indefinitely.

## 2. Synchronized volley: “One borrowed second”

**Proposed input:** hold a new remappable **Focus** action, provisionally **T** on
keyboard. Keep LMB casting/whipping, RMB throwing and G dropping intact. Add a
dedicated remappable controller action after auditing the existing bindings;
do not overload flask or climbing controls. Offer hold/toggle Focus for comfort.

While Focus is held, slow to approximately 30% speed for at most 1.5 real seconds.
Sweep the cursor across enemies to mark up to three distinct visible targets.
LMB commits; releasing Focus without committing cancels. Targets need to remain
inside the current view with a clear muzzle path. Merely being visible never
selects every enemy automatically. Preview circles show predicted contact points,
with thin numbered aim lines. A blocked path loses its solid lock immediately.

On commit, a short wand flourish forms three small alchemical lights at the
muzzle. They represent reserved shots and release as real projectiles. Start
with an explicitly supported straight-bolt **Volley multicast recipe**, supplied
by a clearly labeled experimental test loadout. Other spells show “Volley
unavailable for this spell” before marking;
bombs, streams, homing, ricochets and arbitrary wand modifiers come later.

### How different distances reach one beat

Predict each eligible projectile's interception time from its real launch point,
speed and the target's recent motion. Choose a shared future **simulation tick**
for arrival. Launch the longest flight first and delay nearer shots by their
travel-time differences. Prefer muzzle charge over slow bullets hanging near a
target. Reject combinations requiring more than 0.35 simulation seconds of
launch staggering or a shared intercept beyond 0.6 simulation seconds.

The supported recipe must legally produce all reserved projectiles in one cast;
the scheduler staggers that cast's emissions. It cannot compress several ordinary
casts through the wand's cooldown. General decks require a later feasibility
solver that includes legal cast/recharge times, or an explicit new burst ability
with its own cost. Keep that expansion outside the first prototype.

The selected aim vector commits when each shot launches. Projectiles retain
ordinary swept terrain/entity collision, speed and damage. Moving cover, a
target dodge or an intercepting enemy can spoil the volley. Do not pause a
bullet beside a victim, teleport hits, phase through terrain, or defer real
collision damage to fake synchrony. The marker is a forecast, not a promise.

For stationary unobstructed targets, all hits should fall within **one 60 Hz
simulation tick**. A successful shared beat combines the audio accents and one
brief hit pause, then displays “THREE ON THE BEAT.” Partial success reports only
confirmed hits and continues the normal chain. Never multiply camera shake for
each member of the volley.

### Resources and interruption

Preview must be side-effect free. On commit, reserve the supported multicast and
its full mana cost. Revalidate before the first emission, then spend and advance
that single cast exactly once and start its normal recharge. Before any emission,
canceling releases the reservation without a charge. After the first emission,
there is no refund; unlaunched members are canceled on death/transition and
previously launched shots continue normally. Lock wand switching only during the
short release sequence. A second commit, pause/resume,
target death, player death, level transition or input-device change cannot
duplicate reservations or leave Focus active. Releasing/canceling consumes no
mana and grants no unlimited free aiming time.

With a Weaver leg equipped, Focus may highlight the owner and a throw arc, but
it cannot cast the stowed wand. Multi-target leg throws are a later experiment.

## Presentation and tuning

Keep the current view and world-cell scale. Prefer a local light accent, subtle
vignette and readable motion trails to a full-screen blur or large zoom. Any
optional framing adjustment stays small and uses one camera transform for
terrain, creatures, particles and reticles. No sub-pixel layer drift. Labels
have text/shape cues, not color alone; reduced-motion mode removes framing and
long trails while retaining timing and targeting information.

| Parameter | First prototype | Trial range |
| --- | --- | --- |
| Focus speed / maximum hold | 30% / 1.5 s real | 20–50% / 0.8–2 s |
| Mark limit / acquisition dwell | 3 / 80 ms real | 2–4 / 40–140 ms |
| Focus cooldown after exit | 3 s real | 2–5 s |
| Finisher approach speed | 25% | 20–40% |
| Impact pause | 50 ms real | 0–70 ms |
| Return to normal speed | 180 ms real | 120–280 ms |
| Successful volley arrival spread | ≤1 simulation tick | hard acceptance limit |

Track every timer's clock explicitly. Pause freezes both scene and presentation
timers. One time director arbitrates Focus, finisher, hit pause and player death;
death cancels combat sequences, pause takes precedence, and slowdowns never
multiply. Add a maximum continuous slow-motion budget and mandatory recovery.

## Implementation order after design approval

1. **Timing and observability:** extend the experimental settings and introduce
   an explicit phase-based combat time director beside `Trickshot.ts`. Expose
   reason, phase, target IDs, reservations and effective scale to diagnostics.
2. **Finisher slice:** connect `WeaverLimbs.ts` / `HeldLeg.ts` contact to authored
   wrist/body poses, creature expressions, directional corpse impulse and audio.
   Wire renderer/HUD through `Ctx` and events. Test missed/blocked attempts first.
3. **Volley slice:** extract prediction shared with `AimGuide.ts`; add target
   selection and a bounded launch scheduler around `WandSystem.ts` and the
   projectile system. Start with three stationary targets, then moving targets.
4. **Presentation pass:** author impact poses and sound, validate normal and
   reduced-motion views, then expose tuning controls with concise explanations.
5. **Dogfood and decide:** record repeatable clips in ignored `screenshots/`, link
   them from its gallery, and compare responsiveness and clarity with flags off.

## Acceptance and evidence

- Finishing requires the correct limb, eligible living owner and actual contact.
  Test opposite facing, ceiling Weavers, missed swings, interception and depleted
  durability. Limb segment lengths remain bounded throughout slowdown/recovery.
- Three stationary visible targets receive real projectile hits within one tick;
  a new wall blocks a shot and a moving target can escape. No offscreen targeting.
- Mana, deck order and damage are identical to the corresponding legal casts.
  Verify cancellation, duplicate input, save/load and death at every phase. Save
  stable equipment/resources, not a half-complete cinematic or stale target IDs.
- Mouse and controller cues agree with actual bindings; the held leg hides the
  wand. Test 60/120/144 Hz presentation, pause, reduced motion and compact screens.
- Record before/after CPU frame p95 in the same seed/view, including a three-hit
  volley with water and foliage. Target ≤5% regression outside the effect and
  ≤1 ms added p95 during it; report actual GPU timing separately if available.
  No dropped simulation time, reduced cell fidelity or simulation-rate shortcut.
- Archive clips for own-leg success, blocked finisher, moving-target volley,
  interrupted volley and flags off. Evidence captions disclose console fixtures.

## Later variations worth testing

**Bankrupt:** a supported ricochet crosses two marked targets after banking off
metal. **Bad footing:** the final shot cuts a timber support under a surviving
enemy. **Cold reception:** freeze a Rillback's tail, then shatter the ice to throw
it into the current. **Encore:** a thrown own-leg kill earns its own short cue.
These need proven attribution and collision behavior before joining the first
prototype; none is implemented by this plan.
