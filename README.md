# GoFlow — Codex GPT × OpenCode Go

GoFlow is a local Windows collaboration workflow. Codex GPT, signed in with the current ChatGPT subscription, remains the lead agent and delegates clearly scoped, low-risk coding work to OpenCode Go. GPT handles requirements, risk assessment, complex work, code review, and recovery when the repair budget is exhausted.

This repository provides a user-level MCP service, a global skill, and supporting local-plugin files. The installer registers the user MCP and global skill; it is not a validated one-click Marketplace installation. It preserves existing Codex login, primary model, and permission settings.

## Supported environment

- Windows, Node.js 24 or later, Git, native Python, and **OpenCode CLI 1.18.15**.
- An active OpenCode Go subscription and existing official CLI authorization. Other OpenCode versions have not been reviewed for this implementation; a mismatch blocks Go work without downloading or upgrading anything.
- Automatic Go verification supports ordinary JavaScript with Node's built-in test runner. It does not install project dependencies or run npm lifecycle scripts. GPT handles other languages, complex frameworks, architecture, security, and high-risk work with the original requirements and necessary tests.
- Global rules can load across projects; this does not mean every programming language has automatic Go acceptance coverage.

## Installation

Review the source, then run from a local checkout. Installation does not download dependencies, run remote installation scripts, or require administrator access.

```powershell
powershell -NoProfile -File .\scripts\install.ps1
```

The installer locates `.codex` under `USERPROFILE`, discovers native Node/Git/Python executables on PATH, and prefers the actual OpenCode executable from the npm installation under APPDATA. It does not use `.cmd` or `.ps1` shims as worker executables. Paths may also be supplied explicitly:

```powershell
$options = @{
  CodexRoot = (Join-Path $env:USERPROFILE '.codex')
  NodeExe = (Get-Command node.exe -CommandType Application).Source
  GitExe = (Get-Command git.exe -CommandType Application).Source
  PythonExe = (Get-Command python.exe -CommandType Application).Source
  OpenCodeExe = (Join-Path $env:APPDATA 'npm\node_modules\opencode-ai\bin\opencode.exe')
}
& .\scripts\install.ps1 @options
```

Use `-OpenCodeExe` for a reviewed native executable installed under a custom npm prefix. Missing dependencies stop installation; install them yourself first. A Windows Store Python placeholder must be replaced with a real interpreter.

```text
<CodexRoot>/goflow/                     Runtime files and isolated task state
<CodexRoot>/goflow/runtime-config.json  Derived from a template with billing confirmations false
<CodexRoot>/goflow/.mcp.json            Generated absolute local MCP paths
<CodexRoot>/skills/goflow/              Global skill
<CodexRoot>/config.toml                 Only this installation's MCP marker block
<CodexRoot>/AGENTS.md                   Only this installation's global-rule marker blocks
```

The source contains only `.mcp.example.json` and `runtime-config.example.json`. Local paths are generated under the user directory, not written back to the repository. Updating an installation owned by this export preserves mode, billing confirmations, and other settings; explicitly supplied executable parameters update their paths. Existing directories, skills, or MCP registrations without this export's exact ownership marker are preserved and cannot be overwritten. Follow an older private deployment's own rollback instructions first.

Finish Go tasks and close old sessions before installation or update. Start a new Codex session afterward. `-CodexRoot` permits isolated installation validation but does not change Codex's default configuration root; configure that root separately according to Codex documentation when actually using it.

## Billing and credentials

**Both billing confirmations default to false on a new installation, blocking Go inference.** A model catalog or successful quota GET is not account confirmation.

The account owner must first confirm that the Go subscription is active and `Use balance` is off in the OpenCode Go console, then confirm in a local terminal:

```powershell
$runtime = Join-Path $env:USERPROFILE '.codex\goflow'
$node = (Get-Content (Join-Path $runtime 'runtime-config.json') -Raw | ConvertFrom-Json).nodeExe
& $node (Join-Path $runtime 'src\cli.mjs') billing-confirm --use-balance-is-off --go-subscription-is-active
```

This records the owner's confirmation. It does not change account controls or guarantee server-side billing for each request. Revoke confirmation before changing the account setting or subscription:

```powershell
& $node (Join-Path $runtime 'src\cli.mjs') billing-revoke
```

Models must come from the actual `opencode-go` catalog. There is no automatic switch to a metered API or another provider. GPT recovery uses the current Codex session, not an additional GPT API.

A trusted private helper uses existing Go authorization in local memory for GET requests to the fixed official HTTPS quota endpoint. Keys never belong in public output, model context, MCP arguments, source, ordinary configuration, or logs. The helper does not extract ChatGPT login tokens or browser cookies, and does not forward bearer authorization through redirects. The official OpenCode CLI still uses its existing authorization inside its own local process.

Existing official authorization storage is preserved. Optional Windows Credential Manager input is entered by the owner through hidden local terminal input; never paste a key into chat, an issue, or source code. A mismatch between Vault and the credentials used for Go inference blocks quota permission. This repository contains no real credentials, account usage records, or local logs.

## Workflow

At the start of coding work, GPT reads status, classifies the task, and selects explicit files. Go returns a constrained JSON patch; the bridge performs execution and tests in an isolated snapshot with worker model tools disabled. Passing tests still require GPT review of actual code, requirement coverage, and evidence before an original-file hash check and application.

