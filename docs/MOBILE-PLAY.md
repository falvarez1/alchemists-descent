# Mobile play

The player route enables touch controls when the browser reports a coarse primary pointer. This covers phones and tablets, including browsers with desktop user-agent strings. Players can choose Auto, Always, or Never in **Controls & comfort > Touch controls**. Mouse, keyboard, and standard gamepads remain available.

| Control | Action |
| --- | --- |
| Left pad | Move; up jumps/climbs, down crouches/descends |
| Right pad | Aim and cast; release stops casting and preserves the aim direction |
| Jump | Jump, wall jump, and held levitation |
| Grip | Hold a wall |
| Use | Talk, operate a mechanism, lift/set down; hold to fill a flask |
| Kick | Kick or hurl a held object |
| Wand | Switch between the two wands; button shows the active slot |
| Tools | Select/throw/pour/drink flasks, carry/swing, glowseeds, lantern |
| Tools > Aim only | Position the target without casting, for interactions and flask work |
| Pause | Resume, map, wand bench, handbook, grimoire, settings, quit |

Portrait and landscape both work. Landscape gives the world more space. The game preserves its existing 16:9 presentation and fixed render resolution, so high device pixel ratios do not multiply its rendering workload. Phone safe areas, dynamic viewport height, scrollable menus, and controls at least 44 CSS pixels wide/high are supported. Gameplay controls use Pointer Events and independent pointer capture; native scrolling and zoom remain available in menus.

Switching tabs/apps or losing focus releases held touch input and pauses active mobile play (the **Pause when the window loses focus** option, Controls & comfort > Gameplay, governs this; it is on by default). Returning requires Resume. Rotation/resize releases contacts. Menus, death, level transitions, and disposal also release held actions. Touch gameplay calls the same actions as keyboard input, without dispatching synthetic keyboard events.

Screen wake lock is optional and only held during visible active play. Pause, backgrounding, and disposal release it. A rejection is handled without a retry loop. Full screen is requested only by tapping its button; unsupported or denied requests leave browser play available. These features require browser support; wake lock normally requires HTTPS.

## Verification

Run a dev server, then:

```powershell
npm run typecheck
npm test
npm run build
npm run verify:mobile -- http://localhost:5173/
```

The optional second URL tests the fresh-player flow against a production preview. The probe uses headless Edge and real Chromium multitouch injection. It checks movement in the running simulation, independent contacts, cancellation, jump, flask selection/pouring, aim-only mode, app interruption, menu suppression, wake-lock acquisition/release, fullscreen denial, touch preference changes, phone/tablet geometry, map/bench access, desktop keyboard input, and a fresh descent started entirely by touch. Screenshots and results are written to ignored `verify-out/mobile/`.

Emulation verifies layout and browser behavior, not physical-device performance, thermal behavior, or Safari-specific rendering. Release testing should include physical iOS Safari and Android Chrome, rotation, browser toolbar resizing, audio interruption, and an extended combat session. The level Builder remains a desktop authoring tool.

## Browser references

- [Pointer Events and pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [Pointer capabilities](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/pointer)
- [touch-action and native gestures](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)
- [Safe area environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)
- [Screen Wake Lock lifecycle and support](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
