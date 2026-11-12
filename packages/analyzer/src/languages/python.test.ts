import { expect, it } from "vitest";
import { extractPythonImports } from "./python";

it("extracts absolute and relative imports", async () => {
  const imports = await extractPythonImports(
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
    "src/shared.py",
  ]);
});

it("resolves package imports without inventing external files", async () => {
  const imports = await extractPythonImports(
    "pkg/jobs/run.py",
    "from ..queue import publish\nimport pkg.jobs.worker",
  );

  expect(imports.map((entry) => entry.targetFile)).toEqual([
    "pkg/queue.py",
    "pkg/jobs/worker.py",
  ]);
});

it("resolves modules imported from the current package", async () => {
  const imports = await extractPythonImports(
    "pkg/service.py",
    "from . import models\nfrom . import jobs as background_jobs",
  );

  expect(imports.map((entry) => entry.targetFile)).toEqual([
    "pkg/models.py",
    "pkg/jobs.py",
  ]);
});
