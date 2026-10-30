# dsh-plan-execute 开发指南 / Development guide

## 项目边界 / Scope

- 本仓库是 DSH 计划审核扩展：Host 入口在 [`src/index.ts`](<src/index.ts>)，Web client 在 [`src/client/index.tsx`](<src/client/index.tsx>)；面向使用者的说明见 [`README.md`](README.md)。
- The Host entry is [`src/index.ts`](<src/index.ts>); the Web client is [`src/client/index.tsx`](<src/client/index.tsx>). User-facing behavior is documented in [`README.md`](README.md).
- 首版目标是 DSH `0.2.1-rc.5`。不要把依赖范围扩到其他 Host 版本，除非逐项核对并测试相应 API。
- The first version targets DSH `0.2.1-rc.5`. Do not widen Host compatibility without checking and testing the consumed APIs.

## 关键集成约定 / Integration contracts

- 通过 `user-questions/request` waterfall 包装原生 `plan-review`；必须调用并等待 `next()`，不要替换原生批准 UI 或绕过计划工具。
- The `user-questions/request` waterfall wraps native `plan-review`; always await `next()`. Do not replace the native approval UI or bypass the plan tool.
- 只有答案结构严格匹配唯一批准选项时才能执行副作用；取消、拒绝、过期身份、取消信号或校验错误必须失败关闭。
- Side effects require the exact single-item approval answer. Cancellation, decline, stale identity, abort signals, and validation errors must fail closed.
- [`src/range.ts`](<src/range.ts>) 使用 Compaction 的工具配对平衡 helper。压缩只能覆盖待批准工具批次之前的安全前缀；不要把计划或未完成工具调用纳入范围，也不要在压缩失败时静默继续。
- [`src/range.ts`](<src/range.ts>) uses Compaction's tool-pairing helpers. Compact only a safe prefix before the pending approval batch; never include the plan or unfinished tool call, and never silently continue after compaction failure.
- 修改 Typert endpoint、wire schema 或 type symbol 时，同时核对 [`src/typert.ts`](<src/typert.ts>) 与 [`src/client/index.tsx`](<src/client/index.tsx>) 的 client contribution，保持 Host/client 描述符一致。
- When changing Typert endpoints, wire schemas, or type symbols, update and cross-check both [`src/typert.ts`](<src/typert.ts>) and the client contribution in [`src/client/index.tsx`](<src/client/index.tsx>).
- 客户端调用 `ctx.remote.session`（例如 `modelCatalog()`）时，`inject` 必须显式包含 `'remote.session'`；只声明 `'remote'` 会在 Cordis 中失败。
- The client must declare `'remote.session'` in `inject` when calling `ctx.remote.session` (for example `modelCatalog()`); declaring only `'remote'` fails in Cordis.
- 自定义模型经 `sessionController.selectModel()` 设置；该公开 API 会异步尝试保存 Host 默认模型，失败只记日志。保持 UI 提示准确，不要增加隐式恢复或静默修改默认值的逻辑。思考等级必须来自模型目录，只有显式选择才传递 `reasoningEffort`。
- Custom models use `sessionController.selectModel()`, which asynchronously attempts to save the Host default (failures are only logged). Keep the UI disclosure accurate; do not add hidden restoration or default changes. Reasoning effort must come from the catalog, and `reasoningEffort` is sent only after an explicit choice.
- 执行选项面板使用 `react-dom` portal 挂载到 `document.body`，以逃离原生审批卡片的 `overflow:hidden`；不要用提高 z-index 或修改 DSH 生成样式代替 portal。面板必须受视口约束、可内部滚动，并在关闭时恢复触发按钮焦点。
- The options panel mounts through a `react-dom` portal on `document.body` to escape the native approval card's `overflow:hidden`; do not replace the portal with a higher z-index or edits to DSH-generated styles. Keep it viewport-clamped, internally scrollable, and restore trigger focus on close.
- 客户端必须轮询所有非终态阶段（`staged`、`validating`、`compacting`、`selecting-model`），只在 `released`、`failed`、`cancelled` 停止；查询需串行并忽略已卸载或已切换审核的响应。
- The client must poll every non-terminal phase (`staged`, `validating`, `compacting`, `selecting-model`) and stop only on `released`, `failed`, or `cancelled`; requests stay serial and responses from an unmounted or replaced review are ignored.
- 暂存/进度目前是进程内状态；不要假设重启后会恢复。任何持久化改动都要另行设计兼容的数据契约。
- Staging and progress are process-local; do not assume restart recovery. Any persistence change needs a separately designed compatible data contract.

