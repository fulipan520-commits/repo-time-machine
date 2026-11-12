import path from "node:path";
import ts from "typescript";

export interface PathAlias {
  pattern: string;
  targets: string[];
}

export interface ExtractedTypeScriptImport {
  sourceFile: string;
  targetFile: string;
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function applyAlias(
  specifier: string,
  aliases: readonly PathAlias[],
): string | undefined {
  const orderedAliases = [...aliases].sort(
    (left, right) => right.pattern.length - left.pattern.length,
  );

  for (const alias of orderedAliases) {
    const starIndex = alias.pattern.indexOf("*");
    const prefix = starIndex === -1 ? alias.pattern : alias.pattern.slice(0, starIndex);
    const suffix =
      starIndex === -1 ? "" : alias.pattern.slice(starIndex + 1);

    if (
      !specifier.startsWith(prefix) ||
      !specifier.endsWith(suffix)
    ) {
      continue;
    }

    const wildcard =
      starIndex === -1
        ? ""
        : specifier.slice(prefix.length, specifier.length - suffix.length);
    const target = alias.targets[0];
    if (target) {
      return target.replace("*", wildcard);
    }
  }

  return undefined;
}

function withSourceExtension(candidate: string): string | undefined {
  const extension = path.posix.extname(candidate);
  if (extension) {
    return candidate;
  }
  return `${candidate}.ts`;
}

export function extractTypeScriptImports(
  sourceFile: string,
  source: string,
  aliases: readonly PathAlias[] = [],
): ExtractedTypeScriptImport[] {
  const parsed = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sourceDirectory = path.posix.dirname(sourceFile);
  const imports: ExtractedTypeScriptImport[] = [];
  const seen = new Set<string>();
  const moduleSpecs = moduleSpecifiers(parsed);

  for (const specifier of moduleSpecs) {
    let candidate: string | undefined;

    if (specifier.startsWith(".")) {
      candidate = path.posix.normalize(path.posix.join(sourceDirectory, specifier));
      if (candidate.startsWith("../") || candidate === "..") {
        continue;
      }
    } else {
      candidate = applyAlias(specifier, aliases);
      if (!candidate) {
        continue;
      }
    }

    const targetFile = withSourceExtension(candidate);
    if (!targetFile || targetFile === sourceFile || seen.has(targetFile)) {
      continue;
    }

    seen.add(targetFile);
    imports.push({ sourceFile, targetFile });
  }

  return imports;
}
