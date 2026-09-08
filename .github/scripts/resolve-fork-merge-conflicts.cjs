const { spawnSync } = require("node:child_process");

const LOCKFILE_PATH = "pnpm-lock.yaml";

// Identity artwork only. Mixed product files (electron-launcher, branding.ts,
// app.config.ts, ChatMarkdown) stay manual even when they mention the fork name.
const BRANDING_KEEP_OURS_EXACT = new Set([
  "apps/mobile/assets/android-icon-foreground.png",
  "apps/mobile/assets/android-icon-mark.png",
  "apps/mobile/assets/android-notification-icon.png",
  "apps/mobile/assets/widget/T3Mark.svg",
  "apps/web/public/apple-touch-icon.png",
  "apps/web/public/favicon-16x16.png",
  "apps/web/public/favicon-32x32.png",
  "apps/web/public/favicon.ico",
  "apps/web/public/t3-code-math-icon.png",
  "assets/prod/logo.svg",
]);

const BRANDING_KEEP_OURS_PREFIXES = [
  "assets/dev/",
  "assets/nightly/",
  "assets/prod/app-icon.icon/",
  "assets/prod/black-",
  "assets/prod/t3-black-",
];

const BRANDING_ACCEPT_UPSTREAM_DELETE = new Set(["apps/mobile/assets/android-icon-foreground.svg"]);

function isBrandingKeepOurs(filePath) {
  return (
    BRANDING_KEEP_OURS_EXACT.has(filePath) ||
    BRANDING_KEEP_OURS_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

function classifyConflict(filePath, { theirsDeleted = false } = {}) {
  if (filePath === LOCKFILE_PATH) {
    return "lockfile";
  }
  if (BRANDING_ACCEPT_UPSTREAM_DELETE.has(filePath) && theirsDeleted) {
    return "delete";
  }
  if (isBrandingKeepOurs(filePath)) {
    return "ours";
  }
  return "manual";
}

function planResolutions(filePaths, metaByFile = {}) {
  const actions = [];
  const remaining = [];
  for (const filePath of filePaths) {
    const action = classifyConflict(filePath, metaByFile[filePath]);
    if (action === "manual") {
      remaining.push(filePath);
    } else {
      actions.push({ filePath, action });
    }
  }
  return { actions, remaining };
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`git ${args.join(" ")} failed: ${details}`);
  }
  return result.stdout;
}

function listUnmergedFiles() {
  return runGit(["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readUnmergedStages(filePath) {
  const stdout = runGit(["ls-files", "-u", "--", filePath]);
  const stages = new Set();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^\S+\s+\S+\s+(\d+)\t/);
    if (match) {
      stages.add(Number(match[1]));
    }
  }
  return {
    oursDeleted: stages.has(1) && !stages.has(2),
    theirsDeleted: stages.has(1) && !stages.has(3),
  };
}

function applyResolutions(upstreamSha) {
  if (!upstreamSha) {
    throw new Error("upstream SHA is required");
  }

  const files = listUnmergedFiles();
  const metaByFile = Object.fromEntries(
    files.map((filePath) => [filePath, readUnmergedStages(filePath)]),
  );
  const { actions, remaining } = planResolutions(files, metaByFile);

  for (const { filePath, action } of actions) {
    if (action === "lockfile") {
      runGit(["checkout", upstreamSha, "--", filePath]);
      runGit(["add", "--", filePath]);
      console.error(`took upstream ${filePath}`);
    } else if (action === "ours") {
      runGit(["checkout", "--ours", "--", filePath]);
      runGit(["add", "--", filePath]);
      console.error(`kept fork ${filePath}`);
    } else if (action === "delete") {
      runGit(["rm", "-f", "--", filePath]);
      console.error(`accepted upstream deletion of ${filePath}`);
    }
  }

  return remaining;
}

function parseUpstreamSha(argv) {
  const index = argv.indexOf("--upstream-sha");
  if (index === -1 || !argv[index + 1]) {
    return null;
  }
  return argv[index + 1];
}

module.exports = {
  BRANDING_ACCEPT_UPSTREAM_DELETE,
  BRANDING_KEEP_OURS_EXACT,
  LOCKFILE_PATH,
  applyResolutions,
  classifyConflict,
  isBrandingKeepOurs,
  planResolutions,
};

if (require.main === module) {
  try {
    const upstreamSha = parseUpstreamSha(process.argv.slice(2));
    if (!upstreamSha) {
      console.error("Usage: resolve-fork-merge-conflicts.cjs --upstream-sha <sha>");
      process.exit(2);
    }
    const remaining = applyResolutions(upstreamSha);
    if (remaining.length > 0) {
      process.stdout.write(`${remaining.join("\n")}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