`files` contains only existing inputs to read. `editableFiles` lists files that may be changed or created. Existing editable files appear in both lists; new files appear only in `editableFiles`, without empty placeholders. Entirely new packages may use `files: []`:

```json
{
  "directory": "<ABSOLUTE_PROJECT_DIRECTORY>",
  "task": "Implement a tag normalization utility and complete Node built-in tests.",
  "files": [],
  "editableFiles": ["tags.mjs", "tags.test.mjs"],
  "tests": [{"command": "<ABSOLUTE_NODE_EXE>", "args": ["--test", "tags.test.mjs"]}],
  "risk": "low",
  "complexity": "simple"
}
```

This public version **requires explicit, nonempty `tests`**. Missing input files are rejected before a model request, with guidance to list new outputs only in `editableFiles`. The bridge does not silently remove inputs or create placeholders. New outputs remain in the snapshot until GPT accepts them.

Actual code or test failures permit at most two evidence-based repairs after the first attempt, then the current GPT takes over. Do not create a new task to evade that limit. Quota, authorization, network, and local verification-environment failures are queued; they are not evidence of model coding failure and do not silently move large batches to GPT. Node permissions and static checks are local safeguards, not an OS sandbox for hostile code; unsupported or unverifiable work stays with GPT.

Natural-language mode requests include “disable automatic delegation,” “force GPT,” “force Go,” and “restore automatic mode.” Persistent values are `off/gpt/go/auto`. A temporary task preference must not change the global mode. Force Go never bypasses risk, billing, tests, or review.

```powershell
& $node (Join-Path $runtime 'src\cli.mjs') status
& $node (Join-Path $runtime 'src\cli.mjs') models
& $node (Join-Path $runtime 'src\cli.mjs') usage --force
& $node (Join-Path $runtime 'src\cli.mjs') queue
& $node (Join-Path $runtime 'src\cli.mjs') mode auto
```

Quota windows are shared across the account, not per-model wallets. Below 80% is normal; 80% prompts a warning while preserving quality; 95% stops automatic dispatch; 100% or an official rate limit always stops requests. An explicit owner authorization for a specific task permits only one subscription request and does not increase quota. Every request, including repairs, rechecks quota. Local locking cannot constrain spending from other devices.

## Disable and rollback

```powershell
& .\scripts\control.ps1 -Action disable
& .\scripts\control.ps1 -Action enable
& .\scripts\control.ps1 -Action rollback
```

Always pass the same `-CodexRoot` used during installation. Disabling changes the user MCP registration without forcibly terminating existing processes; start a new session. Enabling does not change billing confirmations.

Rollback removes only this export's MCP and global-rule marker blocks and archives its global skill under the runtime directory. Bytes outside owned blocks are preserved. Runtime files, task state, and logs remain for investigation; original configuration and authorization storage are not deleted. Finish tasks first: active or unexpired leases block rollback. Close old sessions and start a new one afterward. No old-machine backups or rollback to an older private V1.0 deployment are provided.

## Historical verification and limits

The sanitized release record reports **74 offline checks (63 Node + 11 Python)** passing in the original development environment, plus a **7/7 real Go smoke test**. The first real smoke took about **13.21 seconds**, not a performance guarantee. Fake workers and synthetic credential checks are not real model results.

An earlier simple edit was misclassified because of Windows path/TAP report handling, then completed by GPT. That issue received a fix and regression coverage. Separate real Go test-writing and ordinary development work has test, GPT-review, and post-application evidence. Only sanitized descriptions and runnable tests are published, not account records, balances, credentials, raw local logs, or old backups.

No physical Windows reboot was performed. New terminals and processes do not prove reboot behavior. A new-session check in the development environment used a one-time compatible Codex model override because the previous CLI default could be incompatible; the global default was not changed. These checks do not establish compatibility with every Windows version, model, or stack, or complete penetration/fault-injection coverage.

References: [Codex global rules](https://developers.openai.com/codex/guides/agents-md/), [Codex MCP](https://developers.openai.com/codex/mcp/), [OpenCode Go](https://opencode.ai/v2/docs/console/go/).

## Desktop integration supplement (V1.1.2)

The original deployment computer installed and enabled the personal plugin `goflow@goflow-local`. A real fresh desktop host discovered ten user MCP tools, ten independent plugin MCP tools, and the cached skill. This repository's installer still defaults to user MCP plus global rules/skill; personal Marketplace registration is an additional step, and the author's cache/configuration is not distributed. See [desktop integration](docs/DESKTOP.md).

The installer also installs the restricted `scripts/client.mjs` entry point so older local chats can call the same registered service before tool discovery refreshes. It rejects disabled services/plugins/project tools, custom configuration roots, and project command overrides; it introduces no extra API or hook. A risk regression corrected misclassification of explicit constraints such as “do not read credentials.” Full constraints still reach Go; actual credential work and explicit high-risk tasks remain with GPT.

## License

The original implementation is MIT licensed: [LICENSE](LICENSE). The upstream bridge notice remains in [LICENSE.upstream](LICENSE.upstream); retain it when using or distributing the corresponding upstream material.
