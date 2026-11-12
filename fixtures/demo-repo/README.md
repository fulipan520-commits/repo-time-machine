# Demo Repository

The demo is generated rather than committed as a nested Git repository.

Run:

```bash
./scripts/create-demo-fixture.sh
```

The script creates a repository with five commits covering an initial
architecture, module addition, implementation growth, worker extraction, and a
directory move. It prints the generated path.

Analyze it with:

```bash
pnpm --filter @rtm/analyzer build
node packages/analyzer/bin/repo-time-machine.js analyze /path/from/script \
  --output demo-analysis.json
```
