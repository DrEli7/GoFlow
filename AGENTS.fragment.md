<!-- GOFLOW BEGIN v1 -->
## Default local GoFlow collaboration rules

Use GoFlow for local coding tasks. Codex GPT signed in with the current ChatGPT subscription is the lead agent. Read the global `goflow` skill and call the user-level `goflow_status`, assess complexity/risk, then use `goflow_route`. Prefer `goflow_submit` for clear, low-risk repetitive edits, test writing, and ordinary local features. Keep architecture, complex algorithms, critical security, production systems, destructive work, and unclear scope with GPT. Noncoding work does not require GoFlow.

Use only models returned by the actual `opencode models opencode-go` catalog, never an automatic metered API or provider fallback. Stop Go inference if billing protection is unconfirmed, the service is unavailable/disabled, or platform/configuration isolation is unsupported; GPT may continue independent work and must report the limitation. Do not enable the billing guard until the user confirms an active Go subscription and Use balance off. Local confirmation is not a per-request billing guarantee. Preserve existing ChatGPT login and permissions; do not read, display, or copy credentials.

Send only explicitly selected credential-free files and execute in an independent snapshot. The lead agent, other workers, and original working tree must not write the same files concurrently. After the first Go failure, allow at most two evidence-based repairs, then let the current GPT take over; do not create new tasks to evade the limit. GPT must review actual code, requirement coverage, and test logs even when tests pass, then use `goflow_accept` to verify original hashes and apply allowed changes. Automatic bridge tests currently support Node's built-in runner; GPT performs required testing for other stacks without reducing requirements. Record model source, failure reasons, repair count, tests, and review evidence.

Natural-language modes: “disable automatic delegation” = off, “force GPT” = gpt, “force Go” = go, “restore automatic mode” = auto. A temporary request must not alter the global mode. Force Go cannot bypass risk, billing, tests, or review. Distinguish OpenCode Go usage from ChatGPT/Codex subscription usage; do not lower quality to save quota. Apply later project rules and user instructions with their normal precedence.
<!-- GOFLOW END v1 -->

<!-- GOFLOW QUOTA BEGIN v1.1 -->
## GoFlow V1.1 quota and account rules

Retain the collaboration, quality, isolation, tests, review, and repair limits above. At coding-task start, query shared quota with `goflow_usage` (approximately 60-second cache), and inspect `goflow_queue` as needed. Before each Go request, the bridge rechecks quota under a cross-project lock and execution lease. Status returns the latest snapshot, not a live official bill.

For every reliably identified window: below 80% is normal; at 80%, warn and consider a lower-consumption model only if quality is maintained; at 95%, stop new requests and queue unless the user explicitly permits one subscription request for that task; at 100% or an official rate limit, always stop. Quota shortage/uncertainty, authorization failures, and service failures are not model-capability failures. Do not silently move large batches to advanced GPT or another paid API. An explicit GPT choice uses the current ChatGPT/Codex subscription.

The three API windows are shared account data, not separate model wallets. Models must be in the real `opencode-go/*` catalog. Unverified model weights, capability, or remaining quota must remain unknown; do not assume unlimited use or invent success rates/costs. Preserve all functions and necessary tests.

After quota reset or service recovery, a task-triggered fresh query may restore permission. Check the project and original authorization, then `goflow_resume` the same task ID with its existing repair count. Do not automatically change account settings, run continuous heavy polling, or apply changes across projects implicitly. The user can disable GoFlow, change the Go model, or return to GPT at any time.

V1.1 permits only the trusted private local helper to reuse existing Go credentials in memory for a bearer GET to the fixed official HTTPS quota endpoint. Keys must never enter model context, MCP arguments, source, ordinary configuration, logs, or backups. New input comes from the owner through official local authorization or hidden terminal input; new GoFlow persistence uses Windows Credential Manager. Never extract ChatGPT tokens or browser cookies. Bind the quota cache to the actual inference credentials and invalidate it on changes. Successful quota retrieval does not establish that Use balance is off; billing protection remains mandatory.
<!-- GOFLOW QUOTA END v1.1 -->

<!-- GOFLOW DESKTOP BEGIN v1.1.2 -->
## Default local desktop entry point

Local coding chats load the global goflow skill and follow these rules without repeated prompting. When official tools are available, choose either the user goflow entry point or the installed goflow_plugin entry point for each operation. If an older chat lacks discovered tools but the registered user service is enabled, use the installed runtime's `scripts/client.mjs` to call that same MCP service, never bare OpenCode or another paid API. Under the default user directory, check status through this entry point, then usage and route; preserve isolation, tests, GPT review/accept, and repair limits.

The client rejects explicitly disabled services/plugins/tools, project command overrides, and mismatched paths. It does not bypass billing, permissions, or quota. Do not use this fallback with a nondefault CODEX_HOME; if official MCP is unavailable, stop Go calls under the existing rules. Noncoding chat does not use GoFlow.
<!-- GOFLOW DESKTOP END v1.1.2 -->
