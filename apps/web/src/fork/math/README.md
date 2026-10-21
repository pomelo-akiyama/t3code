# 浏览器聊天公式

浏览器和桌面端聊天支持三种公式分隔符。`\(...\)` 渲染为行内公式，`\[...\]` 和 `$$...$$` 渲染为行间公式。单行 `$$...$$` 也按行间公式渲染。单美元符号和 `math` 代码块保持普通 Markdown 行为。流式回复中的未闭合公式显示原文。

## 接入方式

上游源码只改一行：`ChatMarkdown.tsx` 从 `../fork/math/ReactMarkdown` 导入 `ReactMarkdown`。这个包装组件和 react-markdown 用法相同，另外做两件事：

- 在上游 remark 插件之后追加 `remarkForkMath`。它接管解析器，先用 `scan.ts` 把公式替换成等长占位符再解析，链接、指令和任务列表仍对应原文偏移量。上游插件转换完成后，占位符还原为 `language-fork-math-*` 代码节点，这个类名能通过上游的 HTML 清理。
- 包装 `code` 组件，公式交给 KaTeX，其他代码原样交回上游渲染器。KaTeX 在消息首次出现完整公式时才加载。

上游如果不再使用 react-markdown，或改动 `code` 节点的渲染方式，自动合并会在冲突、类型检查或测试阶段停止，不会静默丢失公式渲染。

## MacBook 共用官方后端

`scripts/fork-math-launcher.sh` 提供启动、停止、更新和配对菜单，桌面的 `T3 Code 公式版.command` 调用它。先打开官方 T3 Code，再启动公式网页，访问 `http://127.0.0.1:3774/`；首次使用一个浏览器时选择“首次配对 / 重新连接官方 T3”。

`scripts/fork-math-browser.mjs` 使用 Vite preview 提供已构建的网页，将 `/api`、`/oauth`、`/.well-known` 和 `/ws` 转发到官方 `127.0.0.1:3773`。只监听本机，保留原 Host 和 Origin，认证由官方后端处理。聊天、项目、Provider 和终端共用官方运行状态；浏览器偏好和远程环境连接列表仍属于各客户端。

更新只构建 Web，按官方后端报告的版本设置 `APP_VERSION`，并检查对应 stable 标签的服务端和共享包与 fork 一致。fork 尚未包含该标签时，用 `gh` 立即触发下文的自动合并工作流，等它推送后拉取再构建，不必等每日定时运行；合并失败或 fork 已跟进更新的上游版本时停止更新。启动时也检查构建版本。停止公式网页不会停止官方后端，官方桌面退出后网页无法工作。

旧独立实例的 `~/.t3-math-browser` 保留，不再由该启动器使用，也不自动迁移或合并旧会话。启动器的 PID 与日志留在 `~/Library/Application Support/T3 Code Math Launcher/`，配对凭据不写入文件。

## 自动合并

本 fork 以最新 stable 为代码基线。`.github/workflows/fork-math-upstream.yml` 每天合并版本号最高的 stable 标签，排除 preview、nightly 和其他预发布版本。冲突只出现在 `apps/web/package.json` 或 `pnpm-lock.yaml` 时取上游版本，重新加入 katex 依赖并重建锁文件；其他冲突需要人工处理。通过公式与聊天 Markdown 测试、Web 类型检查和构建后才推送。已经包含的版本会跳过，验证期间主分支有新提交时会停止推送，下次重新验证。

远端推送使用仅对本仓库生效的可写 deploy key，私钥保存在 Actions secret `UPSTREAM_SYNC_SSH_KEY`。普通 `GITHUB_TOKEN` 无法覆盖同步上游工作流文件所需的权限。

## 提交后自动推送

本地检出可用 `git config --local core.hooksPath .githooks` 启用提交后自动推送。每次提交成功后，当前分支推送到 `origin` 的同名分支，游离 HEAD 不推送。推送失败会报告错误并保留本地提交，远端有新提交时需要先整合再重试，不会强制覆盖。用 `git config --local --unset core.hooksPath` 关闭。修改钩子后用 `node --test .githooks/post-commit.test.mjs` 验证。
