# Self-hosting

## Local demo

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`. The API listens on port 3001. For this version, the
API process also runs the analysis worker in memory and stores compressed
bundles under `.data/bundles`.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port |
| `HOST` | `127.0.0.1` | API bind address |
| `BUNDLE_DIRECTORY` | `.data/bundles` | Local snapshot storage |
| `API_ORIGIN` | `http://127.0.0.1:3001` | Web server proxy origin |

## Docker

```bash
docker compose up --build
```

This is a single-node deployment. Web and API run in separate containers, while
the API container performs analysis and writes snapshots to a named volume.

## Render Blueprint

The repository includes `render.yaml` with two free-plan Docker services:

- `repo-time-machine-api-520`: API and embedded worker
- `repo-time-machine-web-520`: Next.js web app and same-origin proxy

The API stores snapshots under `/tmp/bundles`, so results survive normal
requests but not service restarts. This is suitable for a public demo. Attach a
Render disk or move snapshots to object storage before relying on long-lived
results.

## Production boundary

Version 0.1 intentionally ships the single-process queue behind small store and
runner interfaces. Jobs are lost if the API process restarts, and snapshots are
local to one host. A multi-instance deployment should add the planned PostgreSQL
job store and pg-boss adapter, plus S3-compatible snapshot storage. Do not run
multiple API replicas against separate local volumes and expect shared results.

## Security

- Only canonical `github.com/owner/repository` URLs are accepted.
- Git arguments are passed as arrays, never through a shell.
- Clones use `--filter=blob:none --no-checkout`.
- Repository code, package scripts, and tests are never executed.
- Temporary checkouts are removed after success, failure, or cancellation.
- Analysis is limited to recognized Python and TypeScript-family source files.
