# Repo Time Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working open-source tool that analyzes a public GitHub
repository's history and presents an interactive architecture timeline.

**Architecture:** A pnpm TypeScript monorepo separates the deterministic Git
analyzer from API, worker, and web concerns. The analyzer emits validated
immutable JSON bundles; the web client renders those bundles without access to
Git. PostgreSQL-backed jobs are the production path, while an in-memory adapter
keeps tests and local demos independent of external services.

**Tech Stack:** Node.js 22, TypeScript, pnpm, Next.js, React, Graphology,
Sigma.js, Fastify, Zod, PostgreSQL, pg-boss, Tree-sitter WASM, Vitest, and
Playwright.

---

## Task 1: Bootstrap the workspace and bundle contract

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/bundle.ts`
- Test: `packages/contracts/src/bundle.test.ts`

**Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";
import { analysisBundleSchema } from "./bundle";

describe("analysisBundleSchema", () => {
  it("accepts a minimal deterministic bundle", () => {
    const result = analysisBundleSchema.parse({
      schemaVersion: "1.0",
      analyzerVersion: "0.1.0",
      repository: {
        owner: "acme",
        name: "widget",
        branch: "main",
        headSha: "a".repeat(40),
      },
      generatedAt: "2026-11-12T00:00:00.000Z",
      limits: {
        maxCommits: 2000,
        maxKeyframes: 60,
        maxModules: 500,
      },
      coverage: {
        sourceFiles: 2,
        parsedFiles: 2,
        excludedFiles: 0,
      },
      keyframes: [
        {
          id: "a".repeat(40),
          commitSha: "a".repeat(40),
          committedAt: "2026-11-12T00:00:00.000Z",
          omittedCommits: 0,
          nodes: [],
          edges: [],
          events: [],
        },
      ],
    });

    expect(result.keyframes[0]?.nodes).toEqual([]);
  });

  it("rejects a non-40-character commit SHA", () => {
    const result = analysisBundleSchema.safeParse({
      schemaVersion: "1.0",
      analyzerVersion: "0.1.0",
      repository: {
        owner: "acme",
        name: "widget",
        branch: "main",
        headSha: "abc",
      },
      generatedAt: "2026-11-12T00:00:00.000Z",
      limits: {
        maxCommits: 2000,
        maxKeyframes: 60,
        maxModules: 500,
      },
      coverage: {
        sourceFiles: 0,
        parsedFiles: 0,
        excludedFiles: 0,
      },
      keyframes: [],
    });

    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rtm/contracts test`

Expected: FAIL because the package and schema do not exist.

**Step 3: Create the workspace files**

Root `package.json`:

```json
{
  "name": "repo-time-machine",
  "private": true,
  "packageManager": "pnpm@11.25.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm --parallel --filter @rtm/api --filter @rtm/worker --filter @rtm/web dev"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:

```gitignore
node_modules/
.next/
dist/
coverage/
.env
.env.local
.data/
playwright-report/
test-results/
```

`packages/contracts/package.json`:

```json
{
  "name": "@rtm/contracts",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.0"
  }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

**Step 4: Implement the schemas**

Use Zod to define the SHA, module, edge, event, evidence, snapshot, and bundle
schemas represented in the design document. Export both values and inferred
types from `index.ts`. Event and edge discriminants must be unions rather than
free-form strings.

**Step 5: Run tests and typecheck**

Run: `pnpm install`

Run: `pnpm --filter @rtm/contracts test`

Run: `pnpm --filter @rtm/contracts typecheck`

Expected: all tests PASS and TypeScript exits with code 0.

**Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/contracts
git commit -m "chore: bootstrap workspace and bundle contract"
```

---

## Task 2: Extract Python imports and resolve module paths

**Files:**
- Create: `packages/analyzer/package.json`
- Create: `packages/analyzer/tsconfig.json`
- Create: `packages/analyzer/src/languages/python.ts`
- Test: `packages/analyzer/src/languages/python.test.ts`

**Step 1: Write the failing tests**

```ts
import { expect, it } from "vitest";
import { extractPythonImports } from "./python";

