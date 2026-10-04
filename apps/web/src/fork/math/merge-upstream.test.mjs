import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";
import {
  addMathIntegration,
  mergePackageJson,
  selectLatestStableTag,
  stripMathIntegration,
} from "./merge-upstream.mjs";

const script = NodeURL.fileURLToPath(new URL("./check-upstream.mjs", import.meta.url));
const markdownPath = "apps/web/src/components/ChatMarkdown.tsx";
const integrated = NodeFS.readFileSync(
  new URL("../../components/ChatMarkdown.tsx", import.meta.url),
  "utf8",
);
const plain = stripMathIntegration(integrated);

NodeTest.test("只选择数字版本最高的 stable，排除所有预发布版本", () => {
  const tags = [
    "v0.0.9",
    "v0.0.10",
    "v0.0.11-preview.20260925.9",
    "v0.0.11-preview.20260925.10",
    "v99.0.0-nightly.1",
    "v99.0.0-beta.1",
    "v99.0.0-preview.1-nightly.2",
  ];
  NodeAssert.equal(selectLatestStableTag(tags), "v0.0.10");
  NodeAssert.equal(selectLatestStableTag(["v1.0.0-preview.1", "v99.0.0-nightly.1"]), undefined);
  NodeAssert.equal(selectLatestStableTag([]), undefined);
});

NodeTest.test("公式接入可以无损移除和恢复，缺失或重复的接入点必须停止", () => {
  NodeAssert.equal(addMathIntegration(plain), integrated);
  NodeAssert.throws(
    () => addMathIntegration(plain.replaceAll("dataInlineCode", "changedCode")),
    /接入位置已改变/,
  );
  NodeAssert.throws(() => addMathIntegration(plain + plain), /接入位置已改变/);
  NodeAssert.throws(
    () => stripMathIntegration(integrated.replace("{math.markdown}", "{differentText}")),
    /接入位置已改变/,
  );
});

NodeTest.test("依赖合并保留本地 KaTeX、上游删除和升级，拒绝同字段分歧", () => {
  NodeAssert.deepEqual(
    mergePackageJson(
      { dependencies: { lexical: "1", react: "1" } },
      { dependencies: { lexical: "1", react: "1", katex: "2" } },
      { dependencies: { react: "2", editor: "3" } },
    ),
    { dependencies: { react: "2", editor: "3", katex: "2" } },
  );
  NodeAssert.throws(
    () =>
      mergePackageJson(
        { dependencies: { katex: "1" } },
        { dependencies: { katex: "2" } },
        { dependencies: { katex: "3" } },
      ),
    /dependencies.katex/,
  );
  NodeAssert.throws(
    () =>
      mergePackageJson(
        { scripts: { test: "old" } },
        { scripts: { test: "local" } },
        { scripts: {} },
      ),
    /scripts.test/,
  );
});

function fixture(t, { unknownConflict = false, packageConflict = false, stableTags = true } = {}) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-upstream-test-"));
  t.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
  const upstream = NodePath.join(root, "upstream");
  const fork = NodePath.join(root, "fork");
  NodeFS.mkdirSync(upstream);
  function git(cwd, ...args) {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    NodeAssert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  const write = (cwd, path, content) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, path), content);
  };
  const commit = (cwd, message) => {
    git(cwd, "add", ".");
    git(
      cwd,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      message,
    );
  };
  git(upstream, "init", "-qb", "main");
  write(upstream, markdownPath, plain);
  write(upstream, "apps/web/package.json", '{"dependencies":{"lexical":"1","react":"1"}}\n');
  write(upstream, "pnpm-lock.yaml", "original lock\n");
  write(upstream, "unrelated.txt", "original\n");
  commit(upstream, "base");
  git(root, "clone", "-q", upstream, fork);
  git(fork, "remote", "add", "upstream", upstream);
  git(fork, "config", "user.name", "test");
  git(fork, "config", "user.email", "test@example.com");
  write(fork, markdownPath, integrated);
  write(
    fork,
    "apps/web/package.json",
    `{"dependencies":{"lexical":"1","react":"${packageConflict ? "local" : "1"}","katex":"2"}}\n`,
  );
  write(fork, "pnpm-lock.yaml", "fork lock\n");
  if (unknownConflict) write(fork, "unrelated.txt", "local\n");
  commit(fork, "fork");
  const incremental = plain.includes("  const incrementalParsing =")
    ? plain
    : plain
        .replace(
          "  const remarkPlugins = useMemo(",
          "  const incrementalParsing = props.isStreaming === true;\n  const remarkPlugins = useMemo(",
        )
        .replace(
          "      ...extraRemarkPlugins,",
          "      ...extraRemarkPlugins,\n      ...(incrementalParsing ? [createIncrementalMarkdownPlugin()] : []),",
        )
        .replace(
          "[extraRemarkPlugins, lineBreaks]",
          "[extraRemarkPlugins, incrementalParsing, lineBreaks]",
        );
  const updated = incremental.replace(
    'import { GitHubIcon } from "./Icons";',
    'import { upstreamFeature } from "./upstream-feature";\nimport { GitHubIcon } from "./Icons";',
  );
  write(upstream, markdownPath, updated);
  write(upstream, "apps/web/package.json", '{"dependencies":{"react":"2","editor":"3"}}\n');
  write(upstream, "pnpm-lock.yaml", "upstream lock\n");
  if (unknownConflict) write(upstream, "unrelated.txt", "upstream\n");
  commit(upstream, "stable");
  if (stableTags) git(upstream, "tag", "v1.0.1");
  write(upstream, "latest-stable.txt", "latest stable\n");
  commit(upstream, "latest stable");
  if (stableTags) git(upstream, "tag", "v1.0.2");
  write(upstream, "preview.txt", "preview\n");
  commit(upstream, "preview");
  git(upstream, "tag", "v1.1.0-preview.20260927.10");
  write(upstream, "nightly.txt", "nightly\n");
  commit(upstream, "nightly");
  git(upstream, "tag", "v99.0.0-nightly.20260927");
  const run = (channel = "stable") =>
    NodeChildProcess.spawnSync(process.execPath, [script, channel], {
      cwd: fork,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: NodePath.join(root, "output") },
    });
  return { fork, git, commit, run };
}

