// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/engine/__tests__/scratch*'],
  },
  {
    // El motor de Python usa `require()` perezosos a propósito (evitan ciclos de importación y retrasan la carga de módulos grandes).
    files: ['src/pyengine/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Reglas del React Compiler: el proyecto no usa el compilador y estos patrones
    // (refs de Reanimated, objetos mutables del motor de terminal) son intencionales.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/globals': 'off',
    },
  },
]);
