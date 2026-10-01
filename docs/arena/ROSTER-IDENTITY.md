# Roster identity: what makes each fighter *different*

**Status: design intent, first draft (2026-10-01).** Numbers here are starting points for the body profiles
(`docs/arena/FIGHTER-PHYSICS.md`) and are expected to move after the first telemetry passes
(`docs/arena/TELEMETRY-AND-BALANCE.md`). What must survive tuning is the *identity*: the archetype, the way the fighter
moves, and the fingerprint it leaves in the numbers.

## The problem this document solves

Today the ten fighters differ in their look and in three abilities each (a passive, a tactical on Z, an ultimate on T). They
share one body: the same height, the same weight, the same run, jump, gravity, air control, levitation and knockback, the
same wands and kick. In a Smash-style game the *body* is half of a character: how far a hit sends you, how quickly you
stop, how high you jump, how long you hang in the air. Two fighters with identical bodies feel like the same character with
different buttons.

The target is the Smash standard: pick any two fighters and, before a single ability is used, they should already **move,
fall, get hit and recover differently**, and their abilities should lean into that.

## The four layers of a fighter (the checklist every sheet below answers)

1. **Body.** Weight (knockback taken), run speed, traction (how quickly it starts and stops), air control, jump, gravity and
   fall speed, levitation (the LEV jet), climb, health, damage dealt. A `BodyProfile` of multipliers on the Alchemist's 1.00.
2. **Movement technique.** One signature way of getting around that no other fighter has (a slide, a glide, a hook swing,
   a wall-run, a charge). Some exist already (Selene's slide, Sable's tether, Kest's climb, Rusk's ram); the rest are new
   (`MOVESET v2` below and in the master plan, phase 6).
3. **Kit.** Passive, tactical (Z), ultimate (T): what exists in `docs/FIGHTERS.md` today, tuned for the role.
4. **Weapon style.** What its basic attack *is*. Today every fighter uses the wand cards and the kick. Phase 6 gives each a
   signature loadout (and, where the kit calls for it, a signature melee), so the primary attack is part of the identity.

## How we will know it worked (the distinctness test)

For every fighter there is a **telemetry fingerprint**: a short list of metrics where the fighter must land in the top or
bottom of the roster. If a sheet's fingerprint does not show up in 200 bot fights, the fighter is not distinct enough, and
that is a bug in the design as much as in the numbers.

The body numbers below are multipliers on the Alchemist (1.00 = unchanged). `wt` weight, `run`, `trac` traction,
`air` air control, `jmp` jump, `grv` gravity, `fall` max fall speed, `lev` levitation, `clm` climb, `hp`, `dmg` damage dealt.

| # | Fighter | Archetype | wt | run | trac | air | jmp | grv | fall | lev | clm | hp | dmg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | Ilyra Voss | Rushdown / burst | 0.95 | 1.10 | 1.00 | 1.10 | 1.05 | 1.00 | 1.00 | 1.00 | 1.00 | 0.95 | 1.05 |
| 02 | Brann Rook | Heavy bruiser / wall | 1.45 | 0.80 | 1.20 | 0.75 | 0.85 | 1.25 | 1.25 | 0.55 | 0.80 | 1.35 | 1.10 |
| 03 | Sable Fen | Hunter / assassin | 0.90 | 1.00 | 1.00 | 1.05 | 1.00 | 1.00 | 1.00 | 0.90 | 1.20 | 0.95 | 1.00 |
| 04 | Mara Quell | Floaty zoner | 0.80 | 0.90 | 0.90 | 1.20 | 1.00 | 0.80 | 0.75 | 1.50 | 0.90 | 0.85 | 0.95 |
| 05 | Kest Rel | Speedster / climber | 0.85 | 1.25 | 0.85 | 1.15 | 1.10 | 1.00 | 1.00 | 1.10 | 1.50 | 0.90 | 1.00 |
| 06 | Nox Calder | Stalker / denial | 1.00 | 0.95 | 1.10 | 0.95 | 0.95 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| 07 | Edda Morrow | Glass-cannon support | 0.75 | 0.95 | 1.00 | 1.15 | 1.00 | 0.85 | 0.85 | 1.30 | 0.90 | 0.75 | 1.00 |
| 08 | Selene Wraith | Momentum trickster | 0.90 | 1.15 | 0.55 | 1.20 | 1.10 | 1.00 | 1.00 | 1.00 | 1.00 | 0.90 | 1.00 |
| 09 | Rusk Emberjaw | Charging bruiser | 1.30 | 0.90 | 1.30 | 0.80 | 0.85 | 1.20 | 1.20 | 0.60 | 0.90 | 1.25 | 1.10 |
| 10 | Father Thorne | Anchored trapper | 1.15 | 0.80 | 1.40 | 0.80 | 0.90 | 1.00 | 1.00 | 0.80 | 1.00 | 1.10 | 1.00 |

