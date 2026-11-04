# Verification scope

This GitHub source export was independently checked without publishing local account records, task databases, keys, configuration backups, or research clones. The results below are historical release evidence, not new claims created by the English documentation revision.

## Offline controls and security checks

The original Windows, Node.js 24, Python 3.13 run recorded:

- 63 passing Node control, quota, and MCP tests; no failures or skips.
- 11 passing private Python quota-helper tests. Authentication, HTTP, missing authorization, and unusual responses used fake data without reading a real account.
- Additional fake-credential echo, invalid-date, and percentage-boundary review.

Git, independent snapshots, Node tests, cross-process locks, isolated workers, and stdio communication ran for real. Offline checks did not start actual OpenCode inference or contact the quota endpoint.

## Exported installer checks

Fifteen real checks ran under an independent temporary Codex user root, including dependency discovery, billing confirmations initially off, derived configuration, preservation on reinstall, no duplicate registrations, fresh-process status, disable, enable, and rollback.

After rollback, the original temporary `config.toml` and `AGENTS.md` bytes matched exactly. Actual Codex configuration, global rules, and GoFlow runtime settings were unchanged. The installer also found and rejected another unreviewed OpenCode version. Discovery now prefers the native CLI from the official npm installation while strictly requiring 1.18.15.

## Real GoFlow request

The installed service's real MCP stdio completed `status → usage → models → route → submit → accept`. The independent slugify baseline failed first. Actual `opencode-go/deepseek-v4-flash` produced a first-attempt patch in about 13.21 seconds; all seven independent tests passed without a repair request.

GPT reviewed the complete candidate, requirements, and results before acceptance. Original hashes were checked and only the declared source changed; tests were unchanged. The applied project then passed all seven restricted tests. `examples/slugify` contains this source and its tests without the original Git history or personal request paths.

The validating session did not directly expose GoFlow tool names, so it used the registered service's actual stdio protocol. This proves the bridge/model path worked, not that the session had automatically refreshed tool discovery.

## Remaining boundaries

- No physical computer reboot was performed; fresh processes are not equivalent.
- Real Windows Credential Manager key writing was not tested because existing authorization worked and no new key copy was needed.
- Automatic Go verification covers self-contained JavaScript and Node built-in tests; GPT must run appropriate checks for other stacks.
- Local locks and quota prechecks are not provider-side reservations and cannot constrain other devices.
- The quota API is not formally stable/documented. Unconfirmed fields or authorization pause Go rather than inventing a precise balance.
- Reported pricing fields are not proof of extra payment. Synthetic success rates and local estimates are not official bills.

The repository does not claim complete platform, framework, or security acceptance coverage.
