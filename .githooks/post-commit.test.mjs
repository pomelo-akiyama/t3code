import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

function fixture(t) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-auto-push-test-"));
  t.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
  const remote = NodePath.join(root, "remote.git");
  const local = NodePath.join(root, "local");
  function git(cwd, ...args) {
    const result = NodeChildProcess.spawnSync("git", args, { cwd, encoding: "utf8" });
    NodeAssert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(root, "init", "--bare", "-qb", "main", remote);
  git(root, "init", "-qb", "main", local);
  git(local, "config", "user.name", "test");
  git(local, "config", "user.email", "test@example.com");
  git(local, "config", "commit.gpgsign", "false");
  git(local, "remote", "add", "origin", remote);
  const hooks = NodePath.join(root, "hooks");
  NodeFS.mkdirSync(hooks);
  NodeFS.copyFileSync(
    new URL("./post-commit", import.meta.url),
    NodePath.join(hooks, "post-commit"),
  );
  NodeFS.chmodSync(NodePath.join(hooks, "post-commit"), 0o755);
  git(local, "config", "core.hooksPath", hooks);
  function commit(message) {
    NodeFS.writeFileSync(NodePath.join(local, "change.txt"), `${message}\n`);
    git(local, "add", "change.txt");
    const result = NodeChildProcess.spawnSync("git", ["commit", "-qm", message], {
      cwd: local,
      encoding: "utf8",
    });
    NodeAssert.equal(result.status, 0, result.stderr);
    return result;
  }
  commit("initial");
  return { remote, local, git, commit };
}

NodeTest.test("提交自动推送主分支和新分支，不附带本地标签", (t) => {
  const { remote, local, git, commit } = fixture(t);
  NodeAssert.equal(git(remote, "rev-parse", "main"), git(local, "rev-parse", "HEAD"));
  git(local, "-c", "tag.gpgsign=false", "tag", "-am", "local tag", "local-only");
  git(local, "config", "push.followTags", "true");
  git(local, "checkout", "-qb", "codex/example");
  const main = git(remote, "rev-parse", "main");
  commit("feature");
  NodeAssert.equal(git(remote, "rev-parse", "codex/example"), git(local, "rev-parse", "HEAD"));
  NodeAssert.equal(git(remote, "rev-parse", "main"), main);
  NodeAssert.equal(git(remote, "tag"), "");
});

NodeTest.test("推送被拒绝时保留本地提交和远端提交并报告错误", (t) => {
  const { remote, local, git, commit } = fixture(t);
  const before = git(remote, "rev-parse", "main");
  const tree = git(local, "rev-parse", "HEAD^{tree}");
  const divergent = git(local, "commit-tree", tree, "-p", before, "-m", "remote change");
  git(local, "push", "origin", `${divergent}:refs/heads/main`);
  const result = commit("local change");
  NodeAssert.match(result.stderr, /本地提交已保存，但自动推送 origin\/main 失败/);
  NodeAssert.equal(git(remote, "rev-parse", "main"), divergent);
  NodeAssert.notEqual(git(local, "rev-parse", "HEAD"), before);
  NodeAssert.equal(git(local, "log", "-1", "--format=%s"), "local change");
  NodeAssert.equal(git(local, "status", "--porcelain"), "");
});

NodeTest.test("游离 HEAD 的提交不会推送", (t) => {
  const { remote, local, git, commit } = fixture(t);
  const before = git(remote, "rev-parse", "main");
  git(local, "checkout", "--detach", "-q");
  commit("detached");
  NodeAssert.equal(git(remote, "rev-parse", "main"), before);
  NodeAssert.notEqual(git(local, "rev-parse", "HEAD"), before);
});