The Alchemist row (the control, no fighter) stays at all-1.00 so every fighter can be compared with the baseline.

---

## 01 Ilyra Voss: the Cinder Alchemist (rushdown / burst)

- **Feel.** Quick, aggressive, a little reckless: closes the gap, bursts, and keeps moving.
- **Body.** Slightly light, quick on the ground and a touch floaty in the air; average health. Fast enough to out-run a
  heavy, light enough to be launched by one.
- **Movement technique (new).** *Cinder Dash:* a short, horizontal air dash on the jump button's double-tap, costing a slice
  of LEV, that leaves a few Ember cells. Rewards chaining a hit into a dash into a kick.
- **Kit.** Volatile Mixture (two weapons, then Scorch), Flash Crucible (a lobbed vial that shoves everyone, herself
  included: the vial is also a movement tool), Phoenix Draft (fire-proof, burning dash trail).
- **Weapon style (phase 6).** A flintlock-and-flask loadout: a fast spark pistol and a flame jet, so "two different weapons"
  is something she does every few seconds.
- **Strengths.** Burst damage, escape through her own blast, the only fighter that is fire-proof on demand.
- **Weaknesses.** Low health, no armor, no defensive tool; loses to a patient heavy who can tank the burst.
- **Counters / counter-play.** Brann's plate eats her pistol; Mara's bells and chime punish her approach.
- **AI playbook.** Close to mid range, weave in and out; throw the crucible at a foe's feet at about range 40, then dash in;
  keep Phoenix Draft for a lead-taking trade, not for the opening.
- **Fingerprint.** Top-3 damage per second, bottom-3 health remaining at the end of won fights, many dashes per minute,
  short fights.

## 02 Brann Rook: the Iron Pilgrim (heavy bruiser / wall)

- **Feel.** An iron wall that walks forward. Slow to get anywhere, hard to move once there.
- **Body.** The heaviest in the roster (knockback taken x0.69 equivalent), slow run and a low jump, falls hard, barely
  levitates. A lot of health. He stops the moment he lets go of the key (high traction).
- **Movement technique (new).** *Piston Stomp:* press down in the air to fall at max speed and land with a shockwave and a
  short stagger on nearby foes; on the ground it is a stomp that plants him (immune to knockback for a moment).
- **Kit.** Pressure Vessel (damage fills Pressure, then brief stagger resistance and a steam vent), Boiler Guard (a frontal
  plate that eats shots and halves frontal melee), Redline (armor of stone, steam that scalds).
- **Weapon style (phase 6).** A steam-piston fist: slow, short range, huge knockback; his wand is a boiler-bolt that is
  strong at point blank and bad at range.
- **Strengths.** Takes a beating, dominates a stage's centre, wrecks anyone who must fight him up close.
- **Weaknesses.** Cannot chase, cannot recover from a ring-out (low LEV, low jump), loses to range and to being kited;
  a plate that faces only one way.
- **AI playbook.** Walk to the centre and hold it; raise the plate when a shot is incoming and the shooter is in front;
  Redline when the opponent is within 25; never leave the ground without a reason.
- **Fingerprint.** Top-1 health remaining, top-1 damage taken, bottom-2 distance travelled, bottom-1 airtime, highest
  armor absorbed.

## 03 Sable Fen: the Mire Stalker (hunter / assassin)

- **Feel.** Patient. Wounds a target, follows its trail, and ends it. Mobile along surfaces.
- **Body.** Average weight and speed, a little less levitation but a much better climb: she travels on walls and ceilings
  with the tether rather than through the air.
- **Movement technique.** *Bogline* (already a tether and a hook-haul) is her signature; new: *Wall-cling* (stick to a wall
  without spending LEV for a short time, then drop with a wall-jump boost).
- **Kit.** Wounded Spoor (wounded foes leave a visible trail), Bogline (a tether that hauls her to rock or yanks a foe), Bloodsense
  (reveals wounded foes through walls, a small speed boost).
- **Weapon style (phase 6).** A bog-hook and a thorn-spitter: low burst, constant small wounds, so Spoor and Bloodsense are
  always relevant.
- **Strengths.** Never loses a hurt opponent, brilliant on a stage with walls and ledges, punishes retreat.
- **Weaknesses.** Needs the first wound; open in a straight brawl; the tether needs a line.
- **AI playbook.** Poke with the thorn-spitter, mark, retreat to a wall, tether in when the target is stunned or turning;
  Bloodsense when the opponent leaves sight.
