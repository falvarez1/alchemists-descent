# Animation review

The current Ilyra/Brann integration is recorded in [DUO-COMPLETION.md](DUO-COMPLETION.md). The library contains 252 fighter clips, 30 effects and seven props: 289 exports and 3,459 frames. Format/browser verification reports no source-boundary or joined-figure extraction failures.

This pass selected 17 new or replacement sources: Ilyra armed/unarmed run, walk and tumble; Brann armed/unarmed tumble; Ilyra armed up-smash, ultimate, forward throw and tactical; crucible spin; and four Ilyra effects. These replace the old locomotion, rotation, joined-silhouette and equipment-continuity issues. Forward throw now retains the pistol, and tactical retains the pistol through the vial release. The projectile is rendered separately by the kit.

Brann's detached-component warnings on taunt and shield break were inspected: they are gesture marks and impact fragments, rather than joined figures or missing limbs. Raw warnings remain in the evidence. Rejected sources remain for provenance; `review-overrides.json` identifies the selected replacements.

Both fighters use 63 armed body animations in Duel, with state transitions, attack phase timing, both ledge grips and cosmetic sockets. Runtime contact sheets, mirror screenshots and gameplay probes are under `evidence/`. Art acceptance records distinguish repaired sources, runtime sampling and unarmed export verification; a format pass is not blanket visual approval.

The full roster is still incomplete: eight fighters and shared support targets remain in [completion.csv](completion.csv). This is why the library's overall `productionReady` flag remains false.