it("extracts absolute and relative imports", () => {
  const imports = extractPythonImports(
    "src/app/service.py",
    [
      "from app.models import User",
      "from .repo import load_user",
      "from ..shared import logging",
      "import os",
    ].join("\n"),
  );

  expect(imports.map((entry) => entry.targetFile)).toEqual([
    "src/app/models.py",
    "src/app/repo.py",
    "src/shared/__init__.py",
  ]);
});

it("resolves package imports without inventing external files", () => {
  const imports = extractPythonImports(
    "pkg/jobs/run.py",
    "from ..queue import publish\nimport pkg.jobs.worker",
  );

  expect(imports.map((entry) => entry.targetFile)).toEqual([
    "pkg/queue.py",
    "pkg/jobs/worker.py",
  ]);
});
```

**Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @rtm/analyzer test -- python.test.ts`

Expected: FAIL because `extractPythonImports` does not exist.

**Step 3: Implement with Tree-sitter**

Initialize `web-tree-sitter` once with `Parser.init()`. Load the Python grammar
from the `tree-sitter-wasms` package using `createRequire`. Traverse the AST,
collect `import_statement` and `import_from_statement` nodes, resolve relative
levels against the importing file's directory, and prefer `path.py` before
`path/__init__.py`. Ignore standard-library and third-party modules that cannot
be resolved under the repository root.

The public interface is:

```ts
export interface ExtractedImport {
  sourceFile: string;
  targetFile: string;
}

export async function extractPythonImports(
  sourceFile: string,
  source: string,
): Promise<ExtractedImport[]>;
```

Use an internal grammar promise so tests and production share one WASM parser.

**Step 4: Run tests**

Run: `pnpm --filter @rtm/analyzer test -- python.test.ts`

Expected: PASS for both cases.

**Step 5: Commit**

```bash
git add packages/analyzer
git commit -m "feat(analyzer): extract python imports"
```

---

## Task 3: Extract TypeScript imports and resolve aliases

**Files:**
- Create: `packages/analyzer/src/languages/typescript.ts`
- Create: `packages/analyzer/src/languages/typescript.test.ts`

**Step 1: Write the failing tests**

```ts
import { expect, it } from "vitest";
import { extractTypeScriptImports } from "./typescript";

it("extracts static, side-effect, and re-export imports", () => {
  const result = extractTypeScriptImports(
    "src/app/main.ts",
    [
      "import { x } from '../lib/x';",
      "import '../styles.css';",
      "export * from './feature';",
      "import react from 'react';",
    ].join("\n"),
    [{ pattern: "@/*", targets: ["src/*"] }],
  );

  expect(result.map((entry) => entry.targetFile)).toEqual([
    "src/lib/x.ts",
    "src/app/feature.ts",
    "src/app/styles.css",
  ]);
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rtm/analyzer test -- typescript.test.ts`

Expected: FAIL because the parser is missing.

**Step 3: Implement the parser**

Use the TypeScript compiler API to walk `ImportDeclaration`, `ExportDeclaration`,
and dynamic `import()` nodes. Resolve relative paths against the source file,
resolve alias patterns longest-first, and try `.ts`, `.tsx`, `.js`, `.jsx`,
`/index.ts`, and `/index.tsx`. Ignore bare package imports.

**Step 4: Run the test**

Run: `pnpm --filter @rtm/analyzer test -- typescript.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/analyzer/src/languages
git commit -m "feat(analyzer): extract typescript imports"
```

---

## Task 4: Aggregate file dependencies into modules

**Files:**
- Create: `packages/analyzer/src/graph.ts`
- Test: `packages/analyzer/src/graph.test.ts`

**Step 1: Write failing tests**

