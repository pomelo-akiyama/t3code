#!/bin/bash
set -u
umask 077

FORK_ROOT="$HOME/Projects/t3code"
FORK_SERVER="$FORK_ROOT/scripts/fork-math-browser.mjs"
FORK_STATE_DIR="$HOME/Library/Application Support/T3 Code Math Launcher"
FORK_PID_FILE="$FORK_STATE_DIR/web.pid"
FORK_LOG_FILE="$FORK_STATE_DIR/web.log"
FORK_BUILD_FILE="$FORK_ROOT/apps/web/dist/math-build.json"
FORK_URL="http://127.0.0.1:3774"
OFFICIAL_NAME="T3 Code (Beta)"
OFFICIAL_APP="/Applications/$OFFICIAL_NAME.app"
export PATH="$FORK_ROOT/node_modules/.bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p "$FORK_STATE_DIR"

process_start_time() {
  LC_ALL=C ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

running_pid() {
  local pid recorded_start actual_start command_line
  [[ -s "$FORK_PID_FILE" ]] || return 1
  IFS='|' read -r pid recorded_start < "$FORK_PID_FILE"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  actual_start="$(process_start_time "$pid")"
  command_line="$(ps -ww -p "$pid" -o command= 2>/dev/null)"
  [[ -n "$actual_start" && "$actual_start" == "$recorded_start" ]] || return 1
  [[ "$command_line" == *"$FORK_SERVER"* ]] || return 1
  printf '%s\n' "$pid"
}

official_version() {
  node --input-type=module -e '
    try {
      const r = await fetch("http://127.0.0.1:3773/.well-known/t3/environment", {signal: AbortSignal.timeout(5000)});
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (!/^\d+\.\d+\.\d+$/.test(d.serverVersion)) throw new Error();
      console.log(d.serverVersion);
    } catch { console.error("请先打开官方 T3 Code，并确认本地环境运行在 3773 端口。"); process.exit(1); }
  '
}

check_build() {
  local version
  version="$(official_version)" || return 1
  node - "$FORK_BUILD_FILE" "$version" <<'NODE'
try {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = process.argv[2];
  const build = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (build.version !== process.argv[3] || !fs.existsSync(path.join(path.dirname(file), 'index.html'))) throw new Error();
} catch { console.error('公式网页尚未构建或与官方版本不匹配，请先选择“更新”。'); process.exit(1); }
NODE
}

show_status() {
  local pid
  if pid="$(running_pid)"; then
    printf '公式网页运行中，PID %s，地址 %s/\n' "$pid" "$FORK_URL"
  else
    printf '公式网页未运行。\n'
  fi
  printf '共用官方 T3 后端：http://127.0.0.1:3773/\n'
}

start_server() {
  local pid started attempt
  check_build || return 1
  if pid="$(running_pid)"; then
    printf '公式网页已在运行：%s/\n' "$FORK_URL"
    return 0
  fi
  if lsof -nP -iTCP:3774 -sTCP:LISTEN >/dev/null 2>&1; then
    printf '端口 3774 已被占用，未启动公式网页。\n' >&2
    return 1
  fi
  cd "$FORK_ROOT" || return 1
  pid="$(node - "$FORK_SERVER" "$FORK_LOG_FILE" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const log = fs.openSync(process.argv[3], 'w', 0o600);
const child = spawn(process.execPath, [process.argv[2]], {detached: true, stdio: ['ignore', log, log]});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('spawn', () => { console.log(child.pid); child.unref(); });
fs.closeSync(log);
NODE
)" || return 1
  started="$(process_start_time "$pid")"
  [[ -n "$started" ]] || return 1
  printf '%s|%s\n' "$pid" "$started" > "$FORK_PID_FILE"
  for ((attempt=0; attempt<40; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      tail -n 15 "$FORK_LOG_FILE" >&2
      return 1
    fi
    if lsof -nP -a -p "$pid" -iTCP:3774 -sTCP:LISTEN >/dev/null 2>&1; then
      printf '公式网页已启动：%s/\n' "$FORK_URL"
      return 0
    fi
    sleep 0.25
  done
  printf '启动超时，请查看 %s\n' "$FORK_LOG_FILE" >&2
  return 1
}

stop_server() {
  local pid attempt
  if ! pid="$(running_pid)"; then
    printf '公式网页未运行。\n'
    return 0
  fi
  kill -TERM "$pid" || return 1
  for ((attempt=0; attempt<40; attempt++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      : > "$FORK_PID_FILE"
      printf '公式网页已停止，官方 T3 继续运行。\n'
      return 0
    fi
    sleep 0.25
  done
  printf '网页进程尚未退出，请查看日志。\n' >&2
  return 1
}

update_server() {
  local version ref was_running=0
  [[ "$(git -C "$FORK_ROOT" branch --show-current)" == main ]] || { printf '请先切回 main 分支。\n' >&2; return 1; }
  [[ -z "$(git -C "$FORK_ROOT" status --porcelain)" ]] || { printf '仓库有未提交修改，已停止更新。\n' >&2; return 1; }
  git -C "$FORK_ROOT" fetch origin main || return 1
  git -C "$FORK_ROOT" merge --ff-only origin/main || return 1
  version="$(official_version)" || return 1
  ref="refs/tags/v$version"
  git -C "$FORK_ROOT" rev-parse --verify "$ref" >/dev/null 2>&1 ||
    git -C "$FORK_ROOT" fetch upstream "refs/tags/v$version:refs/tags/v$version" || return 1
  # Backend and contracts must match the installed release, not merely a
  # package.json version that upstream leaves unchanged between releases.
  if ! git -C "$FORK_ROOT" diff --quiet "$ref" HEAD -- apps/server packages; then
    printf 'fork 与官方 %s 的后端或协议源码不同，已停止构建。请先对齐版本。\n' "$version" >&2
    return 1
  fi
  (cd "$FORK_ROOT" && vp install --frozen-lockfile) || return 1
  if running_pid >/dev/null; then was_running=1; stop_server || return 1; fi
  rm -f "$FORK_BUILD_FILE"
  printf '正在构建与官方 %s 配套的公式网页…\n' "$version"
  (cd "$FORK_ROOT" && APP_VERSION="$version" T3CODE_SINGLE_ORIGIN_DEV=1 vp run --filter @t3tools/web build) || return 1
  node - "$FORK_BUILD_FILE" "$version" "$(git -C "$FORK_ROOT" rev-parse HEAD)" <<'NODE'
require('node:fs').writeFileSync(process.argv[2], JSON.stringify({version: process.argv[3], commit: process.argv[4]}) + '\n');
NODE
  if [[ "$was_running" -eq 1 ]]; then start_server || return 1; fi
  printf '公式网页更新完成。\n'
}

pair_browser() {
  start_server || return 1
  # Use the installed official CLI to mint a short-lived pairing link.
  # Keep credentials out of logs and the launcher state directory.
  ELECTRON_RUN_AS_NODE=1 "$OFFICIAL_APP/Contents/MacOS/$OFFICIAL_NAME" \
    "$OFFICIAL_APP/Contents/Resources/app.asar/apps/server/dist/bin.mjs" \
    auth pairing create --base-dir "$HOME/.t3" --ttl 5m \
    --label 'MacBook 公式网页' --base-url "$FORK_URL" --json |
    node -e 'let s=""; process.stdin.on("data", d => s+=d); process.stdin.on("end", () => { try { const u=JSON.parse(s).pairUrl; if (!u) throw new Error(); require("node:child_process").execFileSync("/usr/bin/open", [u]); } catch { console.error("配对失败，请确认官方 T3 正在运行。"); process.exit(1); } });'
}

# 等启动器退出后，按 TTY 关闭它自己的终端；不依赖当前前台窗口。
close_launcher_terminal() {
  local launcher_tty
  [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" && -t 0 ]] || return 0
  launcher_tty="$(tty)" || return 0
  nohup osascript - "$launcher_tty" "$$" > "$FORK_STATE_DIR/terminal-close.log" 2>&1 <<'APPLESCRIPT' &
on run argv
  set launcherTTY to item 1 of argv
  set launcherPID to item 2 of argv
  repeat
    try
      do shell script "/bin/kill -0 " & quoted form of launcherPID
    on error
      exit repeat
    end try
    delay 0.1
  end repeat
  tell application "Terminal"
    repeat with launcherWindow in windows
      repeat with launcherTab in tabs of launcherWindow
        if tty of launcherTab is launcherTTY then
          if (count of tabs of launcherWindow) is 1 then
            close launcherWindow saving no
          else
            close launcherTab saving no
          end if
          return
        end if
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
}

run_action() {
  case "${1:-}" in
    start) start_server ;;
    open|1) start_server && open "$FORK_URL/" ;;
    stop|2) stop_server ;;
    update|3) update_server ;;
    pair|4) pair_browser ;;
    status) show_status ;;
    *) printf '未知操作：%s\n' "$1" >&2; return 1 ;;
  esac
}

if [[ $# -gt 0 ]]; then run_action "$1"; exit $?; fi
printf '\033]0;T3 Code 公式版启动器\007'
while true; do
  printf '\nT3 Code 公式版（共用官方后端）\n'
  show_status
  printf '\n1. 启动并打开\n2. 停止公式网页\n3. 更新公式网页\n4. 首次配对 / 重新连接官方 T3\n5. 退出\n\n'
  read -r -p '请选择 1–5：' choice || exit 0
  case "$choice" in
    1|2|3|4) run_action "$choice" ;;
    5) close_launcher_terminal; exit 0 ;;
    *) printf '请输入 1–5。\n' ;;
  esac
  read -r -p '按回车返回菜单…' _ || exit 0
done
