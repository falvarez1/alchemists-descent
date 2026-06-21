#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const args = new Set(process.argv.slice(2));
const baselineMode = args.has('--baseline');
const strictMode = args.has('--strict');
const selfTestMode = args.has('--self-test');

const FORBIDDEN_AUTHORING_PREFIXES = [
  'src/builder/',
  'src/game/',
  'src/entities/',
  'src/combat/',
  'src/ui/',
];
const FORBIDDEN_AUTHORING_GLOBALS = new Set([
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
]);

const RUNTIME_SHELL_IMPORTS = new Set([
  'src/app/BuilderLauncher.ts|dynamic|@/builder/Builder',
]);

const FORBIDDEN_RUNTIME_PREFIXES = [
  'src/builder/',
];

const FORBIDDEN_RUNTIME_EXACTS = new Set([
  'src/ui/editor/DockHost',
  'src/ui/editor/Fields',
  'src/ui/editor/InspectorSchema',
  'src/ui/editor/PanelChrome',
  'src/ui/editor/PanelRegistry',
  'src/ui/editor/Section',
  'src/ui/editor/Workspace',
]);

const RUNTIME_EXCLUDED_PREFIXES = [
  'src/builder/',
  'src/authoring/',
  'src/ui/editor/',
];

const isTsFile = (file) => file.endsWith('.ts') || file.endsWith('.tsx');

async function listFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (isTsFile(full)) out.push(full);
  }
  return out;
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, '/');
}

function normalizeRepoTarget(value) {
  if (!value.startsWith('src/') && !value.startsWith('src\\')) return value;
  return path.normalize(value).replaceAll(path.sep, '/').replace(/\/$/, '');
}

function targetStartsWith(target, prefix) {
  const cleanTarget = normalizeRepoTarget(target);
  const cleanPrefix = normalizeRepoTarget(prefix).replace(/\/$/, '');
  return cleanTarget === cleanPrefix || cleanTarget.startsWith(`${cleanPrefix}/`);
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('@/')) return normalizeRepoTarget(path.join('src', specifier.slice(2)));
  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    return normalizeRepoTarget(toRepoPath(resolved));
  }
  return specifier;
}

function importKind(node) {
  if (!node.importClause) return 'static';
  if (node.importClause.isTypeOnly) return 'type';
  const bindings = node.importClause.namedBindings;
  if (bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0) {
    const allTypeOnly = bindings.elements.every((element) => element.isTypeOnly);
    if (allTypeOnly && !node.importClause.name) return 'type';
  }
  return 'static';
}

