const ts = require(process.cwd() + "/node_modules/typescript");
const cfgPath = ts.findConfigFile(
  process.cwd(),
  ts.sys.fileExists,
  "tsconfig.json",
);
const cfg = ts.getParsedCommandLineOfConfigFile(
  cfgPath,
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
);
const files = cfg.fileNames.filter(
  (f) => !f.includes("node_modules") && !/\/skills\//.test(f),
);
const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => "0",
  getScriptSnapshot: (f) =>
    ts.sys.fileExists(f)
      ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f))
      : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => cfg.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host);
let n = 0;
for (const f of files) {
  for (const d of ls.getSuggestionDiagnostics(f)) {
    if (!d.reportsDeprecated) continue;
    const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    console.log(`${f.replace(process.cwd() + "/", "")}:${line + 1}  ${msg}`);
    n++;
  }
}
console.log("total deprecated usages:", n, "files scanned:", files.length);
