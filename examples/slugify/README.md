# 已验收的 Go 补丁示例

本示例的七项测试先由 GPT 编写。真实 OpenCode Go 首次生成实现，在独立快照中通过测试；GPT 审核后，通过 MCP 接收并再次验证。

从此目录执行本地受限测试，不发起模型请求：

```powershell
node --permission --allow-fs-read=. --test-isolation=none --test-reporter=tap --test test/slugify.test.mjs
```

这里仅保留源码和测试，不包含原项目的 Git、任务 ID、用量、授权或个人路径。
