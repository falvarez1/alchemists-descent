# Trickshot combat experiment

Enable **Controls & comfort → Combat experiment → Trickshot combat**. It defaults
off and persists on this browser. The four sliders deliberately remain exposed
while the pace and assistance are being playtested.

| Control | Default | Range |
| --- | --- | --- |
| Slow-motion speed | 35% | 20–80% |
| Slow-motion duration | 0.7 seconds | 0.3–1.2 seconds |
| Chain window | 2.6 seconds | 1.2–4.5 seconds |
| Aim assistance | 4 degrees | 0–8 degrees; zero disables snapping |

## Playable ideas

**Borrowed time.** Hit different enemies within the chain window to earn a brief
slow-motion beat. A kill or sever also earns one. Repeated hits on the same enemy
do not build a chain. Entry and recovery ease over 75 and 180 milliseconds;
simulation, materials, AI and rigid bodies retain their fixed-size ticks. Pausing
or manual stepping holds the real-time window. Continuous slowdown is bounded to
four seconds, followed by at least 0.6 seconds at normal speed.

**Thread the needle.** A dotted trajectory terminates at first contact. A mint
reticle identifies the contact; exposed Weaver legs turn it brass. Assistance
stays near the cursor, within the configured angle, and rejects covered targets.
A confirmed assisted lock steadies a single shot. Unassisted spread enlarges the
ring; homing, multicast, bombs and later ricochets use a broken uncertainty ring.
Seeking spells and streams keep free aim. Bolts, frost shards, ice lances, bombs
and meteors have previews. This is a snapshot of current geometry, so a moving
target can still evade a projectile in flight. The guide spends no mana or RNG
and does not advance the wand deck.

**Return with interest.** Shoot an exposed Weaver leg, walk over it, then swing
with the mapped melee key (**F** by default). When its owner is below 30% health
(capped at 40 HP), a small brass diamond and the melee hint identify the finishing
opportunity. A landed swing finishes it with stronger recoil, a slower beat and
“RETURNED WITH INTEREST.” The leg must belong to that Weaver: enemy identity,
pickup ownership and carried ownership survive saving. Another Weaver's leg and
healthy targets retain ordinary 24-damage melee. Cover and committed swing
direction still matter; missed swings do not spend durability.

The carried limb is now a hinged weapon. The wizard grips its ankle and drives
the thin shank with a spring at the wrist; the severed thigh hangs freely from
the knee under gravity. Walking, braking, reversing, jumping and water drag
change its momentum. A quick wrist stroke gathers the thigh and whips it forward.
Six short constraint steps keep both segment lengths fixed and turn the limb away
from floors and walls. Damage sweeps the actual thigh during ticks 6–15 of the
18-tick swing, after a harmless wind-up, and lands once per swing. Cover is tested
toward actual body contact, including ceiling-clinging Weavers whose body no
longer sits above their floor-based anchor. Committed aim remains bounded.
This physical handling applies with Trickshot off
too; the toggle controls assistance, chains and finish flourishes.

Solved joints interpolate between game ticks, including during slow motion.
Saving retains the limb's ownership and durability; transient swing momentum
resets after loading, respawning or a large teleport.

These adapt slow motion and expressive action from the
[publisher's description of My Friend Pedro](https://www.devolverdigital.com/games/my-friend-pedro)
to this game's material world and creature anatomy. They are an experiment, not
an exact reproduction of Pedro's combat system.

## Death with physical weight

The player now has eleven physical parts, nine limited revolute joints and a
loose hat. Torso, head, arms, knees and boots preserve incoming momentum, collide
with live terrain, and settle before the return action appears. Short physics
substeps apply only while the corpse is awake; ordinary gameplay keeps its
existing physics cadence. The renderer interpolates solved poses and uses the
living player's ivory coat, copper band, leather boots and skin palette. Cloth
panels follow the thighs. A small death panel leaves the body visible, and
respawning removes the entire rig.

The implementation uses Rapier's
[limited revolute joints](https://rapier.rs/docs/user_guides/javascript/joints/),
with self-collision excluded between the tiny overlapping body segments.

## Further experiments to judge after playing this version

- **Bank shot:** a deliberately equipped ricochet card highlights the next safe
  bounce and grants a chain extension for a confirmed banked hit.
- **Hat trick:** an airborne three-target sequence earns a brief flourish from
  the alchemist's hat, without moving the camera or hiding hazards.
- **Works accident:** dropping a severed support, opening a sluice, or knocking a
  crate into a foe counts only when player-caused physical events can be credited
  reliably. It should reward the existing simulation, not stage an unearned kill.

These three ideas are not implemented by this toggle. Initial tuning should
focus on readable targets, reliable leg shots, short recovery and player control.

## Verification

Focused tests cover settings bounds, distinct-target accounting, pause/manual
timing, cover, actual projectile/reticle contact, ownership, finishing damage,
Rapier joint separation, momentum and cleanup. Runtime probes use canonical run
commands and disclose their fixtures:

```text
node scripts/verify-trickshot-chain.mjs http://127.0.0.1:5182/
node scripts/verify-weaver-salvage.mjs http://127.0.0.1:5182/ trickshot
node scripts/verify-weaver-salvage.mjs http://127.0.0.1:5182/ whip
node scripts/verify-player-ragdoll.mjs http://127.0.0.1:5182/
```

Screenshots and clips are archived under the ignored `screenshots/` gallery.
The chain probe exercises real shots, measures slowdown and recovery, and checks
both enabled and disabled preferences after reload. The Weaver probe uses a
positioned resident and extra health with god mode disabled. Its controller can
reposition into a clear stance when the owner retreats behind a platform; it
never changes the enemy, cover, health or inventory during contact. The final
successful run needed no additional contact positioning and consumed five of
six uses, ending with **RETURNED WITH INTEREST**. The separate handling capture
samples 306 frames of real walking, braking, reversal, jumping and a wrist stroke;
both segment lengths remain fixed within 0.001 cells. Death fixtures use
real movement/gravity and an explicit lethal trigger, followed by the actual
return button. Automation verifies behavior; player judgement still decides pace
and entertainment value.

The combined source, including the waterfall and hinged-leg changes, passed
**105 test files / 1,145 tests**, typecheck, ESLint and the production build.
Current runtime and performance evidence is in [the implementation report](living-descent-fidelity-and-physics.md).
Actual fractional projectile contact has its own regression:
the cover test must floor coordinates before indexing the material array.
