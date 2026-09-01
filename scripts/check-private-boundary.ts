#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - The pre-commit boundary reads Git's staged paths before the repository's Effect runtime exists.

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const PRIVATE_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.mobileprovision$/i,
  /^id_(?:rsa|ed25519)(?!.*\.pub$)/i,
  /^\.credentials(?:\..+)?$/i,
  /^\.env(?:\.(?!example$).+)?$/i,
];

const fileName = (filePath: string): string =>
  NodePath.posix.basename(filePath.replaceAll("\\", "/"));

export const findPrivateMaterialPaths = (filePaths: ReadonlyArray<string>): ReadonlyArray<string> =>
  filePaths.filter((filePath) =>
    PRIVATE_FILE_PATTERNS.some((pattern) => pattern.test(fileName(filePath))),
  );

const stagedPaths = (): ReadonlyArray<string> =>
  NodeChildProcess.execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter((filePath) => filePath.length > 0);

const main = (): void => {
  const violations = findPrivateMaterialPaths(stagedPaths());
  if (violations.length === 0) return;

  NodeProcess.stderr.write(
    [
      "Private material must live under the ignored .fork-local/ boundary:",
      ...violations.map((filePath) => `  ${filePath}`),
      "Move these files into .fork-local/ before committing.",
      "",
    ].join("\n"),
  );
  NodeProcess.exit(1);
};

const entryPath = NodeProcess.argv[1];
if (entryPath !== undefined && import.meta.url === NodeURL.pathToFileURL(entryPath).href) main();
