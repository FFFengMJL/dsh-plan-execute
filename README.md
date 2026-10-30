# dsh-plan-execute

[![CI](https://github.com/FFFengMJL/dsh-plan-execute/actions/workflows/ci.yml/badge.svg)](https://github.com/FFFengMJL/dsh-plan-execute/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/FFFengMJL/dsh-plan-execute)](https://github.com/FFFengMJL/dsh-plan-execute/releases)

同一 DSH 会话中的计划审批与执行选项扩展。它保留原生计划预览和批准流程，并在计划审核动作区提供模型选择、思考等级，以及“保留上下文”或“压缩较早历史后执行”选项。

A same-Session plan approval and execution-options extension for DSH. It preserves the native plan preview and approval flow, adding model selection, reasoning effort, and a choice to keep context unchanged or compact earlier history before execution.

## 功能与安全边界 | Features and safety

- 只处理带有原生 `plan-review` intent 的单题审核；实际执行仍由原生批准选项决定。
- Host 只有在暂存设置后收到唯一、精确的批准答案时才继续准备；拒绝、取消、过期请求或校验失败都不会由插件放行。未暂存设置时保留 DSH 原生批准行为。
- 压缩通过当前 Agent 的 `compactRegion()` 执行，只选择待批准工具批次之前、工具配对平衡的历史前缀。若没有满足阈值的安全范围，操作会失败关闭，不会静默改为不压缩。
- 压缩结果会核对 `shadowedSeqs`，并确认待批准批次仍在活动 surface 上。最终计划和待处理的审批工具批次不应被所选范围覆盖。
- 执行模型及其思考等级来自 Host 的模型目录；插件不硬编码模型能力。目录加载中、空目录、部分 provider 失败、请求失败和超时都有独立状态，可重试，失败时不阻止“沿用当前模型”。
- 思考等级按模型记忆在当前审核表单内；只有用户显式选择时才提交 `reasoningEffort`，“使用模型默认值”表示省略该字段。切换回某模型时，仅当该档位仍受最新目录支持才恢复。
- 执行选项面板通过 portal 挂载到页面浮层，不修改原生审批卡片样式；面板受视口约束并可在内部滚动，支持关闭按钮、Escape、外部点击关闭和焦点返回。
- 进度和暂存设置是进程内状态；插件卸载或进程重启后不会自动恢复或继续执行。用户需要重新呈现/审核计划。
- 压缩一旦提交便不能回滚；若之后模型选择失败，计划仍不会获批，但压缩后的上下文会保留。

- It handles only a single native `plan-review` question; the native approval choice remains authoritative.
- The Host prepares execution only after settings were staged and one exact approval answer arrives. Decline, cancellation, stale requests, and validation failures are not released by the plugin. Without staged settings, the native approval path is unchanged.
- Compaction uses the current Agent's `compactRegion()` and a tool-pair-balanced history prefix before the pending approval batch. If no safe range meets the configured threshold, the operation fails closed rather than silently proceeding without compaction.
- The result's `shadowedSeqs` are checked, and the pending approval batch must remain on the active surface. The approved plan and its pending tool batch must stay outside the selected range.
- Models and reasoning efforts come from the Host catalog; capabilities are never hard-coded. Loading, an empty catalog, partial provider failures, request errors, and timeouts are distinct retryable states, and none of them block “Use current model”.
- Reasoning effort is remembered per model within the current review form. `reasoningEffort` is only sent after an explicit choice; “Use model default” omits it. Switching back to a model restores the effort only while the latest catalog still advertises it.
- The options panel is rendered through a portal instead of restyling the native approval card. It is viewport-clamped, scrolls internally, and supports a close button, Escape, outside clicks, and focus return.
- Staged settings and progress are process-local. They are not resumed after plugin unload or process restart; the plan must be presented and reviewed again.
- Compaction cannot be rolled back after it commits. If model selection subsequently fails, the plan is not approved, but the compacted context remains.

## 安装与使用 | Installation and use

从 [GitHub Releases](https://github.com/FFFengMJL/dsh-plan-execute/releases) 下载 tarball 后安装到指定 profile：

```sh
dsh plugin --profile web add /path/to/dsh-plan-execute-0.1.0.tgz
```

本地开发可先构建，再用 link 安装：

```sh
cd /path/to/dsh-plan-execute
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add link:/path/to/dsh-plan-execute
```

移除插件：

```sh
dsh plugin --profile web remove dsh-plan-execute
```

`dsh plugin` 只负责 profile 的依赖与 bundle 登记；运行中的 DSH 是否加载新客户端代码取决于其重载机制。没有开发 watcher 时，需要重新加载或重启对应 profile，不能仅凭 `package.json` 已登记就认定运行中实例已加载。

在计划审核卡片中打开“执行选项”：

1. 选择“沿用当前模型”或一个具体模型；选择具体模型后可设置该模型支持的思考等级。
2. 选择“保留上下文直接执行”或“压缩较早历史后执行”。
3. 点击“保存本次设置”。未保存的修改不会生效，批准会使用上一次已保存的设置。
4. 点击下方原生“批准”按钮。插件在原生批准返回前完成压缩和模型选择；任何准备失败都不会放行计划。

Download the tarball from [GitHub Releases](https://github.com/FFFengMJL/dsh-plan-execute/releases), then install it into a profile:

```sh
dsh plugin --profile web add /path/to/dsh-plan-execute-0.1.0.tgz
```

For local development, build first and link the checkout:

```sh
cd /path/to/dsh-plan-execute
pnpm install --frozen-lockfile
pnpm build
dsh plugin --profile web add link:/path/to/dsh-plan-execute
```

Remove it with:

```sh
dsh plugin --profile web remove dsh-plan-execute
```

`dsh plugin` manages the profile's dependency and bundle registration. Whether a running DSH loads the new client code depends on its reload mechanism; without a development watcher, reload or restart the profile. A registered dependency does not prove the running instance loaded it.

In the plan-review card, open “Execution options”: pick the current model or a specific model (then one of its advertised reasoning efforts), choose context handling, click “Save these settings”, and finally use the native Approve button. Unsaved edits never take effect, and any preparation failure prevents approval.

## 模型选择影响 | Model-selection effect

自定义模型和思考等级通过 DSH RC5 的公开 `sessionController.selectModel()` API 选择。该 API 会为当前会话安装选择，并异步尝试更新 Host 默认模型；默认值保存失败只会记录日志，因此不能保证默认值一定改变。选择“沿用当前模型”不会触发该更新。模型选择在本会话中保持有效，直到用户通过 DSH 原生模型选择器更改。

A custom model and effort are selected through DSH RC5's public `sessionController.selectModel()` API. That API installs the selection for the current Session and asynchronously attempts to save the Host default; a failed default save is only logged, so the default is not guaranteed to change. Choosing “Use current model” does not trigger this update. A custom selection remains active for this Session until changed through DSH's native model selector.

## 兼容性与发布状态 | Compatibility and release status

首版按 DSH `0.2.1-rc.5` 的 Host、Typert、Compaction、Session 和 Web client API 实现，依赖版本在 [`package.json`](package.json) 中固定。其他 Host 版本尚未验证。

The first version targets the DSH `0.2.1-rc.5` Host, Typert, Compaction, Session, and Web client APIs. Peer versions are pinned in [`package.json`](package.json); other Host versions have not been verified.

## 发布与分发 | Release and distribution

本仓库公开发布于 [FFFengMJL/dsh-plan-execute](https://github.com/FFFengMJL/dsh-plan-execute)：采用 [MIT 许可证](<LICENSE>)，CI 在 push/PR 上运行 `pnpm verify`、显式的 headless Chromium 布局回归，并检查可交付 tarball；tag 驱动的 [Release workflow](<.github/workflows/release.yml>) 会从精确 tag commit 构建 `.tgz` 与 `.sha256`，校验 tag/版本与 checksum 后创建 GitHub draft Release，由维护者人工发布。相关 [CI workflow](<.github/workflows/ci.yml>) 不需要写权限。仓库已配置规则保护 `v*` tags，禁止强制更新或删除。

The repository is public at [FFFengMJL/dsh-plan-execute](https://github.com/FFFengMJL/dsh-plan-execute). It uses the [MIT license](<LICENSE>), CI runs `pnpm verify`, an explicit headless Chromium layout regression, and checks the installable tarball on pushes and pull requests. The tag-driven [Release workflow](<.github/workflows/release.yml>) builds a `.tgz` and `.sha256` from the exact tag commit, checks the tag/version and checksum, then creates a draft GitHub Release for a maintainer to publish manually. The [CI workflow](<.github/workflows/ci.yml>) requires no write permission. A repository ruleset protects `v*` tags from force-updates and deletion.

[`package.json`](<package.json>) 保留 `private: true`，这是为了禁止 npm 发布；它不妨碍公开 GitHub 仓库或 GitHub Release tarball。配置的分发渠道是 GitHub Release，不会自动发布到 npm。Release workflow 仅在推送与 [`package.json`](<package.json>) 版本相符的 `v<version>` tag 后触发。

[`package.json`](<package.json>) keeps `private: true` to prevent npm publishing; that does not prevent a public GitHub repository or GitHub Release tarball. GitHub Releases are the configured distribution channel; the package is not published to npm. The Release workflow runs only after pushing a `v<version>` tag matching [`package.json`](<package.json>).

## 本地开发与验证 | Local development and verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test            # unit, real-dependency contract, React/jsdom behavior
pnpm test:browser    # headless Chromium layout regression (builds the fixture first)
pnpm build
pnpm verify          # typecheck → build → Vitest → package inspection
pnpm package:check
pnpm release:pack
```

首次运行浏览器测试前需要安装 headless shell；完整 Chromium 不是必需：

```sh
pnpm exec playwright install --only-shell chromium
```

`pnpm verify` 运行类型检查、Host/client 构建、Vitest（含 jsdom 组件测试）和 tarball 文件清单检查，**不包含**浏览器回归；`pnpm test:browser` 单独运行 Playwright 布局回归。CI 与 Release 会依次执行 `pnpm verify` 和 `pnpm test:browser`。`pnpm package:check` 单独复查 package 文件集；`pnpm release:pack` 会生成 `.release/` 下的 `.tgz` 和 `.sha256`，并在本地核对文件名与摘要。`release:pack` 需要先执行 `pnpm build`，缺少 `lib/` 入口时会明确失败。

测试层级与证据边界：

- Vitest 覆盖审批门控、失败关闭、取消、生命周期、模型目录纯函数、真实 RC5 `Session` + Compaction 工具配对，以及完整审批场景（真实会话、真实范围计算、可控摘要替身）。
- jsdom + Testing Library 覆盖模型目录状态、按模型思考等级、保存请求、非终态轮询、portal 与关闭/焦点行为。
- Playwright fixture 在真实 Chromium 中复现 `overflow:hidden` 审批容器，验证面板不被裁剪、受视口约束、短视口可滚动、窄屏无横向溢出。fixture 使用模拟 remote，不代表真实 DSH GUI 已验证。
- 真实 DSH Web GUI、正式 Compaction 摘要后端和真实服务商模型调用没有在自动测试中运行；这些仍需单独的人工或隔离 profile 验收。

`pnpm verify` runs type checks, the Host/client build, Vitest (including jsdom component tests), and the tarball file-list check; it **excludes** the browser regression. `pnpm test:browser` runs the Playwright layout regression separately, and CI/Release run both commands. `pnpm package:check` checks the package file set separately; `pnpm release:pack` writes a `.tgz` and `.sha256` under `.release/` and verifies the checksum and basename locally. `release:pack` requires a prior `pnpm build` and fails loudly when the `lib/` entry points are missing.

Before running the browser test for the first time, install the headless shell (full Chromium is not required):

```sh
pnpm exec playwright install --only-shell chromium
```

Evidence boundaries:

- Vitest covers the approval gate, fail-closed paths, cancellation, lifecycle, catalog helpers, the real RC5 `Session` + Compaction pairing helpers, and a full approval scenario (real Session, real range calculation, controllable summary stand-in).
- jsdom + Testing Library covers catalog states, per-model reasoning effort, save payloads, non-terminal polling, and portal/close/focus behavior.
- The Playwright fixture reproduces an `overflow:hidden` approval container in headless Chromium and verifies the panel escapes clipping, stays inside the viewport, scrolls in short viewports, and does not overflow horizontally. It uses a simulated remote and is not live DSH GUI validation; full Chromium is unnecessary for these layout and focus checks.
- The live DSH Web GUI, the production compaction summarizer, and real provider model calls are not exercised by automated tests; they still need separate manual or isolated-profile acceptance.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
