# Fork 维护说明

本仓库是 [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 的 fork，唯一的自有功能是聊天消息中的数学公式渲染（KaTeX，详见 `docs/user/markdown-math.md`）。其余产品功能跟随上游：不在 fork 中做与公式渲染无关的功能开发，定期把上游 `main` 合并进来。

公开发行版还包含一组应用身份定制，用于让 fork 与官方应用并存：应用名称和图标使用 T3 Code Math。主题、字号等外观偏好不在源码中改动默认值，由用户在设置中自行选择。私有部署资料、个人配置、凭据与签名材料统一存放在根目录的 `.fork-local/`，该目录由一条 `.gitignore` 规则形成单一隐私边界。应用身份定制不扩展产品功能，也需要在上游同步后继续保留。

## 上游贡献状态

截至 2026-08-29，上游维护者已关闭 [#7166](https://github.com/pingdotgg/t3code/pull/7166) 与 [#7739](https://github.com/pingdotgg/t3code/pull/7739)，并明确表示当前不计划在聊天中加入 LaTeX 渲染。[#1784](https://github.com/pingdotgg/t3code/issues/1784) 还记录了维护者对性能成本、解析复杂度及长期语法兼容责任的顾虑。因此，本 fork 暂停准备或提交同类上游 PR，完整公式渲染继续作为 fork 自有功能维护。

只在下列条件之一成立时重新评估：

- 上游维护者明确改变产品方向，或公开邀请边界清晰的数学渲染实现；
- 上游自行合入官方数学渲染。届时优先采用上游实现并退役本 fork 的重叠差异，避免长期维护两套渲染管线。

## 与上游的差异清单

### 公式渲染

新增文件（上游不存在，合并时零冲突风险）：

- `apps/web/src/markdown-math.ts` 与 `markdown-math.test.ts`：分隔符扫描器，零依赖纯函数。
- `apps/web/src/markdown-math-rendering.tsx`：remark-math 插件拼装、KaTeX 组件、流式公式判定与降级边界。
- `apps/web/src/lib/mathRendering.ts`：KaTeX 运行时的异步加载。
- `docs/user/markdown-math.md`：用户文档。

公式渲染修改的共享文件：

- `apps/web/src/components/ChatMarkdown.tsx`：集成点，锚点清单见下文冲突预案。
- `apps/web/src/components/ChatMarkdown.test.tsx`：`ChatMarkdown math rendering` 测试块。
- `apps/web/src/markdown-clipboard.test.ts`：公式复制行为的测试。
- `apps/web/package.json`：新增依赖 `katex` 与 `remark-math`。
- `pnpm-lock.yaml`：由 package.json 派生，冲突时不手工合并（见下文）。
- `.gitignore`：排除临时文件、本机运维资料、凭据与签名材料。

### 应用身份定制

- Web、Desktop、Mobile 和桌面构建脚本中的应用名称统一为 T3 Code Math，相应测试断言使用同一名称。
- `apps/web/public/` 与 `assets/prod/` 使用 fork 图标和品牌资源，侧边栏及启动页显示 fork 品牌。
- `.gitignore` 排除私有部署资料、凭据和签名材料；这些文件不得进入公开提交。

这些文件在上游极少变动，保留成本很低。主题默认值与字号默认值曾经也属于 fork 差异，但它们所在的 `index.html`、`useTheme.ts` 与 `packages/contracts/src/settings.ts` 在上游改动频繁，而对应价值只是省去用户在设置中的两次点击，因此已经退役。

### Fork-local 隐私边界

根目录的 `.fork-local/` 是本机操作材料的唯一存放位置。部署文档与脚本、主机配置、凭据引用、签名材料和本地运维状态按职能放入该目录的子目录。平台托管的秘密继续保留在 GitHub Actions Secrets、macOS Keychain 或远端主机的安全存储中；`.fork-local/` 只保存调用配置或引用路径，不复制平台秘密。

公开源码树不使用全局密钥文件通配规则。敏感文件如果被放到 `.fork-local/` 之外，应当出现在 `git status` 中，并由提交边界检查拒绝进入提交。该约定让错误位置立即可见，避免忽略规则掩盖散落的私有材料。

## 定期同步流程

远端约定：`origin` 指向本 fork，`upstream` 指向 `pingdotgg/t3code`。`main` 直接继承上游历史，同步只用本地 `git merge`，不改写历史，不使用 GitHub 网页上的 Sync fork / Update branch 按钮——网页按钮会在远端另造一个合并提交，与本地合并结果分叉，之后还得多拉取合并一次。

同步以上游的正式版本标签为单位（形如 `v0.0.38`，不取 `-nightly` 标签），而非任意一个上游提交。合并时直接按标签名合并，合并提交信息因此天然记录了对应的上游版本；发行说明同样写明所基于的上游标签及其提交 SHA。

每个克隆首次同步前启用一次 `git rerere`，让 git 记住已经解决过的冲突，下次在同一位置再次冲突时自动复用：

```bash
git config rerere.enabled true
git config rerere.autoupdate true
```

同步步骤：

```bash
git fetch upstream --tags
git merge v0.0.38   # 换成最新的上游正式标签
vp i
vp test run apps/web/src/markdown-math.test.ts apps/web/src/components/ChatMarkdown.test.tsx apps/web/src/markdown-clipboard.test.ts
vp test run apps/web/src/branding.test.ts apps/desktop/src/app/DesktopAppIdentity.test.ts scripts/build-desktop-artifact.test.ts
vp run --filter @t3tools/web --filter @t3tools/desktop --filter @t3tools/mobile --filter @t3tools/scripts typecheck
git push origin main
```

验收标准：上述定向测试与包级类型检查全部通过，即认为公式渲染和应用身份定制在合并后完好；此外可随手发一条含 `\(x^2\)`、`$$...$$` 与 ```math fence 的消息目验一次。

### 自动干跑检查

`.github/workflows/upstream-merge-check.yml` 每天在临时检出中把最新的上游正式标签合并进 `main`，按下文冲突预案处理 `pnpm-lock.yaml`，然后运行上面同一组定向测试和类型检查。检查通过时不产生任何输出；合并冲突或测试失败时，工作流会创建或追加一条标题以 `Upstream merge check failed` 开头的 issue，列出冲突文件或失败步骤。真正的合并与推送仍由人手动完成，合并完成后关闭对应 issue。该工作流依赖仓库启用 GitHub Actions。

## 冲突预案

按文件类型处理：

- **`pnpm-lock.yaml`**：一律取上游版本再重装，锁文件会根据合并后的 package.json 自动补回我们的依赖：

  ```bash
  git checkout upstream/main -- pnpm-lock.yaml
  vp i
  git add pnpm-lock.yaml
  ```

- **`apps/web/package.json`**：取双方依赖的并集（保留上游新增，同时保住 `katex` 与 `remark-math`）。
- **测试文件**：我们的改动是自成一体的 `describe` 块与用例，与上游改动做并集即可。`ChatMarkdown.test.tsx` 顶部的具名导入也取并集：保留 `getMathRuntimePromise`，同时保留上游为文件芯片新增的 `canUseMarkdownFileShellActions` / `hasMarkdownFilePrimaryAction` / `shouldUseMarkdownFileBrowserPrimaryAction`。
- **`ChatMarkdown.tsx`**：公式实现集中在 `markdown-math-rendering.tsx`，共享文件只保留下列接入锚点。以上游版本为基底，按名称重放接入点，不要依赖行号：
  1. 顶部导入 `analyzeMathMarkdown`，以及 `MathMarkdown`、`renderDisplayMath`、`renderInlineMath` 和 `MathRemarkPluginSegments`。
  2. remark 插件数组拆成 `BEFORE_MATH` 与 `AFTER_MATH` 两段；基础渲染器直接拼接两段，公式渲染器在两段之间插入 `remark-math`。`remarkPreserveCodeMeta` 与 `remarkNormalizeLinksAndTagInlineCode` 必须位于 `AFTER_MATH`。
  3. `ChatMarkdown` 函数体内保留 `mathAnalysis` useMemo 与 `openMathFenceTail` 取值。
  4. `code` 覆盖器先调用 `renderInlineMath`，再查找内联代码文件芯片，避免把 `language-math` 当成普通 inline code。
  5. `pre` 覆盖器先调用 `renderDisplayMath`。该调用返回空值时继续使用代码块路径，因此流式尾部在闭合前维持源码显示。
  6. `markdownComponents` useMemo 依赖数组保留 `openMathFenceTail`。组件返回处使用 `MathMarkdown` 包装基础渲染结果，并把同一份 `markdownComponents` 传给公式渲染器。

极端情形：若上游重构了 ChatMarkdown 或整个 markdown 渲染管线，导致上述锚点无处安放，则以 `markdown-math.ts` 的导出接口（`analyzeMathMarkdown` 返回 `hasDelimiterMath` / `normalizedText` / `openMathFenceTail`）为不变量，在新管线中重新接线；扫描器与测试文件本身不依赖任何 UI 代码，可原样保留。若上游将来自带了公式渲染，优先评估直接采用上游实现并退役本 fork 的差异。
