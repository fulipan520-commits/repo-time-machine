import { expect, it } from "vitest";
import { extractTypeScriptImports } from "./typescript";

it("extracts static, side-effect, alias, and re-export imports", () => {
  const result = extractTypeScriptImports(
    "src/app/main.ts",
    [
      "import { x } from '../lib/x';",
      "import './styles.css';",
      "export * from './feature';",
      "import { user } from '@/store/user';",
      "import react from 'react';",
      "const lazy = () => import('./lazy');",
    ].join("\n"),
    [
      { pattern: "@/*", targets: ["src/*"] },
      { pattern: "@/store/*", targets: ["src/domain/*"] },
    ],
  );

  expect(result.map((entry) => entry.targetFile)).toEqual([
    "src/lib/x.ts",
    "src/app/styles.css",
    "src/app/feature.ts",
    "src/domain/user.ts",
    "src/app/lazy.ts",
  ]);
});

it("ignores bare package imports and files outside the repository", () => {
  const result = extractTypeScriptImports(
    "main.ts",
    "import fs from 'node:fs';\nimport x from '../outside';",
  );

  expect(result).toEqual([]);
});

it("does not treat an exact alias as a wildcard", () => {
  const result = extractTypeScriptImports(
    "src/main.ts",
    "import config from '@app/config';",
    [{ pattern: "@app", targets: ["src/app"] }],
  );

  expect(result).toEqual([]);
});
