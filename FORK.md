# Fork 维护说明

本仓库是 [pingdotgg/t3code](https://github.com/pingdotgg/t3code) 的 fork，唯一的自有功能是聊天消息中的数学公式渲染（KaTeX，详见 `docs/user/markdown-math.md`）。其余产品功能跟随上游：不在 fork 中做与公式渲染无关的功能开发，定期把上游 `main` 合并进来。

公开发行版还包含一组配套定制，用于让 fork 与官方应用并存并提供一致的开箱体验：应用名称和图标使用 T3 Code Math，默认使用 Ember 浅色主题，界面与代码字号分别默认为 18 和 15，并通过 `.gitignore` 排除私有部署资料、凭据与签名材料。这些配套定制不扩展产品功能，也需要在上游同步后继续保留。

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

### 公开发行配套定制

- Web、Desktop、Mobile 和桌面构建脚本中的应用名称统一为 T3 Code Math，相应测试断言使用同一名称。
- `apps/web/public/` 与 `assets/prod/` 使用 fork 图标和品牌资源，侧边栏及启动页显示 fork 品牌。
- Web 首次启动默认使用 Ember 浅色主题；已有合法主题选择仍然优先。
- `packages/contracts/src/settings.ts` 将界面与代码字号默认值设为 18 和 15，并由契约测试固定。
- `.gitignore` 排除私有部署资料、凭据和签名材料；这些文件不得进入公开提交。

## 定期同步流程

远端约定：`origin` 指向本 fork，`upstream` 指向 `pingdotgg/t3code`。`main` 直接继承上游历史，同步只用本地 `git merge`，不改写历史，不使用 GitHub 网页上的 Sync fork / Update branch 按钮——网页按钮会在远端另造一个合并提交，与本地合并结果分叉，之后还得多拉取合并一次。

```bash
git fetch upstream
git merge upstream/main
vp i
vp test run apps/web/src/markdown-math.test.ts apps/web/src/components/ChatMarkdown.test.tsx apps/web/src/markdown-clipboard.test.ts
vp test run apps/web/src/branding.test.ts apps/web/src/hooks/useTheme.test.ts apps/web/src/themeBoot.test.ts
vp test run apps/desktop/src/app/DesktopAppIdentity.test.ts packages/contracts/src/settings.test.ts scripts/build-desktop-artifact.test.ts
vp run --filter @t3tools/web --filter @t3tools/desktop --filter @t3tools/mobile --filter @t3tools/contracts --filter @t3tools/scripts typecheck
git push origin main
```

验收标准：上述定向测试与包级类型检查全部通过，即认为公式渲染和发行配套定制在合并后完好；此外可随手发一条含 `\(x^2\)`、`$$...$$` 与 ```math fence 的消息目验一次。

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
