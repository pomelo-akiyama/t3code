import * as FS from "node:fs";
import * as NodeChildProcess from "node:child_process";

function git(...args) {
  const result = NodeChildProcess.spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function requireGit(...args) {
  const result = git(...args);
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} 执行失败`);
  }
  return result.stdout.trim();
}

function reportPending(pending) {
  if (process.env.GITHUB_OUTPUT) {
    FS.appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending}\n`);
  }
}

try {
  if (git("remote", "get-url", "upstream").status !== 0) {
    requireGit("remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git");
  }
  requireGit("fetch", "upstream", "--quiet", "refs/tags/v*:refs/tags/upstream/v*");
  const tag = requireGit("for-each-ref", "--format=%(refname:short)", "refs/tags/upstream/v*")
    .split("\n")
    .filter((name) => name && !name.includes("-nightly"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .at(-1);
  if (!tag) throw new Error("未找到上游正式版本标签");
  const sha = requireGit("rev-parse", `${tag}^{commit}`);
  const ancestor = git("merge-base", "--is-ancestor", sha, "HEAD");
  if (ancestor.status === 0) {
    console.log(`${tag} 已合并`);
    reportPending(false);
    process.exit(0);
  }
  if (ancestor.status !== 1) throw new Error(ancestor.stderr || "无法检查上游版本关系");

  requireGit("config", "user.name", "browser-math-check");
  requireGit("config", "user.email", "browser-math-check@users.noreply.github.com");
  const merge = git("merge", "--no-commit", "--no-ff", sha);
  if (merge.status !== 0) {
    const conflicts = requireGit("diff", "--name-only", "--diff-filter=U");
    if (conflicts !== "pnpm-lock.yaml") {
      throw new Error(`无法自动处理的上游冲突：\n${conflicts || merge.stderr}`);
    }
    requireGit("checkout", sha, "--", "pnpm-lock.yaml");
    requireGit("add", "pnpm-lock.yaml");
  }
  console.log(`已试合并 ${tag} (${sha})`);
  reportPending(true);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
