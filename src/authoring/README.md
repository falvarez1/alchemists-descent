# Authoring Contracts

This folder owns neutral authored-content contracts shared by the runtime,
worldgen, and Builder.

Rules:

- Keep this layer pure: no DOM, localStorage, or Builder UI.
- Do not import from `@/builder`, `@/game`, `@/entities`, `@/combat`, or `@/ui`.
- Prefer data shapes, codecs, geometry helpers, and structural cell stamps.
- Runtime semantics stay in `src/game`; Builder storage, import reports, undo
  commands, and panels stay in `src/builder`.

