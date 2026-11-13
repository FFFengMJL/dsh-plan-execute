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
- 设置页“计划审批执行”保存两套独立预设：压缩历史后执行的模型/思考等级，以及保留历史后执行的模型/思考等级。预设写入当前 profile；未配置时对应快捷按钮明确不可用，不会猜测模型。
- 审核卡片顶部提供“按预设”快捷按钮。它们只**暂存**对应模式与预设，仍需点击原生“同意执行”按钮；不会模拟点击、自动批准或绕过原生批准。设置变更后用 `unset` 使字段改用继承值；当前实现在继承层有值时会把这个值固定到 profile。冲突时保留草稿，且只重试用户实际编辑的预设，不会覆盖另一项。
- 窄屏下快捷按钮收进“选项”面板，以完整文字和模型名展示；桌面端保留分组按钮，并通过边框、间距、图标和更大的字号与原生“查看全文”区分。不会覆写或移动原生审批区域。
- 原生“要求修改”在 DSH `0.2.2-rc.2` 中会以 `ASK_CANCELLED` 结束计划审批，而不是隐藏卡片；公开的 `userQuestionPanels.reveal()` 没有可恢复的卡片，插件也不会伪造审批或从历史重建可执行请求。因此本版不提供 `/review-plan`；真正的“隐藏后恢复”需要上游 DSH 提供稳定的审批 `wait.callId` 或 reopen API。
- 进度和暂存设置是进程内状态；插件卸载或进程重启后不会自动恢复或继续执行。用户需要重新呈现/审核计划。
- 压缩一旦提交便不能回滚；若之后模型选择失败，计划仍不会获批，但压缩后的上下文会保留。

- It handles only a single native `plan-review` question; the native approval choice remains authoritative.
- The Host prepares execution only after settings were staged and one exact approval answer arrives. Decline, cancellation, stale requests, and validation failures are not released by the plugin. Without staged settings, the native approval path is unchanged.
- Compaction uses the current Agent's `compactRegion()` and a tool-pair-balanced history prefix before the pending approval batch. If no safe range meets the configured threshold, the operation fails closed rather than silently proceeding without compaction.
- The result's `shadowedSeqs` are checked, and the pending approval batch must remain on the active surface. The approved plan and its pending tool batch must stay outside the selected range.
- Models and reasoning efforts come from the Host catalog; capabilities are never hard-coded. Loading, an empty catalog, partial provider failures, request errors, and timeouts are distinct retryable states, and none of them block “Use current model”.
- Reasoning effort is remembered per model within the current review form. `reasoningEffort` is only sent after an explicit choice; “Use model default” omits it. Switching back to a model restores the effort only while the latest catalog still advertises it.
- The options panel is rendered through a portal instead of restyling the native approval card. It is viewport-clamped, scrolls internally, and supports a close button, Escape, outside clicks, and focus return.
- The Settings page “Plan approval execution” saves two independent presets: a model/effort for “compact history, then execute” and one for “keep history, then execute”. Presets are written to the active profile. A shortcut without a preset is explicitly unavailable rather than guessing a model.
- “Presets” shortcuts at the top of the review card only **stage** the mode and saved target; the native Approve button still executes. They never simulate that button, auto-approve, or bypass the native flow. Clearing an override writes `unset` to use the inherited value; the current implementation pins that value into the profile when a lower layer supplies one. Conflicts keep the draft, retry only presets the user actually edited, and never overwrite the other preset.
- On narrow screens the shortcuts collapse into the “presets” panel with full labels and model names; on desktop they stay a bordered, spaced, icon-labelled group that is clearly distinct from the native “View full plan” link. Native approval chrome is never restyled or moved.
- In DSH `0.2.2-rc.2`, the native “Request changes” action ends the plan review with `ASK_CANCELLED`; it does not merely hide the card. The public `userQuestionPanels.reveal()` then has no card to restore, and the plugin will not fake an approval or rebuild an executable request from history. This release therefore does not ship `/review-plan`; true hide-and-restore needs an upstream DSH change (a stable approval `wait.callId` or a reopen API).
- Staged settings and progress are process-local. They are not resumed after plugin unload or process restart; the plan must be presented and reviewed again.
- Compaction cannot be rolled back after it commits. If model selection subsequently fails, the plan is not approved, but the compacted context remains.

