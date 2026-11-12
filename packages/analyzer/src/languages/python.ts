import { createRequire } from "node:module";
import path from "node:path";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);

let pythonParser: Promise<Parser> | undefined;

async function getPythonParser(): Promise<Parser> {
  pythonParser ??= (async () => {
    await Parser.init();
    const packageDirectory = path.dirname(
      require.resolve("tree-sitter-wasms/package.json"),
    );
    const language = await Parser.Language.load(
      path.join(packageDirectory, "out", "tree-sitter-python.wasm"),
    );
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();

  return pythonParser;
}

export interface ExtractedImport {
  sourceFile: string;
  targetFile: string;
}

function sourceDirectoryParts(sourceFile: string): string[] {
  const directory = path.posix.dirname(sourceFile);
  return directory === "." ? [] : directory.split("/").filter(Boolean);
}

function modulesFromImportStatement(statement: string): string[] {
  const body = statement.replace(/^import\s+/, "");
  return body
    .split(",")
    .map((part) => part.trim().split(/\s+as\s+/)[0] ?? "")
    .filter((part) => /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(part));
}

function resolveAbsoluteModule(
  sourceFile: string,
  moduleName: string,
): string | undefined {
  const moduleParts = moduleName.split(".");
  const firstPart = moduleParts[0];
  if (!firstPart) {
    return undefined;
  }

  const sourceParts = sourceDirectoryParts(sourceFile);
  for (let index = sourceParts.length - 1; index >= 0; index -= 1) {
    if (sourceParts[index] === firstPart) {
      return [...sourceParts.slice(0, index), ...moduleParts].join("/") + ".py";
    }
  }

  return undefined;
}

function resolveRelativeModule(
  sourceFile: string,
  dots: string,
  moduleName: string,
): string | undefined {
  if (!moduleName) {
    return undefined;
  }

  const sourceParts = sourceDirectoryParts(sourceFile);
  const levelsToRemove = Math.max(0, dots.length - 1);
  const baseParts =
    levelsToRemove === 0
      ? sourceParts
      : sourceParts.slice(0, -levelsToRemove);

  return [...baseParts, ...moduleName.split(".")].join("/") + ".py";
}

function importsFromNode(node: Parser.SyntaxNode): string[] {
  const statement = node.text.trim();

  if (node.type === "import_statement") {
    return modulesFromImportStatement(statement);
  }

  if (node.type !== "import_from_statement") {
    return [];
  }

  const match = statement.match(/^from\s+(\.*)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)?\s+import\b/);
  if (!match) {
    return [];
  }

  const dots = match[1] ?? "";
  const moduleName = match[2] ?? "";
  return moduleName ? [`${dots}${moduleName}`] : [];
}

export async function extractPythonImports(
  sourceFile: string,
  source: string,
): Promise<ExtractedImport[]> {
  const parser = await getPythonParser();
  const tree = parser.parse(source);
  if (!tree) {
    return [];
  }

  const imports: ExtractedImport[] = [];
  const seen = new Set<string>();

  for (const node of tree.rootNode.descendantsOfType([
    "import_statement",
    "import_from_statement",
  ])) {
    for (const expression of importsFromNode(node)) {
      const targetFile = expression.startsWith(".")
        ? resolveRelativeModule(
            sourceFile,
            expression.match(/^\.*/)?.[0] ?? "",
            expression.replace(/^\.*/, ""),
          )
        : resolveAbsoluteModule(sourceFile, expression);

      if (!targetFile || targetFile === sourceFile || seen.has(targetFile)) {
        continue;
      }

      seen.add(targetFile);
      imports.push({ sourceFile, targetFile });
    }
  }

  return imports;
}
