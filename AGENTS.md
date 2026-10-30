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
pnpm pack --dry-run
```

- `pnpm verify` 顺序为 typecheck → build → tests；client loader smoke test 依赖先构建出的 [`lib/client.js`](<lib/client.js>)。
- `pnpm verify` runs typecheck → build → tests; the client-loader smoke test requires the preceding build output [`lib/client.js`](<lib/client.js>).
- 测试是隔离单测与 loader smoke test，不代表真实 DSH Web GUI 已验证。`lib/` 是生成产物并被 [`.gitignore`](<.gitignore>) 忽略；包交付清单在 [`package.json`](<package.json>) 的 `files` 字段。
- Tests are isolated unit tests plus a loader smoke test, not live DSH GUI validation. `lib/` is generated and ignored by [`.gitignore`](<.gitignore>); [`package.json`](<package.json>)'s `files` field controls package contents.
- 依赖变更后用 pnpm 更新 [`pnpm-lock.yaml`](<pnpm-lock.yaml>)，并保留 [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>) 中 RC5 依赖所需的精确 release-age 排除项；不要用通配方式关闭供应链策略。
- After dependency changes, update [`pnpm-lock.yaml`](<pnpm-lock.yaml>) with pnpm and preserve the exact release-age exclusions for RC5 dependencies in [`pnpm-workspace.yaml`](<pnpm-workspace.yaml>); do not disable supply-chain policy with broad patterns.

## 发布边界 / Release boundary

- 插件包当前标记为 `private`。GitHub 仓库、许可证、CI、Release 工作流和校验和属于可选后续阶段；未经明确要求，不将其设为首版完成条件。
- The package is currently `private`. A GitHub repository, license, CI, release workflow, and checksums are optional follow-up work, not first-version completion criteria unless explicitly requested.
