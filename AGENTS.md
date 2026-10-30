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
- 自定义模型经 `sessionController.selectModel()` 设置；该公开 API 还会更新 Host 默认模型。保持 UI 提示准确，不要增加隐式恢复或静默修改默认值的逻辑。
- Custom models use `sessionController.selectModel()`, which also updates the Host default. Keep the UI disclosure accurate; do not add hidden restoration or default changes.
- 暂存/进度目前是进程内状态；不要假设重启后会恢复。任何持久化改动都要另行设计兼容的数据契约。
- Staging and progress are process-local; do not assume restart recovery. Any persistence change needs a separately designed compatible data contract.

## 构建与验收 / Build and verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm verify
pnpm package:check
pnpm release:pack
```

- `pnpm verify` 顺序为 typecheck → build → tests → `package:check`；包检查依赖先构建出的 [`lib/client.js`](<lib/client.js>)。[`scripts/check-package.mjs`](<scripts/check-package.mjs>) 会实际打包、解包并核对入口、LICENSE/README 与禁止泄漏的文件。
- `pnpm verify` runs typecheck → build → tests → `package:check`; package inspection requires the preceding build output [`lib/client.js`](<lib/client.js>). [`scripts/check-package.mjs`](<scripts/check-package.mjs>) creates and extracts a real tarball, then checks entry points, LICENSE/README, and forbidden files.
- [`package.json`](<package.json>) 中的 `release:pack` script 调用 [`scripts/create-release-package.mjs`](<scripts/create-release-package.mjs>)，在忽略的 `.release/` 下创建一个 `.tgz` 和匹配的 `.sha256`，并本地验证摘要/文件名；Release CI 在创建 draft 前还会运行 `sha256sum -c`。
- The `release:pack` script in [`package.json`](<package.json>) calls [`scripts/create-release-package.mjs`](<scripts/create-release-package.mjs>) to create one `.tgz` and matching `.sha256` under ignored `.release/`, then verifies digest/basename locally. Release CI also runs `sha256sum -c` before creating a draft.
- 自动化测试和 tarball 检查不代表真实 DSH Web GUI 已验证。`lib/` 是生成产物并被 [`.gitignore`](<.gitignore>) 忽略；[`package.json`](<package.json>) 的 `files` 控制 tarball 内容，勿把 maintainer scripts 或 [`AGENTS.md`](<AGENTS.md>) 打进包。
- Automated tests and tarball inspection are not live DSH GUI validation. `lib/` is generated and ignored by [`.gitignore`](<.gitignore>); [`package.json`](<package.json>)'s `files` controls the tarball, and maintainer scripts / [`AGENTS.md`](<AGENTS.md>) must stay out.
- 依赖变更后用 pnpm 更新 [`pnpm-lock.yaml`](<pnpm-lock.yaml>)，并保留 [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>) 中 RC5 依赖所需的精确 release-age 排除项；不要用通配方式关闭供应链策略。
- After dependency changes, update [`pnpm-lock.yaml`](<pnpm-lock.yaml>) with pnpm and preserve the exact release-age exclusions for RC5 dependencies in [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>); do not disable supply-chain policy with broad patterns.

## 公开仓库与发布 / Public repository and releases

- 公开 GitHub 仓库准备属于本项目范围；[`LICENSE`](<LICENSE>) 使用 MIT，CI 与 tag-driven draft Release 配置在 [`.github/workflows/ci.yml`](<.github/workflows/ci.yml>) 和 [`.github/workflows/release.yml`](<.github/workflows/release.yml>)。
- Public GitHub repository preparation is in scope. [`LICENSE`](<LICENSE>) uses MIT; CI and tag-driven draft releases live in [`.github/workflows/ci.yml`](<.github/workflows/ci.yml>) and [`.github/workflows/release.yml`](<.github/workflows/release.yml>).
- [`package.json`](<package.json>) 的 `private: true` 只禁止 npm 发布，是明确选择；不要移除或添加 npm publish 步骤。它不限制 GitHub 仓库可公开，也不限制 GitHub Release tarball。
- `private: true` in [`package.json`](<package.json>) intentionally disables npm publishing. Do not remove it or add npm publish steps; it does not make the GitHub repository private or prevent Release tarballs.
- CI 与 Release 使用 Node 24、pnpm 12.16.1；保持 [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>) 对 RC5 依赖的精确 minimum-release-age exclusions。
- CI and Release use Node 24 and pnpm 12.16.1; preserve the exact RC5 minimum-release-age exclusions in [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>).
- Release 仅由与 [`package.json`](<package.json>) 版本相符的 `v<version>` tag 触发；从 tag 指向的精确 commit 打包，校验摘要，并只创建 draft。发布 draft、配置 remote、推送分支或 tag 都需要单独明确授权。
- Release triggers only on a `v<version>` tag matching [`package.json`](<package.json>), packages that exact tagged commit, verifies the checksum and rechecks the remote tag SHA, then creates a draft only. Publishing the draft, configuring a remote, or pushing a branch/tag requires separate explicit authorization.
- Configure a GitHub ruleset for `v*` tags to prohibit force updates/deletion once the remote exists; workflow checks cannot eliminate the small race after remote SHA verification.
