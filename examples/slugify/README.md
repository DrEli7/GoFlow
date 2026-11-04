# Accepted Go patch example

GPT wrote these seven tests first. A real OpenCode Go request generated the implementation on its first attempt and passed in an isolated snapshot. GPT reviewed it, accepted it through MCP, and verified the applied result.

Run the restricted local tests from this directory; this does not make a model request:

```powershell
node --permission --allow-fs-read=. --test-isolation=none --test-reporter=tap --test test/slugify.test.mjs
```

Only source and tests are included, without the original project's Git data, task ID, usage, authorization, or personal paths.