## 构建与验收 / Build and verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm verify
pnpm package:check
pnpm release:pack
```

- `pnpm verify` 顺序为 typecheck → build → Vitest → `package:check`，**不包含** Playwright；包检查依赖先构建出的 [`lib/client.js`](<lib/client.js>)。浏览器回归必须显式运行 `pnpm test:browser`，CI 与 Release 会单独执行该命令。[`scripts/check-package.mjs`](<scripts/check-package.mjs>) 会实际打包、解包并核对入口、LICENSE/README 与禁止泄漏的文件。
- `pnpm verify` runs typecheck → build → Vitest → `package:check` and **excludes** Playwright; package inspection requires the preceding build output [`lib/client.js`](<lib/client.js>). The browser regression must run explicitly through `pnpm test:browser`; CI and Release run that command separately. [`scripts/check-package.mjs`](<scripts/check-package.mjs>) creates and extracts a real tarball, then checks entry points, LICENSE/README, and forbidden files.
- `pnpm test` 覆盖单元、真实 Cordis 构造/生命周期、真实 RC5 Session + Compaction 配对、完整审批场景，以及 jsdom 客户端行为；`pnpm test:browser` 先用 esbuild 打包 [`test/browser/fixture.tsx`](<test/browser/fixture.tsx>)，再由 Playwright 在 Chromium 中验证裁剪、视口与滚动。首次运行需 `pnpm exec playwright install --only-shell chromium`；完整 Chromium 不是必需。CI 使用 `--only-shell --with-deps` 安装。缺浏览器时必须显式失败，不要静默跳过。
- `pnpm test` covers units, the real Cordis constructor/lifecycle, real RC5 Session + Compaction pairing, a full approval scenario, and jsdom client behavior; `pnpm test:browser` bundles [`test/browser/fixture.tsx`](<test/browser/fixture.tsx>) with esbuild, then uses Playwright in Chromium to verify clipping, viewport bounds, and scrolling. Run `pnpm exec playwright install --only-shell chromium` once locally; full Chromium is unnecessary. CI installs the headless shell with system dependencies. A missing browser must fail loudly, never silently skip.
- Playwright fixture 使用模拟 remote 和真实组件，只证明布局与交互；它不加载完整 DSH Host，也不能替代真实 GUI、正式摘要后端或真实模型调用。
- The Playwright fixture uses a simulated remote with the real component; it proves layout and interaction only. It does not load a full DSH Host and does not replace live GUI, the production summarizer, or real model calls.
- [`package.json`](<package.json>) 中的 `release:pack` script 调用 [`scripts/create-release-package.mjs`](<scripts/create-release-package.mjs>)，在忽略的 `.release/` 下创建一个 `.tgz` 和匹配的 `.sha256`，并本地验证摘要/文件名；Release CI 在创建 draft 前还会运行 `sha256sum -c`。`release:pack` 需要先构建，缺少 `lib/` 入口时会明确失败。
- The `release:pack` script in [`package.json`](<package.json>) calls [`scripts/create-release-package.mjs`](<scripts/create-release-package.mjs>) to create one `.tgz` and matching `.sha256` under ignored `.release/`, then verifies digest/basename locally. Release CI also runs `sha256sum -c` before creating a draft. `release:pack` requires a prior build and fails loudly when the `lib/` entry points are missing.
- 自动化测试、浏览器 fixture 和 tarball 检查不代表真实 DSH Web GUI 已验证。`lib/` 是生成产物并被 [`.gitignore`](<.gitignore>) 忽略；[`package.json`](<package.json>) 的 `files` 控制 tarball 内容，勿把 maintainer scripts 或 [`AGENTS.md`](<AGENTS.md>) 打进包。
- Automated tests and tarball inspection are not live DSH GUI validation. `lib/` is generated and ignored by [`.gitignore`](<.gitignore>); [`package.json`](<package.json>)'s `files` controls the tarball, and maintainer scripts / [`AGENTS.md`](<AGENTS.md>) must stay out.
- 依赖变更后用 pnpm 更新 [`pnpm-lock.yaml`](<pnpm-lock.yaml>)，并保留 [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>) 中 RC5 依赖所需的精确 release-age 排除项；不要用通配方式关闭供应链策略。
- After dependency changes, update [`pnpm-lock.yaml`](<pnpm-lock.yaml>) with pnpm and preserve the exact release-age exclusions for RC5 dependencies in [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>); do not disable supply-chain policy with broad patterns.

## 公开仓库与发布 / Public repository and releases

- 本仓库以公开 GitHub 仓库发布；[`LICENSE`](<LICENSE>) 使用 MIT，CI 与 tag-driven draft Release 配置在 [`.github/workflows/ci.yml`](<.github/workflows/ci.yml>) 和 [`.github/workflows/release.yml`](<.github/workflows/release.yml>)。
- This repository ships as a public GitHub repository. [`LICENSE`](<LICENSE>) uses MIT; CI and tag-driven draft releases live in [`.github/workflows/ci.yml`](<.github/workflows/ci.yml>) and [`.github/workflows/release.yml`](<.github/workflows/release.yml>).
- [`package.json`](<package.json>) 的 `private: true` 只禁止 npm 发布，是明确选择；不要移除或添加 npm publish 步骤。它不限制 GitHub 仓库可公开，也不限制 GitHub Release tarball。
- `private: true` in [`package.json`](<package.json>) intentionally disables npm publishing. Do not remove it or add npm publish steps; it does not make the GitHub repository private or prevent Release tarballs.
- CI 与 Release 使用 Node 24、pnpm 12.16.1；保持 [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>) 对 RC5 依赖的精确 minimum-release-age exclusions。
- CI and Release use Node 24 and pnpm 12.16.1; preserve the exact RC5 minimum-release-age exclusions in [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>).
- Release 仅由与 [`package.json`](<package.json>) 版本相符的 `v<version>` tag 触发；从 tag 指向的精确 commit 打包，校验摘要，并只创建 draft。发布 draft、配置 remote、推送分支或 tag 都需要单独明确授权。
- Release triggers only on a `v<version>` tag matching [`package.json`](<package.json>), packages that exact tagged commit, verifies the checksum and rechecks the remote tag SHA, then creates a draft only. Publishing the draft, configuring a remote, or pushing a branch/tag requires separate explicit authorization.
- Configure a GitHub ruleset for `v*` tags to prohibit force updates/deletion once the remote exists; workflow checks cannot eliminate the small race after remote SHA verification.
