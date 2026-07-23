import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
// NOTE: eslint-config-next 16 enables the new React-Compiler-oriented react-hooks
// rules (eslint-plugin-react-hooks v6): set-state-in-effect, refs, purity. A
// handful of our components use runtime-correct patterns those rules flag
// (reacting to a completed useActionState result, "latest value" refs for stable
// callbacks, reading the clock during a server render). Rather than silence the
// whole category globally, each such site carries a scoped
// `// eslint-disable-next-line react-hooks/<rule>` with a justification, so the
// rules stay ENFORCED everywhere else and any new violation is still caught.

export default eslintConfig;