function collectImports(file) {
  const text = ts.sys.readFile(file);
  if (text === undefined) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [];

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        file,
        kind: importKind(node),
        specifier: node.moduleSpecifier.text,
        target: resolveSpecifier(node.moduleSpecifier.text, file),
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        file,
        kind: node.isTypeOnly ? 'type' : 'static',
        specifier: node.moduleSpecifier.text,
        target: resolveSpecifier(node.moduleSpecifier.text, file),
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({
        file,
        kind: 'dynamic',
        specifier: node.arguments[0].text,
        target: resolveSpecifier(node.arguments[0].text, file),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function collectAuthoringLocalViolations(file) {
  const repoPath = toRepoPath(file);
  if (!repoPath.startsWith('src/authoring/')) return [];
  const text = ts.sys.readFile(file);
  if (text === undefined) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const namedBindings = node.importClause.namedBindings;
      if (node.importClause.name?.text === 'Ctx') {
        violations.push({
          file,
          kind: 'static',
          specifier: 'Ctx',
          target: 'Ctx',
          repoPath,
          key: `${repoPath}|static|Ctx`,
          reason: 'neutral authoring contract imports full runtime Ctx',
        });
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (importedName === 'Ctx') {
            violations.push({
              file,
              kind: element.isTypeOnly || node.importClause.isTypeOnly ? 'type' : 'static',
              specifier: 'Ctx',
              target: 'Ctx',
              repoPath,
              key: `${repoPath}|${element.isTypeOnly || node.importClause.isTypeOnly ? 'type' : 'static'}|Ctx`,
              reason: 'neutral authoring contract imports full runtime Ctx',
            });
          }
        }
      }
    }
    if (ts.isIdentifier(node) && FORBIDDEN_AUTHORING_GLOBALS.has(node.text)) {
      violations.push({
        file,
        kind: 'global',
        specifier: node.text,
        target: node.text,
        repoPath,
        key: `${repoPath}|global|${node.text}|${source.getLineAndCharacterOfPosition(node.getStart(source)).line}`,
        reason: `neutral authoring contract references browser/global API ${node.text}`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function runtimeViolation(record) {
  const repoPath = toRepoPath(record.file);
  if (!repoPath.startsWith('src/')) return null;
  if (RUNTIME_EXCLUDED_PREFIXES.some((prefix) => targetStartsWith(repoPath, prefix))) return null;
  const key = `${repoPath}|${record.kind}|${record.specifier}`;
  if (RUNTIME_SHELL_IMPORTS.has(key)) return null;
  const target = normalizeRepoTarget(record.target);
  const forbiddenPrefix = FORBIDDEN_RUNTIME_PREFIXES.find((prefix) => targetStartsWith(target, prefix));
  const forbiddenExact = FORBIDDEN_RUNTIME_EXACTS.has(target);
  if (!forbiddenPrefix && !forbiddenExact) return null;
  return {
    ...record,
    target,
    repoPath,
    key,
    reason: forbiddenPrefix
      ? 'runtime/player-facing code imports Builder-owned module'
      : 'runtime/player-facing code imports Builder editor shell module',
  };
}

function authoringViolation(record) {
  const repoPath = toRepoPath(record.file);
  if (!repoPath.startsWith('src/authoring/')) return null;
  const target = normalizeRepoTarget(record.target);
  const forbidden = FORBIDDEN_AUTHORING_PREFIXES.find((prefix) => targetStartsWith(target, prefix));
  if (!forbidden) return null;
  return {
    ...record,
    target,
    repoPath,
    key: `${repoPath}|${record.kind}|${record.specifier}`,
    reason: `neutral authoring contract imports forbidden ${forbidden}`,
  };
}

function formatViolation(v) {
  return `${v.repoPath} ${v.kind} ${v.specifier} -> ${v.target} (${v.reason})`;
}

const files = [
  ...await listFiles(srcRoot),
].filter((file) => !toRepoPath(file).startsWith('src/builder/'));
const seen = new Set();
const imports = [];
const localViolations = [];
for (const file of files) {
  if (seen.has(file)) continue;
  seen.add(file);
  imports.push(...collectImports(file));
  localViolations.push(...collectAuthoringLocalViolations(file));
}
if (selfTestMode) {
  const selfTestImport = (repoPath, specifier) => ({
    file: path.join(repoRoot, repoPath),
    kind: 'static',
    specifier,
    target: resolveSpecifier(specifier, path.join(repoRoot, repoPath)),
  });
  imports.push(
    selfTestImport('src/input/__boundary_self_test.ts', '@/builder/document'),
    selfTestImport('src/config/__boundary_self_test.ts', '@/authoring/../builder/document'),
    selfTestImport('src/ui/__boundary_self_test.ts', '@/ui/editor/PanelRegistry'),
    selfTestImport('src/authoring/__boundary_self_test.ts', '@/game/instantiate'),
    selfTestImport('src/authoring/__boundary_alias_self_test.ts', '@/authoring/../game/instantiate'),
  );
  localViolations.push(
    {
      file: path.join(srcRoot, 'authoring', '__boundary_self_test_ctx.ts'),
      kind: 'type',
      specifier: 'Ctx',
      target: 'Ctx',
      repoPath: 'src/authoring/__boundary_self_test_ctx.ts',
      key: 'src/authoring/__boundary_self_test_ctx.ts|type|Ctx',
      reason: 'neutral authoring contract imports full runtime Ctx',
    },
    {
      file: path.join(srcRoot, 'authoring', '__boundary_self_test_dom.ts'),
      kind: 'global',
      specifier: 'localStorage',
      target: 'localStorage',
      repoPath: 'src/authoring/__boundary_self_test_dom.ts',
      key: 'src/authoring/__boundary_self_test_dom.ts|global|localStorage',
      reason: 'neutral authoring contract references browser/global API localStorage',
    },
  );
}

const violations = [
  ...imports
  .flatMap((record) => [runtimeViolation(record), authoringViolation(record)])
  .filter(Boolean),
  ...localViolations,
]
  .sort((a, b) => a.key.localeCompare(b.key));

if (baselineMode) {
  console.log('Builder boundary baseline:');
  if (violations.length === 0) console.log('  no violations found');
  for (const v of violations) console.log('  ' + formatViolation(v));
  process.exit(0);
}

if (violations.length > 0) {
  console.error('Builder boundary violations found:');
  for (const v of violations) console.error('  ' + formatViolation(v));
  process.exit(1);
}

console.log(strictMode
  ? 'Builder boundary check passed with no violations.'
  : 'Builder boundary check passed with no violations (strict by default).');
