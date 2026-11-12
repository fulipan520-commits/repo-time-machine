import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "./analyze";
import { getCurrentBranch } from "./git";

export interface CliWriters {
  writeStdout: (value: string) => void;
  writeStderr: (value: string) => void;
}

export interface CliResult {
  exitCode: number;
}

const usage = [
  "Usage: repo-time-machine analyze <path> --output <file> [options]",
  "",
  "Options:",
  "  --branch <name>  Branch to analyze (default: current branch)",
  "  --owner <name>   Repository owner label (default: local)",
  "  --name <name>    Repository name label (default: directory name)",
  "",
].join("\n");

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function runCli(
  args: readonly string[],
  writers: CliWriters,
): Promise<CliResult> {
  if (args.length === 0 || args[0] !== "analyze") {
    writers.writeStderr(usage);
    return { exitCode: 2 };
  }

  const repositoryPathArgument = args[1];
  const outputArgument = optionValue(args, "--output");
  if (!repositoryPathArgument || !outputArgument) {
    writers.writeStderr(usage);
    return { exitCode: 2 };
  }

  const repositoryPath = path.resolve(repositoryPathArgument);
  try {
    const branch =
      optionValue(args, "--branch") ?? (await getCurrentBranch(repositoryPath));
    const name =
      optionValue(args, "--name") ??
      (path.basename(repositoryPath) || "repository");
    const bundle = await analyzeRepository({
      repositoryPath,
      branch,
      repository: {
        owner: optionValue(args, "--owner") ?? "local",
        name,
      },
    });
    await writeFile(
      path.resolve(outputArgument),
      `${JSON.stringify(bundle, null, 2)}\n`,
      "utf8",
    );
    writers.writeStdout(
      `Wrote ${bundle.keyframes.length} keyframes to ${path.resolve(outputArgument)}\n`,
    );
    return { exitCode: 0 };
  } catch (error) {
    writers.writeStderr(
      `Analysis failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return { exitCode: 1 };
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runCli(process.argv.slice(2), {
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  });
  process.exitCode = result.exitCode;
}
