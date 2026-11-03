import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-artifact', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Domain logic must stay independent of UI and non-deterministic globals.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'zustand', 'zustand/*'],
              message: 'src/domain must not depend on UI libraries.',
            },
            {
              group: ['**/app/**', '**/features/**', '**/shared/ui/**'],
              message: 'src/domain must not depend on presentation code.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG for deterministic simulation.' },
        { object: 'Date', property: 'now', message: 'Domain logic must not read the wall clock.' },
      ],
    },
  },
);