```ts
import { expect, it } from "vitest";
import { buildModuleGraph } from "./graph";

it("aggregates file imports without self-directory edges", () => {
  const graph = buildModuleGraph(
    [
      { path: "src/api/a.ts", language: "typescript", loc: 10 },
      { path: "src/api/b.ts", language: "typescript", loc: 20 },
      { path: "src/db/c.ts", language: "typescript", loc: 30 },
    ],
    [
      { sourceFile: "src/api/a.ts", targetFile: "src/api/b.ts" },
      { sourceFile: "src/api/a.ts", targetFile: "src/db/c.ts" },
      { sourceFile: "src/api/b.ts", targetFile: "src/db/c.ts" },
    ],
  );

  expect(graph.nodes.map((node) => node.id)).toEqual(["src/api", "src/db"]);
  expect(graph.edges).toEqual([
    {
      source: "src/api",
      target: "src/db",
      weight: 2,
      status: "unchanged",
    },
  ]);
});

it("collapses the graph above the module budget", () => {
  const graph = buildModuleGraph(
    [
      { path: "src/a/one.ts", language: "typescript", loc: 1 },
      { path: "src/a/two.ts", language: "typescript", loc: 1 },
      { path: "src/b/one.ts", language: "typescript", loc: 1 },
    ],
    [],
    { maxModules: 1 },
  );

  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0]?.id).toBe("src");
});
```

**Step 2: Run tests to see them fail**

Run: `pnpm --filter @rtm/analyzer test -- graph.test.ts`

Expected: FAIL.

**Step 3: Implement graph aggregation**

Map each source file to `dirname(path)`, group imports by source and target
directory, and omit self-edges. Compute file count and total LOC per node.
When the node count exceeds `maxModules`, repeatedly collapse the deepest
modules into their parents until the budget is met.

**Step 4: Run tests**

Run: `pnpm --filter @rtm/analyzer test -- graph.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/analyzer/src/graph.ts packages/analyzer/src/graph.test.ts
git commit -m "feat(analyzer): aggregate modules and dependencies"
```

---

## Task 5: Traverse Git history and produce architecture snapshots

**Files:**
- Create: `packages/analyzer/src/git.ts`
- Create: `packages/analyzer/src/keyframes.ts`
- Create: `packages/analyzer/src/analyze.ts`
- Create: `packages/analyzer/src/index.ts`
- Test: `packages/analyzer/src/analyze.test.ts`

**Step 1: Write the failing integration test**

Create a temporary repository in the test. Commit an initial `src/app/a.py`,
then add `src/db/b.py` and an import, then move the database directory into
`src/storage`. Run the analyzer and assert:

```ts
expect(bundle.keyframes).toHaveLength(2);
expect(bundle.keyframes[1]?.nodes.map((node) => node.id)).toContain(
  "src/storage",
);
expect(bundle.keyframes[1]?.events[0]?.type).toBe("module-added");
```

Use explicit test Git identity arguments on every commit. Do not depend on the
developer's global Git configuration.

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rtm/analyzer test -- analyze.test.ts`

Expected: FAIL.

**Step 3: Implement Git traversal**

Use `execFile`, never a shell. Parse:

```text
git log --first-parent --no-merges --reverse -n <limit> --format=<fields>
git diff-tree --root --no-commit-id --name-status -r -M <sha>
git show <sha>:<path>
```

Maintain a `Map<path, SourceFile>` and import list as commits are applied.
Cache parsed imports by source content hash. Process at most 2,000 commits.
Apply safety limits for source file size and file count.

**Step 4: Implement keyframe scoring**

Score a commit when source directories are added or removed, a source file
moves to another directory, or an import changes the module edge set. Always
emit the first and latest commit. Keep the top 60 events by score while
retaining chronological order. Mark deleted nodes with `status: "removed"` and
collection differences with `status: "added"` only in the emitted comparison
snapshot.

**Step 5: Implement split and merge inference**

If one module disappears and two or more new modules share its path ancestry in
one keyframe, emit an inferred `module-split`. If multiple modules disappear
and one new module appears, emit an inferred `module-merged`. Attach changed
paths as evidence and confidence `medium`.

**Step 6: Run tests**

Run: `pnpm --filter @rtm/analyzer test -- analyze.test.ts`

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/analyzer/src
git commit -m "feat(analyzer): build architecture history snapshots"
```

---

## Task 6: Add a CLI that writes and validates bundles

**Files:**
- Create: `packages/analyzer/src/cli.ts`
- Create: `packages/analyzer/bin/repo-time-machine.js`
- Create: `packages/analyzer/src/cli.test.ts`
- Modify: `packages/analyzer/package.json`

**Step 1: Write a failing CLI test**

