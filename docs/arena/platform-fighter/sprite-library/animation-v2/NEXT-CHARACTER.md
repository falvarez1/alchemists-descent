# Next character: Sable Fen

Selected after completing Ilyra Voss and Brann Rook. This records the next implementation target; Sable's expanded moves and replacement animation set are not implemented by this selection.

Sable is the next fighter in roster order. Her Hunter kit adds a distinct grapple and tracking play style, and the existing Bogline, Wounded Spoor and Bloodsense implementations provide concrete behaviors to integrate and test.

## Current gaps

- All 126 replacement body clips are missing: 63 actions in armed and unarmed variants. The playable character currently uses the older static pose atlas.
- Eight character effect targets are missing from the replacement library.
- Stock melee currently falls back to the shared four-attack prototype. The six expanded aerial/heavy attacks and extra airborne jump are not enabled for Sable.
- Stock integration needs an explicit audit. Bloodsense currently identifies wounded enemies through health loss, while Stock combat uses volatility. Bogline's pull, stun and ownership must be checked against real fighter bodies, shields, ledges and LAN authority.

## Completion scope

1. Author and tune Sable's ten melee attacks, controls and CPU selection, including directional air attacks and ground heavies.
2. Complete both equipment-state artwork sets, all eight effect targets, anchors and cosmetic attachment points. Import the armed set into playable Duel states.
3. Integrate Wounded Spoor, Bogline and Bloodsense with accepted Stock damage, movement, interruption, reset and respawn behavior.
4. Verify actual keyboard/controller combat, passive and ability behavior, both facings, ledge contact, effect lifetime and independent LAN clients. Update the coverage matrix from those results.

References: [kit behavior](../../../../fighters/sable-fen.md), [roster coverage](completion.csv), [completed Ilyra/Brann integration](DUO-COMPLETION.md).
