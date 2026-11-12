# Repo Time Machine Design

## Product

Repo Time Machine turns a public GitHub repository into an interactive map of
its architectural evolution. A user submits a repository and branch, then
scrubs a timeline to see source modules appear, disappear, split, merge, and
change dependencies. Every architectural event links to commits and file paths.

The first release supports public repositories, the default branch, Python, and
TypeScript. It analyzes the latest 2,000 first-parent, non-merge commits and
renders no more than 60 architecture keyframes.

Success means a new user can analyze a medium repository in under two minutes,
find a real structural change, and verify it from the evidence panel.

## Non-goals

- Code chat, vulnerability scanning, pull-request review, or code modification
- Private repositories, branches other than the selected branch, or monorepo
  package-manager resolution
- Function-level call graphs or runtime dependency tracing
- Mobile-first interaction or more than two source languages

## User Experience

The product is one desktop page:

1. The header contains the repository URL, branch, analyzed range, and share
   link.
2. The center contains a zoomable, pannable module graph.
3. The bottom contains a true-time timeline with markers for architecture
   events and a density strip for compressed ordinary commits.
4. The evidence panel shows the selected module's lifecycle, related commits,
   authors, dates, and file paths.

Selecting a node highlights its incoming and outgoing dependencies. Dragging
the timeline moves between immutable snapshots. Added, removed, growing, and
shrinking modules use one consistent color-semantic scheme. Split and merge
events are labeled as inferred because they come from deterministic heuristics.

The supported graph size is 500 modules. Larger repositories are aggregated by
directory until they fit, while retaining a drill-down path.

## Architecture

The repository is a pnpm TypeScript monorepo.

- `apps/web`: Next.js and React application for submission, analysis status,
  graph playback, and evidence.
- `apps/api`: Fastify API for repository validation, job creation, status, and
  immutable bundle retrieval.
- `apps/worker`: long-running process that claims and executes analysis jobs.
- `packages/analyzer`: Git traversal, source parsing, graph construction,
  keyframe selection, and bundle generation.
- `packages/contracts`: Zod schemas and shared TypeScript types for jobs and
  analysis bundles.
- `packages/ui`: shared React components for graph, timeline, and evidence.

Graphology stores graph state and Sigma.js renders it with WebGL. PostgreSQL
stores repository metadata and job state. `pg-boss` provides a durable queue in
the same database. S3-compatible object storage holds compressed, immutable
snapshot bundles; local development uses a filesystem adapter.

The API never exposes a Git working tree. The worker partially clones with
`--filter=blob:none --no-checkout`, analyzes only the target branch, and cleans
up its temporary directory. It never executes repository code.

## Data Flow

```text
GitHub URL
  -> API validates github.com/owner/repo
  -> job is persisted and queued in pg-boss
  -> worker partial-clones the branch
  -> analyzer reads the latest 2,000 first-parent non-merge commits
  -> analyzer updates file dependencies and discovers architecture keyframes
  -> analyzer publishes an immutable JSON bundle
  -> web client loads the bundle and renders snapshots
```

The cache key is `owner/repo + branch + head SHA + analyzer version`. A cached
bundle is reused only when all components match.

## Bundle Model

An analysis bundle has three layers:

- Manifest: schema version, analyzer version, repository identity, branch,
  head SHA, generated timestamp, limits, coverage, keyframe index, and snapshot
  object keys.
- Snapshot: commit SHA and timestamp, module nodes, dependency edges, module
  metrics, and change state relative to the previous keyframe.
- Event: module added, removed, split, merged, or moved; dependency added or
  removed; affected modules; confidence; evidence.

Evidence contains commit SHA, title, author, authored time, changed paths, and
the file blobs used for classification. Snapshot bundles contain file paths and
import relationships but not source code.

Module IDs are stable path-derived strings. File imports are aggregated into
directory edges. Self-directory imports are omitted. Node position seeds and
layout animation are client-side concerns; bundles remain deterministic.

## Analyzer

### Git traversal

- Normalize and validate the GitHub repository URL before invoking Git.
- Clone only the selected branch with partial blob filtering.
- Walk first-parent, non-merge commits in chronological order.
- Read trees and blobs in batch; cache parsed imports by blob SHA.
- Enforce limits of 20 minutes, 20,000 source files, and 1 MB per source file.

### Source extraction

- Python: parse imports, resolve relative imports and package paths, and ignore
  virtual environments, caches, build output, tests fixtures, and third-party
  modules.
- TypeScript: parse imports and re-exports, resolve relative paths and
  `tsconfig` path aliases, and ignore `node_modules` and generated output.
- Unsupported or unreadable files are counted as excluded coverage.

### Graph aggregation

- Every source file maps to its containing directory.
- File-level imports become weighted module edges.
- Nodes report file count, lines of code, incoming and outgoing edge counts,
  birth, last change, and current status.
- More than 500 modules are collapsed upward by directory until the graph fits.

### Keyframe selection

A structural score includes:

- directory addition or removal
- module dependency addition or removal
- file moves that change module ownership
- module split or merge candidates

Ordinary code edits and small edge-weight changes do not create keyframes.
At most 60 keyframes are retained, including the initial and head commits.
Timeline gaps preserve ordinary commit density and omitted-commit counts.

Split and merge detection uses blob continuity and directory ancestry. These
events are always labeled inferred and expose their supporting files.

## Failure Handling

Jobs use the states `queued`, `cloning`, `analyzing`, `publishing`, `ready`,
`failed`, and `cancelled`. Workers publish progress and heartbeats. A job that
loses its lease can be retried without publishing duplicate bundles.

Input errors, resource-limit errors, and partial-compatibility results are
distinct. Partial results expose coverage and skipped-file counts. The worker
removes temporary repositories on success, failure, and cancellation.

Only canonical GitHub URLs are accepted. Git arguments are passed without a
shell. Clone, file size, disk, time, and concurrency limits are enforced.

## Testing

- Unit tests cover Python and TypeScript import extraction, edge aggregation,
  directory collapse, and keyframe scoring.
- A generated local Git fixture covers additions, removals, moves, splits, and
  merges without network access.
- Golden bundle tests protect deterministic output.
- API and worker integration tests use the filesystem storage adapter and an
  in-memory or local PostgreSQL queue substitute.
- Playwright covers repository submission through timeline playback.

## Delivery

The project is MIT licensed and includes Docker Compose, a demo fixture,
self-hosting instructions, a published bundle schema, and CI.

Implementation proceeds in four milestones:

1. Local analyzer CLI produces deterministic bundles for a fixture repository.
2. API and worker analyze and cache public repositories with retries.
3. Web renders the timeline, graph, module drill-down, and commit evidence.
4. Deployment, performance budgets, docs, demo, and open-source release polish.

Performance targets are a medium repository in under two minutes and timeline
playback at 30 FPS after the initial bundle load.