```ts
it("prints a usage error without arguments", async () => {
  const result = await runCli([]);
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Usage: repo-time-machine");
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rtm/analyzer test -- cli.test.ts`

Expected: FAIL.

**Step 3: Implement the CLI**

Accept `repo-time-machine analyze <path> --output <file>`, default the branch
to the current `HEAD`, validate the produced object with
`analysisBundleSchema`, and write pretty JSON. Add `bin` and `analyze` scripts
to `package.json`.

**Step 4: Run unit and manual tests**

Run: `pnpm --filter @rtm/analyzer test`

Run: `pnpm --filter @rtm/analyzer exec tsx src/cli.ts analyze . --output /tmp/rtm.json`

Expected: tests pass and `/tmp/rtm.json` contains a manifest.

**Step 5: Commit**

```bash
git add packages/analyzer
git commit -m "feat(analyzer): add bundle generator cli"
```

---

## Task 7: Add repository validation, storage, and the job API

**Files:**
- Create: `packages/contracts/src/jobs.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/github.ts`
- Create: `apps/api/src/storage.ts`
- Create: `apps/api/src/jobs.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Test: `apps/api/src/server.test.ts`

**Step 1: Write failing API tests**

Cover:

```ts
expect(validateGithubRepository("https://github.com/acme/widget").ok).toBe(true);
expect(validateGithubRepository("https://example.com/acme/widget").ok).toBe(false);

const create = await app.inject({
  method: "POST",
  url: "/api/analyses",
  payload: { repositoryUrl: "https://github.com/acme/widget", branch: "main" },
});
expect(create.statusCode).toBe(202);
expect(create.json().status).toBe("queued");

const status = await app.inject({
  method: "GET",
  url: `/api/analyses/${create.json().id}`,
});
expect(status.statusCode).toBe(200);
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rtm/api test`

Expected: FAIL.

**Step 3: Implement canonical URL validation**

Accept only HTTP(S) GitHub repository URLs with exactly `owner/repo`, strip a
trailing `.git`, reject query strings and fragments, and return normalized
identity. Pass Git arguments as arrays.

**Step 4: Implement adapters and routes**

Define `JobStore` and `BundleStore` interfaces. Provide in-memory
implementations for tests and a filesystem bundle store for local development.
Implement:

- `POST /api/analyses`
- `GET /api/analyses/:id`
- `POST /api/analyses/:id/cancel`
- `GET /api/bundles/:id`
- `GET /healthz`

Use Zod for request and response schemas. Return 400 for invalid input, 404 for
unknown jobs or bundles, and 409 for jobs that cannot be cancelled.

**Step 5: Run tests and typecheck**

Run: `pnpm --filter @rtm/api test`

Run: `pnpm --filter @rtm/api typecheck`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/contracts/src/jobs.ts apps/api
git commit -m "feat(api): add analysis jobs and bundle endpoints"
```

---

## Task 8: Implement the worker and production queue boundary

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/run-job.ts`
- Create: `apps/worker/src/memory-runner.ts`
- Create: `apps/worker/src/postgres-queue.ts`
- Create: `apps/worker/src/index.ts`
- Test: `apps/worker/src/run-job.test.ts`
- Create: `docker-compose.yml`
- Create: `.env.example`

**Step 1: Write failing worker tests**

Assert that a job transitions through `cloning`, `analyzing`, `publishing`, and
`ready`; that the temporary directory is cleaned after success and failure; and
that injected runner failures are stored as `failed` without exposing a stack
trace through the API.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rtm/worker test`

Expected: FAIL.

**Step 3: Implement the job runner**

Accept injected `cloneRepository`, `analyzeRepository`, and `publishBundle`
functions. Normalize errors into public error codes. Ensure `finally` removes
the temporary repository. Use an analysis lock directory to prevent duplicate
publication of the same cache key.

**Step 4: Implement queue adapters**

The memory runner executes jobs in-process for local development. The
PostgreSQL adapter uses pg-boss with retry count and heartbeat support. Keep
the job payload small: repository identity, branch, job ID, and result key.

**Step 5: Add Docker Compose and environment validation**

