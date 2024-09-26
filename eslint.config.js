const soft = require('eslint-config-soft');
const globals = require('globals');

module.exports = [
  ...soft,
  {
    settings: {
      react: {
        "version": "100.0.0",
      },
    },
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
