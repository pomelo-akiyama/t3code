const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyResolutions,
  classifyConflict,
  isBrandingKeepOurs,
  planResolutions,
} = require("./resolve-fork-merge-conflicts.cjs");

test("classifies lockfile, branding artwork, unused svg deletion, and shared source", () => {
  assert.equal(classifyConflict("pnpm-lock.yaml"), "lockfile");
  assert.equal(classifyConflict("apps/mobile/assets/android-icon-foreground.png"), "ours");
  assert.equal(
    classifyConflict("apps/mobile/assets/android-icon-foreground.svg", { theirsDeleted: true }),
    "delete",
  );
  assert.equal(classifyConflict("apps/mobile/assets/android-icon-foreground.svg"), "manual");
  assert.equal(classifyConflict("apps/desktop/scripts/electron-launcher.mjs"), "manual");
  assert.equal(
    classifyConflict("apps/mobile/src/features/threads/ThreadRouteScreen.tsx"),
    "manual",
  );
  assert.equal(classifyConflict("apps/web/src/components/ChatMarkdown.tsx"), "manual");
  assert.equal(classifyConflict("apps/web/src/branding.ts"), "manual");
  assert.equal(classifyConflict("apps/mobile/assets/android-icon-background-dev.png"), "manual");
});

test("keeps fork icon families without swallowing official Android backgrounds", () => {
  assert.equal(isBrandingKeepOurs("assets/prod/black-macos-1024.png"), true);
  assert.equal(isBrandingKeepOurs("assets/prod/t3-black-web-favicon.ico"), true);
  assert.equal(isBrandingKeepOurs("assets/prod/app-icon.icon/Assets/text.svg"), true);
  assert.equal(isBrandingKeepOurs("assets/dev/blueprint-macos-1024.png"), true);
  assert.equal(isBrandingKeepOurs("assets/nightly/nightly-ios-1024.png"), true);
  assert.equal(isBrandingKeepOurs("apps/mobile/assets/android-icon-background-dev.png"), false);
  assert.equal(isBrandingKeepOurs("apps/mobile/app.config.ts"), false);
});

test("plans automatic resolutions and leaves shared files for a human", () => {
  const { actions, remaining } = planResolutions(
    [
      "pnpm-lock.yaml",
      "apps/mobile/assets/android-icon-foreground.png",
      "apps/mobile/assets/android-icon-foreground.svg",
      "apps/desktop/scripts/electron-launcher.mjs",
    ],
    {
      "apps/mobile/assets/android-icon-foreground.svg": { theirsDeleted: true },
    },
  );

  assert.deepEqual(
    actions.map((item) => item.action),
    ["lockfile", "ours", "delete"],
  );
  assert.deepEqual(remaining, ["apps/desktop/scripts/electron-launcher.mjs"]);
});

test("applies lockfile and branding resolutions in a real merge", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fork-merge-"));
  const git = (args, options = {}) => {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      ...options,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };

  git(["init", "-b", "main"]);
  git(["config", "user.name", "fork-merge-test"]);
  git(["config", "user.email", "fork-merge-test@example.com"]);

  fs.mkdirSync(path.join(root, "apps/mobile/assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps/web/src/components"), { recursive: true });
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock: base\n");
  fs.writeFileSync(path.join(root, "apps/mobile/assets/android-icon-foreground.png"), "icon-base");
  fs.writeFileSync(path.join(root, "apps/mobile/assets/android-icon-foreground.svg"), "<svg/>");
  fs.writeFileSync(path.join(root, "apps/web/src/components/ChatMarkdown.tsx"), "markdown-base\n");
  git(["add", "."]);
  git(["commit", "-m", "base"]);

  git(["checkout", "-b", "upstream"]);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock: upstream\n");
  fs.writeFileSync(
    path.join(root, "apps/mobile/assets/android-icon-foreground.png"),
    "icon-upstream",
  );
  fs.rmSync(path.join(root, "apps/mobile/assets/android-icon-foreground.svg"));
  fs.writeFileSync(
    path.join(root, "apps/web/src/components/ChatMarkdown.tsx"),
    "markdown-upstream\n",
  );
  git(["add", "-A"]);
  git(["commit", "-m", "upstream"]);
  const upstreamSha = git(["rev-parse", "HEAD"]).trim();

  git(["checkout", "main"]);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lock: fork\n");
  fs.writeFileSync(path.join(root, "apps/mobile/assets/android-icon-foreground.png"), "icon-fork");
  fs.writeFileSync(
    path.join(root, "apps/mobile/assets/android-icon-foreground.svg"),
    "<svg fork/>",
  );
  fs.writeFileSync(path.join(root, "apps/web/src/components/ChatMarkdown.tsx"), "markdown-fork\n");
  git(["add", "-A"]);
  git(["commit", "-m", "fork"]);

  const merge = spawnSync("git", ["merge", "--no-ff", "--no-edit", upstreamSha], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(merge.status, 0);

  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const remaining = applyResolutions(upstreamSha);
    assert.deepEqual(remaining, ["apps/web/src/components/ChatMarkdown.tsx"]);
    assert.equal(fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8"), "lock: upstream\n");
    assert.equal(
      fs.readFileSync(path.join(root, "apps/mobile/assets/android-icon-foreground.png"), "utf8"),
      "icon-fork",
    );
    assert.equal(
      fs.existsSync(path.join(root, "apps/mobile/assets/android-icon-foreground.svg")),
      false,
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
