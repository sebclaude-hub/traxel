// ESLint-Flat-Config (Pflicht seit ESLint v9) — entspricht dem Vite-React-TS-
// Template: JS/TS-Empfehlungen + React-Hooks-Regeln (Dependency-Arrays!) +
// react-refresh (HMR-Kompatibilitaet der Exporte).
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config([
  // Build-Artefakte + Fremdcode: dist/ (App), share-dist/ (Share-Viewer-Bundle),
  // src-tauri/ (Rust-Seite + generierte Dateien).
  globalIgnores(["dist", "share-dist", "src-tauri"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      // v7 des Plugins: Flat-Configs liegen unter configs.flat (die Top-Level-
      // Eintraege sind Legacy-Format und lassen ESLint v10 abbrechen).
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Neue React-Compiler-Regeln (react-hooks v7): melden etablierte
      // Pre-Compiler-Muster im Bestand (State-Reset in Effekten, "latest ref"
      // waehrend des Renders). Echte Befunde, aber Umbauten mit Regressions-
      // risiko — als Warnung sichtbar halten und gezielt abarbeiten, statt
      // jeden Lint-Lauf rot zu machen.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);
