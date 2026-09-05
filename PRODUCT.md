# Alchemist's Descent

<!-- impeccable:product-schema 1 -->

## Platform

web

This is the current platform. The September 2026 overhaul proposal assumes browser-first delivery; a future native target remains an open decision.

## Product Purpose

A falling-sand action game combining Noita's material-driven experimentation with the organic movement and creature behavior of Rain World. The requested overhaul must make playing more enjoyable, improve visual coherence and performance, and rebuild the enemy experience.

## Capabilities and Constraints

The existing TypeScript/Vite game includes expeditions, material simulation, wand crafting, flasks, procedural creatures, Sandbox, and a separate Builder. Three.js presents the world; Rapier handles rigid bodies.

Cell IDs and marker palettes are append-only save contracts. Sandbox saves, Builder documents, and expedition saves have separate ownership. Existing run lifecycle operations go through the Developer Console or the corresponding launcher API.

## Brand Commitments

The game is Alchemist's Descent. Noita and Rain World are explicit creative references, not assets to copy.

## Evidence on Hand

- Current implementation and contributor rules: `src/`, `AGENTS.md`, `ARCHITECTURE.md`.
- Existing design history: `docs/DESIGN.md` and the subsystem plans in `docs/`.
- September 2026 audit and proposed direction: `docs/2026-09-04-engine-and-game-overhaul.md`.

## Open Decisions

The user approved the Living Descent overhaul and its visual, creature, engine and progression direction on September 4, 2026, and authorized implementation in a new worktree. Browser-first delivery remains the implementation target. Final minimum hardware, a native release and touch controls remain open; unfamiliar-player acceptance must be measured with people rather than inferred from automated checks.
