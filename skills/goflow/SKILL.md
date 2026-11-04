---
name: goflow
description: Coordinate local coding between Codex GPT and OpenCode Go, inspect shared subscription quota, manage queued tasks, run isolated tests, and require GPT review or escalation. Also use for quota, mode, and Go model requests.
---

The current Codex GPT signed in through ChatGPT is the lead agent: understand requirements, split tasks, assess risk, review, and integrate results. The user-level MCP is named `goflow`; its runtime is `~/.codex/goflow` or the Codex user root selected at installation.

Start with `goflow_status`. Natural-language requests to disable delegation, force GPT, force Go, or restore automatic mode map to `goflow_set_mode(off|gpt|go|auto)`. For a temporary task-only preference, pass request `mode` without changing the global setting. Force Go never bypasses high-risk, billing, tests, or review gates.

After GPT assesses complexity and risk, call `goflow_route`. Clear repetitive edits, unit tests, and ordinary local features prefer Go. Architecture, complex algorithms, secrets/permissions/authentication/cryptography, production infrastructure, deletion, database migration, and unclear impact stay with the current GPT. If the bridge misses a risk, apply GPT's more conservative judgment.

Delegation requires an absolute project path, complete task requirements, explicit existing project-relative `files`, allowed existing/new `editableFiles`, and explicit test argv. Existing editable files must be in both lists; new files belong only in `editableFiles`, without empty placeholders. A new package may use `files: []` and `editableFiles: ["tags.mjs", "tags.test.mjs"]`; add README.md to `files` if it is an input. This public version requires a nonempty `tests` array including Node `--test` for the delivered tests. Missing existing inputs are rejected before inference; they are not auto-created. Never select entire directories, environment/authentication files, user configuration, or credentials. The bridge makes an independent snapshot without unselected source or the original .git, and Go cannot call local tools. Go returns JSON file patches. Automatic verification supports Node's built-in test runner; GPT develops and tests other stacks within the original authorization instead of reducing requirements.

When `goflow_submit` returns `review_required`, read the candidate and diff. GPT must review actual code and test evidence for requirements, dangerous operations, removed/weakened tests, dependency changes, and impact. Then call `goflow_accept(taskId, reviewer="GPT", reviewSummary=<specific evidence>)`; it applies only declared patches after original-hash checks. If an action has not been authorized by the user, retain reviewable output and respect that authorization boundary.

After the first Go failure, the bridge allows at most two repairs based on concrete errors or test failures. At `escalation_required`, the current GPT continues using the candidate and logs to complete the original task. Do not switch to a metered API/provider, loop without evidence, redelegate the same failed task to evade the limit, or start a paid GPT API from a background service. Models must be in the actual current `goflow_models` `opencode-go/*` list; the bridge selects dynamically.

Unconfirmed billing protection blocks Go inference; continue independent GPT work and report the limitation. The user must confirm an active Go subscription and Use balance off in the console. Do not run billing-confirm yourself, alter protection, or read keys. The guard cannot observe later account/subscription/console changes. Records identify configured opencode-go usage based on the user's confirmation; the current GPT uses ChatGPT/Codex. Provider token/cost fields are not billing proof.

Missing/disabled service, version changes, or failed configuration isolation preserve the current GPT workflow with an explicit limitation. Cite actual logs and test results; simulated tests are not real Go success.

## V1.1 quota supplement

Use `goflow_usage` for official account five-hour, weekly, and monthly snapshots and the last successful timestamp. The roughly 60-second cache reduces HTTP traffic; do not call it a live balance or treat a displayed 0% as proof of no use. Without per-model wallet fields, report shared account windows only; provider weights determine model differences. Route only actual Go catalog models. Keep unverified historical success rates/costs unknown.

Below 80% is normal; at 80%, warn and consider lower consumption only if quality holds; at 95%, queue new requests; at 100%/rate-limited, stop relevant requests until reset. A one-time 95% authorization must follow explicit user instruction through the local CLI, bind the exact task/model, have short validity, and permit one request. It never bypasses 100%, billing, risk, tests, or review. State that the channel is the OpenCode Go subscription; do not implicitly enable Zen balance.

Quota/authorization/service failures return queued with a category. Use `goflow_queue` and `goflow_resume` with the same task ID; do not automatically upgrade to advanced GPT, count these as coding failures, or create a new task to evade repair limits. Explicit GPT requests use the current ChatGPT/Codex subscription; complex/high-risk work remains GPT-owned. Later task-triggered refreshes may resume unchanged inputs under original authorization without heavy permanent polling.

Only the private helper reads query credentials in memory and sends them to the fixed official quota URL. Do not open auth files, ask for chat-pasted keys, or extract cookies/ChatGPT tokens. New hidden local input uses Windows Credential Manager; the cache is bound to actual inference credentials. If the API does not report Use balance, leave it unknown. Do not enable billing protection or alter account settings yourself. This trusted helper is authorized for quota lookup, not arbitrary key extraction.

## Desktop local entry point V1.1.2

For coding under the default user root, first call goflow_status through the installed `scripts/client.mjs` to check registration, explicit plugin disablement, and fixed service paths. Then use one official MCP entry point when available, otherwise continue through the client. Only one entry point per operation. The client accepts the original ten tools and JSON stdin while preserving all service protections; it cannot select another configuration, executor, root, or authorization. Custom CODEX_HOME is refused: use that host's official MCP or report the limitation.

Select nodeExe from the installed noncredential runtime-config.json and use explicit installation paths. Never open auth files or pass API keys as arguments.

```powershell
$goflowRuntime = Join-Path $env:USERPROFILE '.codex\goflow'
$goflowNode = (Get-Content -LiteralPath (Join-Path $goflowRuntime 'runtime-config.json') -Raw | ConvertFrom-Json).nodeExe
'{}' | & $goflowNode (Join-Path $goflowRuntime 'scripts\client.mjs') goflow_status
$goflowRequest = @{task='Add an ordinary string utility and tests';risk='low';complexity='simple'}
$goflowRequest | ConvertTo-Json -Depth 12 -Compress | & $goflowNode (Join-Path $goflowRuntime 'scripts\client.mjs') goflow_route
```

stdout is the actual MCP result; JSON in content[].text is the service response. Handle nonzero exit, isError, queued, and escalation_required honestly. Obtain submit/task/accept arguments from actual src/server.mjs or tools/list. Accept only after GPT reviews actual outputs and test evidence. Off mode blocks Go execution while permitting status/usage; explicit service/plugin disablement makes the client refuse.
