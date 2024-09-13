const soft = require('eslint-config-soft');
const globals = require('globals');

module.exports = [
  ...soft,
  {
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
