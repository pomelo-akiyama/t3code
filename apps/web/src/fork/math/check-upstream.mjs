import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import {
  addMathIntegration,
  mergePackageJson,
  selectUpstreamTag,
  stripMathIntegration,
} from "./merge-upstream.mjs";

function git(...args) {
  const result = NodeChildProcess.spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function requireGit(...args) {
  const result = git(...args);
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} 执行失败`);
  return result.stdout;
}

function report(values) {
  if (process.env.GITHUB_OUTPUT) {
    NodeFS.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
}

function resolveMarkdown(path) {
  const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-math-merge-"));
  try {
    const files = [2, 1, 3].map((stage) => {
      const file = NodePath.join(temporary, String(stage));
      NodeFS.writeFileSync(file, stripMathIntegration(requireGit("show", `:${stage}:${path}`)));
      return file;
    });
    const merged = git("merge-file", "-p", ...files);
    if (merged.status !== 0) throw new Error(`公式接入以外仍有冲突：${path}\n${merged.stderr}`);
    NodeFS.writeFileSync(path, addMathIntegration(merged.stdout));
  } finally {
    NodeFS.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const channel = process.argv[2];
  selectUpstreamTag([], channel);
  if (requireGit("status", "--porcelain").trim()) throw new Error("请在干净的临时检出中合并上游");
  if (git("rev-parse", "--verify", "MERGE_HEAD").status === 0) throw new Error("已有未完成的合并");
  if (git("remote", "get-url", "upstream").status !== 0) {
    requireGit("remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git");
  }
  requireGit("fetch", "upstream", "--quiet", "refs/tags/v*:refs/tags/upstream/v*");
  const tags = requireGit("for-each-ref", "--format=%(refname:strip=3)", "refs/tags/upstream/v*")
    .trim()
    .split("\n");
  const tag = selectUpstreamTag(tags, channel);
  if (!tag) {
    if (channel === "stable") throw new Error("未找到上游正式版本标签");
    console.log("上游尚未发布 preview");
    report({ pending: false });
    process.exit(0);
  }
  const sha = requireGit("rev-parse", `refs/tags/upstream/${tag}^{commit}`).trim();
  const base = requireGit("rev-parse", "HEAD").trim();
  console.log(`检查 ${channel}：${tag} (${sha})，基线 ${base}`);
  report({ tag, sha, base });
  const ancestor = git("merge-base", "--is-ancestor", sha, "HEAD");
  if (ancestor.status === 0) {
    console.log(`${tag} 已合并`);
    report({ pending: false });
    process.exit(0);
  }
  if (ancestor.status !== 1) throw new Error(ancestor.stderr || "无法检查上游版本关系");
  const merge = git("merge", "--no-commit", "--no-ff", sha);
  if (merge.status !== 0) {
    const conflicts = requireGit("diff", "--name-only", "--diff-filter=U")
      .trim()
      .split("\n")
      .filter(Boolean);
    const allowed = new Set([
      "apps/web/package.json",
      "apps/web/src/components/ChatMarkdown.tsx",
      "pnpm-lock.yaml",
    ]);
    const unknown = conflicts.filter((path) => !allowed.has(path));
    if (!conflicts.length || unknown.length)
      throw new Error(`无法自动处理的上游冲突：\n${unknown.join("\n") || merge.stderr}`);
    for (const path of conflicts) {
      if (path === "pnpm-lock.yaml") {
        requireGit("checkout", sha, "--", path);
      } else if (path.endsWith("package.json")) {
        const versions = [1, 2, 3].map((stage) =>
          JSON.parse(requireGit("show", `:${stage}:${path}`)),
        );
        NodeFS.writeFileSync(path, `${JSON.stringify(mergePackageJson(...versions), null, 2)}\n`);
      } else {
        resolveMarkdown(path);
      }
      requireGit("add", "--", path);
      console.log(`已自动处理 ${path}`);
    }
  }
  console.log(`已准备 ${tag}，必须重建锁文件并通过测试后才能提交`);
  report({ pending: true });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
