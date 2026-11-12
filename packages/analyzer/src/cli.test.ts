import { expect, it } from "vitest";
import { runCli } from "./cli";

it("prints a usage error without arguments", async () => {
  let stdout = "";
  let stderr = "";
  const result = await runCli([], {
    writeStdout: (value) => {
      stdout += value;
    },
    writeStderr: (value) => {
      stderr += value;
    },
  });

  expect(result.exitCode).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toContain("Usage: repo-time-machine");
});

it("rejects analyze without an output path", async () => {
  let stderr = "";
  const result = await runCli(["analyze", "."], {
    writeStdout: () => undefined,
    writeStderr: (value) => {
      stderr += value;
    },
  });

  expect(result.exitCode).toBe(2);
  expect(stderr).toContain("--output");
});