NodeTest.test("拒绝 preview 通道且不改变当前检出", (t) => {
  const { fork, git, run } = fixture(t);
  const before = git(fork, "rev-parse", "HEAD");
  const result = run("preview");
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /自动合并只支持 stable/);
  NodeAssert.equal(git(fork, "rev-parse", "HEAD"), before);
  NodeAssert.equal(git(fork, "status", "--porcelain"), "");
});

NodeTest.test("没有正式版时停止，不退回 preview 或 nightly", (t) => {
  const { fork, git, run } = fixture(t, { stableTags: false });
  const before = git(fork, "rev-parse", "HEAD");
  const result = run();
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /未找到上游正式版本标签/);
  NodeAssert.equal(git(fork, "rev-parse", "HEAD"), before);
  NodeAssert.equal(git(fork, "status", "--porcelain"), "");
});

NodeTest.test("只合并最新 stable 并保留公式和上游流式解析", (t) => {
  const { fork, git, commit, run } = fixture(t);
  const result = run();
  NodeAssert.equal(result.status, 0, result.stderr);
  const source = NodeFS.readFileSync(NodePath.join(fork, markdownPath), "utf8");
  NodeAssert.match(source, /useMathMarkdown\(text, remarkPlugins\)/);
  NodeAssert.match(source, /import \{ upstreamFeature \}/);
  NodeAssert.match(result.stdout, /已自动处理 apps\/web\/src\/components\/ChatMarkdown.tsx/);
  NodeAssert.match(source, /incrementalParsing \? \[createIncrementalMarkdownPlugin\(\)\]/);
  NodeAssert.match(source, /\[extraRemarkPlugins, incrementalParsing, lineBreaks\]/);
  NodeAssert.deepEqual(
    JSON.parse(NodeFS.readFileSync(NodePath.join(fork, "apps/web/package.json"), "utf8"))
      .dependencies,
    { react: "2", editor: "3", katex: "2" },
  );
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(fork, "latest-stable.txt")), true);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(fork, "preview.txt")), false);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(fork, "nightly.txt")), false);
  NodeAssert.equal(git(fork, "diff", "--name-only", "--diff-filter=U"), "");
  commit(fork, "verified merge");
  const again = run();
  NodeAssert.equal(again.status, 0, again.stderr);
  NodeAssert.match(again.stdout, /v1.0.2 已合并/);
});

NodeTest.test("不自动覆盖未知冲突", (t) => {
  const { fork, git, run } = fixture(t, { unknownConflict: true });
  const before = git(fork, "rev-parse", "HEAD");
  const result = run();
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /无法自动处理的上游冲突：\nunrelated.txt/);
  NodeAssert.equal(git(fork, "rev-parse", "HEAD"), before);
});

NodeTest.test("依赖语义冲突阻止自动合并", (t) => {
  const { run } = fixture(t, { packageConflict: true });
  const result = run("stable");
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /dependencies.react/);
});

NodeTest.test("拒绝在用户未提交的修改上开始合并", (t) => {
  const { fork, run } = fixture(t);
  NodeFS.writeFileSync(NodePath.join(fork, "unrelated.txt"), "user edit\n");
  const result = run("stable");
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /干净的临时检出/);
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(fork, "unrelated.txt"), "utf8"),
    "user edit\n",
  );
});