- **Fingerprint.** Top-2 time-with-opponent-marked, top-3 ledge/wall contact time, many small hits, high Bogline hit rate.

## 04 Mara Quell: the Bell Witch (floaty zoner)

- **Feel.** Drifts, rings a bell, and the stage fills with information and slowness.
- **Body.** The lightest-falling fighter: low gravity, slow fall, huge levitation, high air control; a slow runner on the
  ground; weak to being launched.
- **Movement technique (new).** *Glide:* hold jump at the top of an arc to hover a few seconds on a trickle of LEV; the bell
  chime ripples where she drifts.
- **Kit.** Keen Resonance (foes you cannot see leave ripples), Resonance Bell (two bells that reveal foes and ring), Dead Chime
  (a slowing, stunning, shot-wiping wave).
- **Weapon style (phase 6).** A bell-staff: slow, wide, ringing arcs, and a resonance bolt that rings a placed bell.
- **Strengths.** Zones with bells and slow, hard to pin down (floaty), the best at seeing what is behind a wall.
- **Weaknesses.** Light: one good hit sends her far; weak at close range; the bells do no damage on their own.
- **AI playbook.** Stay at long range, place a bell on the opponent's approach lane, glide away from contact, chime when
  three or more threats (or a shooter) are within range.
- **Fingerprint.** Top-1 airtime, top-1 average range, bottom-3 damage per second, bottom-2 health, most "foe revealed" events.

## 05 Kest Rel: the Chimney Jack (speedster / climber)

- **Feel.** The fastest thing in the yard, up every wall, hard to hold.
- **Body.** The fastest run, snappy jump, climbs one and a half times faster, a little slidey (a touch low traction); light.
- **Movement technique (new).** *Wall-run:* run along a wall for a short distance on the jump button held against it, then
  vault off with a speed boost.
- **Kit.** Rooftop Runner (faster climbing and mantling), Smoke Step (a 36-cell dash in a puff of soot, i-frames, hazy),
  Updraft (a furnace that blasts a column of hot air upward).
- **Weapon style (phase 6).** Soot-darts and a short hook-knife: hit-and-run, small damage, constantly repositioning.
- **Strengths.** Out-moves everyone; takes the high ground; Updraft is a launcher and a recovery tool.
- **Weaknesses.** Squishy; low damage per hit; the dash is on a cooldown; loses a straight fight.
- **AI playbook.** Circle, take the high ground, dart and dash away; Updraft to launch an opponent near a blast edge or
  to recover; avoid trading.
- **Fingerprint.** Top-1 distance travelled and top-1 speed, top-1 height gained, bottom-2 damage per hit, bottom-3 health.

## 06 Nox Calder: the Lampblack (stalker / denial)

- **Feel.** The one who turns the lights off. Information denial and ambush.
- **Body.** Average everything, slightly planted (good traction). The body is plain on purpose: his strength is vision, not stats.
- **Movement technique (new).** *Shadow-step:* while concealed (in smoke or in darkness) he moves faster and is silent to
  foes; the faster he moves the more the smoke trail clings.
- **Kit.** Soot Sight (see foes in dark or smoke), Blackglass (a smoke canister that conceals him), Long Night (darkens a
  large zone and dims lights).
- **Weapon style (phase 6).** A lampblack sling: shots that leave smoke, so his own offence feeds his concealment.
- **Strengths.** Denies an opponent's reads; best on a stage with lights to put out; sneaks in a decisive hit.
- **Weaknesses.** Fire eats his smoke; open under bright light; no mobility advantage.
- **AI playbook.** Throw Blackglass early; fight from inside the cloud; Long Night when the opponent is at mid range and
  has no area-denial of their own.
- **Fingerprint.** Top-1 concealed-time share, bottom-3 times-hit-while-concealed, highest stalemate risk (a flag to watch).

## 07 Edda Morrow: the Glass Saint (glass-cannon support)

- **Feel.** Fragile and radiant. Lives on shields and light.
- **Body.** Very light and floaty, a lot of levitation, the lowest health; an armor pool replaces it.
- **Movement technique (new).** *Hover:* sustained low-speed levitation at a small LEV cost, with a faint halo.
- **Kit.** Stored Light (a potion or flask use grants an overshield), Mercy Shard (a x0.6 incoming-damage shield on herself or an
  ally), Rose Window (a prism that heals her and turns shots aside).
