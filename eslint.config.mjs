// Flat config for ESLint 9 (the `npm run lint` entry point).
// TS strict already carries the heavy checking; lint adds the recommended
// typescript-eslint layer without type-aware rules so it stays fast.
import tseslint from 'typescript-eslint';

/**
 * The determinism boundary (docs/MULTIPLAYER-ARCHITECTURE.md stage 4).
 *
 * Every directory whose output is part of game state draws from a seeded stream
 * in `core/simRandom.ts` instead of `Math.random()`. This is enforced rather
 * than documented because PARTIAL determinism is worse than none: one stray
 * `Math.random()` in a hot path makes replays and golden frames silently wrong
 * while still looking green, which invites exactly the trust that then breaks.
 *
 * Each entry names the stream that directory belongs to, so the message tells
 * you what to write instead of just what not to.
 */
const DETERMINISTIC = [
  ['src/sim/**/*.ts', 'simRandom()'],
  ['src/entities/**/*.ts', 'entityRandom()'],
  ['src/combat/**/*.ts', 'entityRandom()'],
  ['src/game/**/*.ts', 'entityRandom()'],
  ['src/particles/**/*.ts', 'particleRandom()'],
];

const banMathRandom = (stream) => ({
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: `Gameplay randomness must be seeded — use ${stream} from '@/core/simRandom'. Math.random() here breaks replay and the sim golden frames (docs/MULTIPLAYER-ARCHITECTURE.md stage 4).`,
    },
  ],
});

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  ...DETERMINISTIC.map(([files, stream]) => ({ files: [files], rules: banMathRandom(stream) })),
  {
    // The mirror of the rule above, and just as load-bearing. Presentation runs
    // at render rate, not tick rate, and is skipped entirely when a frame is
    // dropped — so a draw from a seeded stream here would consume a different
    // number of values on a slow machine than on a fast one and desync two
    // clients that agreed on every input. Visual jitter belongs on Math.random.
    files: ['src/render/**/*.ts', 'src/ui/**/*.ts', 'src/builder/**/*.ts', 'src/audio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/core/simRandom',
              importNames: ['simRandom', 'entityRandom', 'particleRandom', 'fxRandom'],
              message:
                'Presentation runs at render rate — drawing from a seeded stream here would make the stream depend on frame rate. Use Math.random() for visual jitter.',
            },
          ],
        },
      ],
    },
  },
);
