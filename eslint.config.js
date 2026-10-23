const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/', 'coverage/', 'build/'],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
        WebAssembly: true,
      },
    },
    rules: {
      'no-console': ['off'],
      'no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
];