- **Weapon style (phase 6).** A glass-lance and a light-beam: precise, medium range, with the shard as a defensive burst.
- **Strengths.** The best defensive tools in the roster for a short window; precise.
- **Weaknesses.** Dies to anything that lands twice; a stall risk (the prism heals); hurts herself on a bad trade.
- **AI playbook.** Keep a flask in reserve to restore the overshield, use Mercy Shard before a predicted trade, plant the
  Rose Window where she can fight from inside it.
- **Fingerprint.** Top-1 healing/overshield absorbed, bottom-1 health, top-3 shots deflected, the highest "fight lasted past
  the time cap" rate (to be tuned out by a heal cap).

## 08 Selene Wraith: the Mercury Twin (momentum trickster)

- **Feel.** Slippery. Everything is a slide, a blink, and a decoy.
- **Body.** The lowest traction in the roster: she starts and stops slowly, and keeps her speed. High air control, quick,
  light-ish. Momentum is the point.
- **Movement technique.** *Liquid Momentum* (the slide is exactly this); new: *Carry* (speed through a landing is preserved
  and adds to the next jump).
- **Kit.** Liquid Momentum (a slide that keeps her speed), Quicksilver Echo (a blink with a return), Mirror Hunt (two decoys that
  foes may hunt).
- **Weapon style (phase 6).** Mercury shuriken and a thrown phial that ricochet: bounce shots that rewards positioning.
- **Strengths.** Evasion, decoys, speed carried across the stage, great recovery with the blink.
- **Weaknesses.** Hard to stop, so hard to stop *in front of* a trap; low damage; weak against area control.
- **AI playbook.** Run and slide through the opponent's range, blink out, release decoys when two or more foes (or a
  hunter) are in range.
- **Fingerprint.** Top-2 speed, bottom-1 traction (longest stop distance), top-1 echo returns, bottom-2 damage per hit.

## 09 Rusk Emberjaw: the Furnace Hound (charging bruiser)

- **Feel.** A thrown boulder with an opinion. Heavy, but all momentum.
- **Body.** Second-heaviest, slow run but very planted, a low jump and a hard fall; an armor pool and plenty of health.
- **Movement technique.** *Shoulder Ram* is the movement (and the attack); new: *Skid* (a charge can be held to build
  distance and released into a ram that carries extra speed).
- **Kit.** Scrap Recovery (melee kills restore armor), Shoulder Ram (charge, shove, stun, breaks Wood), Kiln Heart (more
  armor, embers when hurt).
- **Weapon style (phase 6).** A furnace-gauntlet: close range, strong, burning; the wand is a coal-shot with a short fuse.
- **Strengths.** Wins the corner and the trade; breaks defences (walls, barricades, shields); the armor makes his health
  last long.
- **Weaknesses.** Linear (the charge is a straight line); loses to kiting and to the edge of the stage.
- **AI playbook.** Close the gap with a ram when the opponent is committed; hold armor for Kiln Heart; back away from
  ranged fighters towards cover; melee for armor.
- **Fingerprint.** Top-1 hit damage (the ram), top-1 armor restored, bottom-2 airtime, highest ring-out vulnerability.

## 10 Father Thorne: the Briar Heretic (anchored trapper)

- **Feel.** Rooted. The stage becomes his, one plant at a time.
- **Body.** Heavy and planted (very high traction), slow, a low jump; moderate health; resists being moved while standing
  in his own growth.
- **Movement technique (new).** *Root-walk:* inside his own vines and roots he moves at full speed and climbs them like
  walls; outside them he is slow.
- **Kit.** Rooted Camouflage (a still silhouette near cover fades), Ironvine (thorned vines that slow and scratch), Overgrowth
  (a zone of roots, moss and hanging vines).
- **Weapon style (phase 6).** A thorn-bow and a seed-sling: the seeds sprout where they land, so every shot is also a trap.
- **Strengths.** Controls the space around him; hard to approach; the best area denial.
- **Weaknesses.** Fire (the growth burns); a fast fighter that does not enter the growth; a slow turn rate.
- **AI playbook.** Establish a growth zone, hold inside it, shoot seeds at the lane; fight where the vines are; retreat
  from fire.
- **Fingerprint.** Top-1 time inside own growth, top-1 foe slow-time, bottom-3 distance travelled, highest "killed by fire".

---

## The distinctness checklist (run after every balance or body change)

- [ ] No two fighters share the same quartet (weight, run, traction, air) within 10%.
- [ ] Every fighter has a movement technique no other fighter has.
- [ ] Every fighter's *basic attack* is described in one sentence that no other fighter's could be.
- [ ] Every fingerprint metric above lands in its claimed rank in a 200-fight batch.
- [ ] A person watching two bots fight with the HUD off can tell which fighter is which from movement alone.
