// Flat config for ESLint 9 (the `npm run lint` entry point).
// TS strict already carries the heavy checking; lint adds the recommended
// typescript-eslint layer without type-aware rules so it stays fast.
import tseslint from 'typescript-eslint';

export default tseslint.config(...tseslint.configs.recommended, {
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
});