## 安装与使用 | Installation and use

从 [GitHub Releases](https://github.com/FFFengMJL/dsh-plan-execute/releases) 下载 tarball 后安装到指定 profile：

```sh
dsh plugin --profile web add /path/to/dsh-plan-execute-0.2.2.tgz
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

先打开“设置 → 计划审批执行”，为两种执行方式各保存一套预设（模型 + 可选思考等级）。未配置的快捷按钮不可用；覆盖的预设可以清除以使用继承值（当前实现会把该值固定到 profile），继承的预设不能在此清除，需在来源层修改。

在计划审核卡片中使用快捷按钮：

1. 点击“压缩后执行”或“保留后执行”。插件按当前设置快照暂存对应模式和模型，并显示“已暂存”。
2. 点击下方原生“同意执行”按钮。插件在原生批准返回前完成压缩和模型选择；任何准备失败都不会放行计划。
3. 如需临时选择其他模型、思考等级或上下文处理方式，打开“选项”面板，点击“保存本次设置”，再点击原生批准。临时选择不会自动保存为预设。

注意：原生“要求修改”会结束本次计划审批并把控制交回模型，没有“仅隐藏、稍后恢复”的语义。若不想结束审批，请不要点击；可先滚动页面查看其他内容。

Download the tarball from [GitHub Releases](https://github.com/FFFengMJL/dsh-plan-execute/releases), then install it into a profile:

```sh
dsh plugin --profile web add /path/to/dsh-plan-execute-0.2.2.tgz
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

First open Settings → Plan approval execution and save one preset for each execution style (a model plus an optional reasoning effort). A shortcut without a preset is unavailable; clearing an override uses the inherited value (the current implementation pins that value into the profile), while an inherited preset cannot be cleared here and must be changed at its source layer.

In the plan-review card:

1. Click “Compact, then run” or “Keep, then run”. The plugin stages that mode and the preset captured from the current settings and shows “Staged”.
2. Click the native “Approve” button. The plugin completes compaction and model selection before the native approval returns; any preparation failure prevents approval.
3. To pick another model, effort, or context handling just for this review, open “Options”, click “Save these settings”, then use the native Approve button. Temporary choices are not saved as presets.

Note: the native “Request changes” action ends this plan review and returns control to the model; there is no hide-and-restore semantics. Do not click it if you want to keep the approval pending; scroll to inspect other content instead.

## 模型选择影响 | Model-selection effect

预设和临时选择中的自定义模型与思考等级都通过 DSH 的公开 `sessionController.selectModel()` API 选择（已核对 `0.2.2-rc.2` 的公开接口与实现）；快捷按钮只是在批准前暂存同一 `StageApprovalRequest`，不会提前切换模型。该 API 会为当前会话安装选择，并异步尝试更新 Host 默认模型；默认值保存失败只会记录日志，因此不能保证默认值一定改变。选择“沿用当前模型”不会触发该更新。模型选择在本会话中保持有效，直到用户通过 DSH 原生模型选择器更改。

Preset and temporary custom models and efforts all go through DSH's public `sessionController.selectModel()` API (public interface and implementation checked on `0.2.2-rc.2`); a shortcut only stages the same `StageApprovalRequest` before approval and never switches the model early. That API installs the selection for the current Session and asynchronously attempts to save the Host default; a failed default save is only logged, so the default is not guaranteed to change. Choosing “Use current model” does not trigger this update. A custom selection remains active for this Session until changed through DSH's native model selector.

## 兼容性与发布状态 | Compatibility and release status

当前发布版本 `0.2.3` 按 DSH `0.2.2-rc.2` 的 Host、Typert、Compaction、Session 和 Web client API 实现；DSH 依赖在 [`package.json`](package.json) 中精确固定，Cordis 与 Schemastery 固定到已验证的次版本线。设置页使用 `ctx.configForms` 与 `settings.section`；该版本通过自动门禁，并在重启后的真实 GUI 审批对话框中验证了预设按钮、暂存状态与选项入口。DSH `0.2.2-rc.1` 用户继续使用已发布的 `v0.2.2`，`0.2.1-rc.5` 用户继续使用 `v0.2.1`；正式版 0.2.1/0.2.2 与其他 Host 版本尚未验证，不会被自动放行。

The current release `0.2.3` targets DSH `0.2.2-rc.2` across the Host, Typert, Compaction, Session, and Web client APIs; DSH dependencies are pinned exactly in [`package.json`](package.json), with Cordis and Schemastery pinned to their verified minor lines. The settings page uses `ctx.configForms` and `settings.section`; this release passes the automated gate, and its preset buttons, staged state, and options entry were verified in the live GUI approval dialog after a restart. Users on DSH `0.2.2-rc.1` keep the published `v0.2.2`, and users on `0.2.1-rc.5` keep `v0.2.1`. Stable 0.2.1/0.2.2 and other Host versions are not verified and are not admitted automatically.

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

- Vitest 覆盖审批门控、失败关闭、取消、生命周期、模型目录纯函数、真实 `Session` + Compaction 工具配对，以及完整审批场景（真实会话、真实范围计算、可控摘要替身）；审批门控仍是唯一可放行计划的路径。
- jsdom + Testing Library 覆盖模型目录状态、按模型思考等级、保存请求、非终态轮询、portal 与关闭/焦点行为；同时覆盖两套预设的草稿、`set`/`unset` 写入、冲突重试隔离、目录不可用时清除、继承值固定、只读与目录失败，以及快捷按钮的预设暂存、未配置/模型失效禁用。
- Playwright fixture 在真实 Chromium 中复现 `overflow:hidden` 审批容器，验证面板不被裁剪、受视口约束、短视口可滚动、窄屏无横向溢出、桌面快捷按钮分组和窄屏“选项”面板。fixture 使用模拟 remote，不代表真实 DSH GUI 已验证。
- 真实 DSH Web GUI、正式 Compaction 摘要后端和真实服务商模型调用没有在自动测试中运行；这些仍需单独的人工或隔离 profile 验收。

`pnpm verify` runs type checks, the Host/client build, Vitest (including jsdom component tests), and the tarball file-list check; it **excludes** the browser regression. `pnpm test:browser` runs the Playwright layout regression separately, and CI/Release run both commands. `pnpm package:check` checks the package file set separately; `pnpm release:pack` writes a `.tgz` and `.sha256` under `.release/` and verifies the checksum and basename locally. `release:pack` requires a prior `pnpm build` and fails loudly when the `lib/` entry points are missing.

Before running the browser test for the first time, install the headless shell (full Chromium is not required):

```sh
pnpm exec playwright install --only-shell chromium
```

Evidence boundaries:

- Vitest covers the approval gate, fail-closed paths, cancellation, lifecycle, catalog helpers, the real `Session` + Compaction pairing helpers, and a full approval scenario (real Session, real range calculation, controllable summary stand-in); the approval gate remains the only path that can release a plan.
- jsdom + Testing Library covers catalog states, per-model reasoning effort, save payloads, non-terminal polling, and portal/close/focus behavior; it also covers both preset drafts, `set`/`unset` writes, conflict-retry isolation, clearing while the catalog is unavailable, inherited-value pinning, read-only and catalog failures, and shortcut staging for configured, unconfigured, and stale presets.
- The Playwright fixture reproduces an `overflow:hidden` approval container in headless Chromium and verifies the panel escapes clipping, stays inside the viewport, scrolls in short viewports, and does not overflow horizontally; it also checks the desktop shortcut group and the narrow-screen preset panel. It uses a simulated remote and is not live DSH GUI validation.
- The live DSH Web GUI, the production compaction summarizer, and real provider model calls are not exercised by automated tests; they still need separate manual or isolated-profile acceptance.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
