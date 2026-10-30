# dsh-plan-execute

同一 DSH 会话中的计划审批与执行选项扩展。它保留原生计划预览和批准流程，并在计划审核动作区提供模型选择以及“保留上下文”或“压缩较早历史后执行”选项。

A same-Session plan approval and execution-options extension for DSH. It preserves the native plan preview and approval flow, adding model selection and a choice to keep context unchanged or compact earlier history before execution.

## 功能与安全边界 | Features and safety

- 只处理带有原生 `plan-review` intent 的单题审核；实际执行仍由原生批准选项决定。
- Host 只有在收到唯一、精确的批准答案后才继续；拒绝、取消、过期请求或校验失败都不会获批。
- 压缩通过当前 Agent 的 `compactRegion()` 执行，只选择待批准工具批次之前、工具配对平衡的历史前缀。若没有满足阈值的安全范围，操作会失败关闭，不会静默改为不压缩。
- 压缩结果会核对 `shadowedSeqs`，并确认待批准批次仍在活动 surface 上。最终计划和待处理的审批工具批次不应被所选范围覆盖。
- 进度和暂存设置是进程内状态；插件卸载或进程重启后不会自动恢复或继续执行。用户需要重新呈现/审核计划。
- 压缩一旦提交便不能回滚；若之后模型选择失败，计划仍不会获批，但压缩后的上下文会保留。

- It handles only a single native `plan-review` question; the native approval choice remains authoritative.
- The Host proceeds only after one exact approval answer. Decline, cancellation, stale requests, and validation failures do not approve the plan.
- Compaction uses the current Agent's `compactRegion()` and a tool-pair-balanced history prefix before the pending approval batch. If no safe range meets the configured threshold, the operation fails closed rather than silently proceeding without compaction.
- The result's `shadowedSeqs` are checked, and the pending approval batch must remain on the active surface. The approved plan and its pending tool batch must stay outside the selected range.
- Staged settings and progress are process-local. They are not resumed after plugin unload or process restart; the plan must be presented and reviewed again.
- Compaction cannot be rolled back after it commits. If model selection subsequently fails, the plan is not approved, but the compacted context remains.

## 模型选择影响 | Model-selection effect

自定义模型会通过 DSH RC5 的公开 `sessionController.selectModel()` API 选择。该 API 也会更新 Host 默认模型，因此可能影响新会话；选择“沿用当前模型”不会触发此更新。模型选择在本会话中保持有效，直到用户通过 DSH 原生模型选择器更改。

A custom model is selected through DSH RC5's public `sessionController.selectModel()` API. That API also updates the Host default model and may affect new Sessions. Choosing “Use current model” does not trigger this update. A custom selection remains active for this Session until changed through DSH's native model selector.

## 兼容性与发布状态 | Compatibility and release status

首版按 DSH `0.2.1-rc.5` 的 Host、Typert、Compaction 和 Web client API 实现，依赖版本在 [`package.json`](package.json) 中固定。其他 Host 版本尚未验证。

The first version targets the DSH `0.2.1-rc.5` Host, Typert, Compaction, and Web client APIs. Peer versions are pinned in [`package.json`](package.json); other Host versions have not been verified.

## GitHub 发布准备 | GitHub release preparation

本地仓库包含公开 GitHub 发布准备：采用 [MIT 许可证](<LICENSE>)，CI 在 push/PR 上运行 `pnpm verify` 并检查可交付 tarball；tag 驱动的 [Release workflow](<.github/workflows/release.yml>) 会从精确 tag commit 构建 `.tgz` 与 `.sha256`，校验 tag/版本与 checksum 后创建 GitHub draft Release，由维护者人工发布。相关 [CI workflow](<.github/workflows/ci.yml>) 不需要写权限。创建 GitHub 仓库后，还应配置规则保护 `v*` tags，禁止强制更新或删除。

The local repository includes public-GitHub preparation: it uses the [MIT license](<LICENSE>), CI runs `pnpm verify` on pushes and pull requests, and checks the installable tarball. The tag-driven [Release workflow](<.github/workflows/release.yml>) builds a `.tgz` and `.sha256` from the exact tag commit, checks the tag/version and checksum, then creates a draft GitHub Release for a maintainer to publish manually. The [CI workflow](<.github/workflows/ci.yml>) requires no write permission. Once the GitHub repository exists, configure a ruleset protecting `v*` tags from force-updates and deletion.

[`package.json`](<package.json>) 保留 `private: true`，这是为了禁止 npm 发布；它不妨碍公开 GitHub 仓库或 GitHub Release tarball。配置的分发渠道是 GitHub Release，不会自动发布到 npm。Release workflow 仅在推送与 [`package.json`](<package.json>) 版本相符的 `v<version>` tag 后触发。

[`package.json`](<package.json>) keeps `private: true` to prevent npm publishing; that does not prevent a public GitHub repository or GitHub Release tarball. GitHub Releases are the configured distribution channel; the package is not published to npm. The Release workflow runs only after pushing a `v<version>` tag matching [`package.json`](<package.json>).

## 本地开发与验证 | Local development and verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm verify
pnpm package:check
pnpm release:pack
```

`pnpm verify` 运行类型检查、Host/client 构建、测试和 tarball 文件清单检查。`pnpm package:check` 单独复查 package 文件集；`pnpm release:pack` 会生成 `.release/` 下的 `.tgz` 和 `.sha256`，并在本地核对文件名与摘要。

`pnpm verify` runs type checks, the Host/client build, tests, and a tarball file-list check. `pnpm package:check` checks the package file set separately; `pnpm release:pack` writes a `.tgz` and `.sha256` under `.release/` and verifies the checksum and basename locally. Tests include a loader smoke test, not a live DSH Web GUI validation.

初次验证使用 Node `v24.22.2` / pnpm `12.16.1`；插件未安装到用户 DSH profile，也未在真实 Web GUI 中验证。

The initial verification used Node `v24.22.2` / pnpm `12.16.1`; the plugin was not installed into a user DSH profile or validated in the live Web GUI.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