Compose starts PostgreSQL and a local S3-compatible service. Parse environment
variables with Zod at process startup. Include a `DEMO_MODE=1` path that does
not require PostgreSQL.

**Step 6: Run tests and typecheck**

Run: `pnpm --filter @rtm/worker test`

Run: `pnpm --filter @rtm/worker typecheck`

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/worker docker-compose.yml .env.example
git commit -m "feat(worker): process analysis jobs with retries"
```

---

## Task 9: Build the graph and timeline workspace

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/graph-workspace.tsx`
- Create: `packages/ui/src/timeline.tsx`
- Create: `packages/ui/src/evidence-panel.tsx`
- Test: `packages/ui/src/graph-workspace.test.tsx`

**Step 1: Install testing dependencies**

Run:

```bash
pnpm add -D --filter @rtm/ui @testing-library/react @testing-library/jest-dom jsdom
```

Expected: dependencies install successfully.

**Step 2: Write a failing component test**

```tsx
it("changes the evidence when a timeline keyframe is selected", async () => {
  render(<GraphWorkspace bundle={fixtureBundle} />);
  await userEvent.click(screen.getByRole("button", { name: /add database/i }));
  expect(screen.getByText("src/storage")).toBeVisible();
  expect(screen.getByText("Commit evidence")).toBeVisible();
});
```

**Step 3: Run the test to verify it fails**

Run: `pnpm --filter @rtm/ui test`

Expected: FAIL.

**Step 4: Implement the workspace**

The initial page has a repository form, examples, and progress states. Once a
bundle loads, render:

- Graph canvas with selection and neighbor emphasis
- Timeline scrubber and play control
- Legend for added, removed, growing, and shrinking modules
- Evidence panel with inferred badges and commit links
- Responsive empty, loading, partial, and failed states

Use Graphology for graph state. Load Sigma in a client-only component. If
WebGL is unavailable, render an accessible SVG fallback and a clear notice.
Use a deterministic circular layout for test fixtures and ForceAtlas2 for real
bundles. Respect `prefers-reduced-motion`.

**Step 5: Run component tests and build**

Run: `pnpm --filter @rtm/ui test`

Run: `pnpm --filter @rtm/web build`

Expected: tests pass and Next.js production build succeeds.

**Step 6: Commit**

```bash
git add apps/web packages/ui
git commit -m "feat(web): render interactive architecture timeline"
```

---

## Task 10: Add end-to-end coverage and release documentation

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/analyze.spec.ts`
- Create: `fixtures/demo-repo/README.md`
- Create: `scripts/create-demo-fixture.sh`
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/self-hosting.md`
- Create: `.github/workflows/ci.yml`

**Step 1: Create a deterministic fixture repository**

The fixture has at least ten commits covering:

- initial Python and TypeScript sources
- a new database directory
- an import edge
- a file move
- a split and a merge
- a growth-only commit that must not become a keyframe

Use fixed author identities and timestamps.

**Step 2: Write the failing E2E test**

Start the API and web app in demo mode, submit the fixture URL, wait for
analysis, open the timeline, select the database module, and assert that commit
evidence is visible. Also assert the page remains usable at a 1280x800 viewport
and via keyboard navigation.

**Step 3: Run the E2E test to verify it fails**

Run: `pnpm exec playwright test tests/e2e/analyze.spec.ts`

Expected: FAIL before wiring demo mode.

**Step 4: Complete demo mode and documentation**

Document the product promise, screenshots or animated demo, supported limits,
local CLI, Docker self-hosting, demo mode, data handling, API endpoints, how
inferred events work, and known limitations. Include the MIT license and CI for
lint, tests, typecheck, build, and Playwright.

**Step 5: Run the full verification suite**

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
```

Expected: every command exits with code 0.

**Step 6: Commit**

```bash
git add README.md LICENSE docs fixtures scripts tests playwright.config.ts .github
git commit -m "docs: ship demo and self-hosting guide"
```

---

## Final Verification

Run:

```bash
git status --short
git log --oneline --decorate -10
pnpm typecheck
pnpm test
pnpm build
```

Expected:

- working tree is clean
- commits correspond to completed tasks
- tests pass without network access
- production build succeeds
- the README explains both the demo and production paths
