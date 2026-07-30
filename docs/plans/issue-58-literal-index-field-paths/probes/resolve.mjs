/**
 * Resolve every exported non-generic type alias in a probe file through the TypeScript compiler
 * API. The plan cites this output rather than inferring types from diagnostics.
 *
 * Usage:
 *   node docs/plans/issue-58-literal-index-field-paths/probes/resolve.mjs \
 *     docs/plans/issue-58-literal-index-field-paths/probes/field-paths.probe.ts
 */
import path from 'node:path';
import ts from 'typescript';

const file = path.resolve(process.argv[2]);
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram([file], {
  ...parsed.options,
  declaration: false,
  noEmit: true,
  strict: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(file);
const diagnostics = [
  ...program.getSyntacticDiagnostics(source),
  ...program.getSemanticDiagnostics(source),
];

if (diagnostics.length > 0) {
  console.error('### DIAGNOSTICS ###');
  for (const diagnostic of diagnostics) {
    const position =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
    console.error(
      `TS${diagnostic.code}${position ? ` @${position.line + 1}:${position.character + 1}` : ''}: ` +
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    );
  }
  process.exitCode = 1;
}

const flags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.InTypeAlias |
  ts.TypeFormatFlags.UseFullyQualifiedType;

console.log(`### RESOLVED ALIASES — ${path.relative(process.cwd(), file)} ###`);
for (const statement of source.statements) {
  if (!ts.isTypeAliasDeclaration(statement) || statement.typeParameters?.length) continue;
  const type = checker.getTypeAtLocation(statement.name);
  console.log(`${statement.name.text} = ${checker.typeToString(type, undefined, flags)}`);
}
