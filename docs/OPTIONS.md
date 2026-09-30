# Player options (Controls & comfort)

One dialog (`src/ui/PlayerSettings.ts`, a native `<dialog>`), five tabs, every choice persisted under
`localStorage['ad-player-preferences-v1']`, applied live (no reload), and read defensively: the pure half
of every option lives in `src/config/playerPrefs.ts` (allowed choices, narrow slider bands, sanitizers that
never throw) and is unit-tested (`tests/player-prefs.test.ts`).

**The rule for every option: untouched, the game is exactly what shipped.** The one deliberate exception is
*Pause when the window loses focus*, which is on by default. A slider nobody moved is `null` (leave the game's
own value alone); a class or element is only added while the option is on. `scripts/verify-options.mjs`
checks the default of each one (computed styles, post-processing values, DOM) before it touches the option.

## The dialog

Tabs are a real ARIA tablist (roving tabindex; arrows / Home / End; focus follows; LB / RB on a controller via
the `settings-tab-step` event). The dialog keeps one size across tabs and scrolls inside the panel.
`scripts/verify-settings.mjs`: structure, keyboard, every control reachable by a real click at 1440x900,
960x600 and 390x844 (touch), one size across tabs, and that old / corrupt / hostile saves still load.

## The options

| Tab | Option | Default | What it does | Where |
| --- | --- | --- | --- | --- |
| Sound | Mute, five volumes, Narration | as before | (unchanged) | `audio/mix`, `SoundQuickControl` |
| Display & comfort | Text size | Standard | scales words (`--text-scale`) | `PlayerSettings` |
| | Caption backing | off | dark plate behind narrator / creature captions / callouts; callouts now follow Text size | `options.css` (`body.caps-backed`) |
| | Numbers on the bars | off | `110/110` beside HP / MANA / LEV | `ui/VitalNumbers` |
| | HUD size 80-130%, opacity 50-100% | 100% | scales / fades the three corner HUD blocks from their own corners; Pause is left alone | `options.css` (`body.hud-custom`) |
| | Reduce flashes, High-readability lighting, Creature sound captions | as before | (unchanged) | |
| | Camera shake Full / Half / Off | Full | `state.cameraShakeScale` multiplies the screen jitter (WebGL **and** WebGPU; WebGPU used to ignore the setting); old boolean migrates | `render/Renderer`, `WebGpuRenderBackend` |
| | Colour assist Off / Red-green / Blue-yellow | Off | swaps the HP / MANA / LEV accents for palettes chosen by simulated colour-vision deficiency (`config/colorAssist`), gives each bar a pattern, crosses out spent phials; the world's hues are untouched | `options.css` (`body.assist-on`) |
| Presentation | Brightness, Edge shading, Glow, Film grain | Default | narrow bands (brightness 0.85-1.25 of the picture, vignette 0.08-0.44, bloom 0.06-0.36, grain 0-0.018); *Reset picture* | `postFx.gain` (new, post pass) / `vignette` / `bloomStrength` / `grain` |
| | Quality Standard / Low | Standard | Low: sub-cell look off, half of the *cosmetic* particle bursts, Sandbox worker pool off (next load) | `Particles.cosmeticBurstCount`, `Game.sandboxSimThreads` |
| Gameplay | Pause when the window loses focus | **on** | asks the Esc pause menu on blur / hidden tab; never in the Sandbox, on the title / a menu / cinematic, mid-conversation, dead, in the Builder, or with a linked editor window | `input/focusPause` |
| | Teaching cards First time only / Every floor / Off, *Reset tutorials* | First time only | Off also silences the waystone card (guard in `HintTeachOverlay.offer`) | `game/Hints`, `seenHints` |
| | Enemy health and damage | off | a thin bar for 2 s after a hit, and the damage number; a readout only (reads `hp`, writes DOM) | `ui/EnemyReadouts` |
| | Aim assist Off / Light / Strong | Off | bends a shot the last few degrees (4 / 8) onto an enemy the aim *direction* already points at, for stick / keyboard / touch aim with no cursor; Trickshot's own lock is untouched | `combat/aimAssist`, `combat/AimGuide` |
| | Weaver-leg finisher, Trickshot, Clips | as before | (moved here from the old single list) | |
| Controls | Keyboard rebinding | as before | (unchanged) | `input/bindings` |
| | Hold or toggle: Crouch, Levitate, Pour, Siphon | Hold | a press latches, the next releases; dropped on blur, hidden tab, pause / any menu, death, respawn, floor or mode change; chip shows what is latched | `input/toggleLatches`, `InputManager`, `ui/LatchIndicator` |
| | Stick dead zone 5-45% | 20% | `padThresholds`: one value moves the move / up / down / aim thresholds; 20% is the old 0.2 / 0.35 / 0.4 / 0.25 | `InputManager.pollGamepad` |
| | Vibration | off | dual-rumble on hurt / a nearby blast / death, feature-detected | `input/padRumble` |
| | Touch controls | Auto | (unchanged) | |

The title also gains a **Choose a seed** fold under Today's descent (`ui/SeedDisclosure`): a number or any words,
the same seed and case make the same descent, the ledger header and the share line print it, and
*Copy this descent's seed* appears while a descent is in hand. The daily is untouched, and an ordinary Begin's
ledger and share line are byte-identical to before (`seedChosen` is only set by a chosen seed).

## Things worth knowing

- `postFx.exposure` does nothing on the WebGL renderer (measured: mean luminance unchanged across 0.9 - 2.5), so
  Brightness is a new `postFx.gain` (default 1) applied in `render/PostFx`.
- Floor 1 is hand-built: a chosen seed does not move its placements. It moves the generated floors 2-4 and the
  run's secret reaction.
- The game has no "hurt", "explosion" or "enemy hit" events, so rumble and the enemy readouts read what the HUD
  and the camera already read (health, screen shake, enemy `hp`). They never write any of it.
- Automation cannot produce a genuine OS focus loss (Playwright keeps every page "focused", even headful, when
  another tab is brought to front), so the pause probe dispatches the same `blur` / `visibilitychange` events.

## Not built, pending a design decision

Per-run assists (an extra return phial, reduced damage, faster mana) and mutators change what a win means
(`docs/DIFFICULTY.md`: does an assisted win open the next tier?). They are the owner's call.

## Probes

`node scripts/verify-settings.mjs <url>` (dialog) and `node scripts/verify-options.mjs <url> [--only pause,shake,
captions,vitals,hints,picture,hud,seed,pad,enemyhp,aim,toggle,assist,quality]` (what each option DOES, with real
clicks and keys; a synthetic standard gamepad for the controller options). Run against a frozen server, one browser at a time.
