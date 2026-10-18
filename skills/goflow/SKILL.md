---
name: goflow
description: 在本地代码任务中协调 Codex GPT 与 OpenCode Go，查询共享订阅额度、控制任务队列，执行隔离测试、GPT 审核与失败升级；用户查看额度或切换模式、Go模型时也使用。
---

Codex 当前 ChatGPT 登录的 GPT 是主智能体：理解需求、拆任务、评估风险、审查并整合结果。GoFlow 的用户级 MCP 名为 `goflow`，安装目录为当前用户的 `~/.codex/goflow`（或安装时指定的 Codex 用户目录）。

先调用 `goflow_status`。用户可在自然语言中要求「关闭自动委派」「强制 GPT」「强制 Go」「恢复自动」，分别调用 `goflow_set_mode(off|gpt|go|auto)`。临时只对本任务指定模式时，传请求 `mode`，不要修改全局模式。强制 Go 仍不得绕过高风险、收费保护、测试或审查。

GPT 判断复杂度与风险后调用 `goflow_route`。清晰的重复代码修改、单元测试、普通局部功能优先 Go。架构决策、复杂算法、密钥/权限/认证/密码学、生产基础设施、数据删除、数据库迁移和难以限定影响的任务由当前 GPT 完成。遇到桥接器漏判时以 GPT 更保守的判断为准。

委派要传项目绝对路径、完整任务要求、`files`（完成及运行测试所需、已经存在的明确相对路径）和 `editableFiles`（允许修改或新建的明确相对路径），以及明确的测试 argv。现有可编辑文件必须同时列入 `files` 与 `editableFiles`；待新建文件只列入 `editableFiles`，不要先创建空占位。完全新建且不需要已有输入的功能包使用 `files: []`，例如 `files: []`、`editableFiles: ["tags.mjs", "tags.test.mjs"]`；需要读取已有 README 时，将 `README.md` 另列入 `files`。本公开版本仍必须显式提供 `tests`，包含待交付测试文件的 Node `--test` 命令，不能省略或传空数组。缺失的已有输入会被拒绝并提示修正声明，不自动创建文件或开始模型请求。不要把整个目录、环境文件、认证文件、用户配置或凭据放入上下文。桥接器创建独立快照，不读取未选择的源码、不共享原项目 `.git`、不让 Go 调用本机工具。Go 返回 JSON 文件补丁；自动验证目前支持 Node.js 内置 `node --test`，其他技术栈由 GPT 使用原授权范围内的工具完成开发与测试，不为了使用 Go 降低要求。

`goflow_submit` 返回 `review_required` 时，读取任务产物和 diff，GPT 必须审核实际代码与测试证据，检查需求覆盖、危险操作、测试被删除/削弱、依赖变更和影响范围。通过后调用 `goflow_accept(taskId, reviewer="GPT", reviewSummary=具体审核依据)`，它仅在原文件哈希未改变时应用声明允许的补丁。用户尚未授权应用的事项，保留可审核产物并遵守当前授权。

Go 首次失败后，桥接器只根据具体错误或测试失败修复，最多两次；`escalation_required` 后当前 GPT接手，沿用已有产物/日志查明原因并完成原任务。不得另起按量 API、换其他 provider、无依据循环、重复委派相同失败任务或让后台服务启动一个收费 GPT API。模型必须来自本次 `goflow_models` 的真实 `opencode-go/*` 列表；模型选择由桥接器动态完成。

收费保护未确认时停止 Go 推理，继续 GPT 能独立完成的工作并明确报告。必须由用户确认 Go 订阅当前有效、OpenCode Go 控制台 `Use balance` 关闭；不要自行运行 `billing-confirm`、修改收费保护或读取密钥。保护不能观察之后的账户、订阅或控制台设置变更。Go 记录注明配置指定 `opencode-go`、收费来源依据用户确认，当前 GPT 是 ChatGPT/Codex 订阅来源；返回的 token/cost 只是提供商报告，不能作为账单证明。

服务缺失、禁用、版本变化或配置隔离失败时，保留当前 GPT 工作流并报告限制。引用真实日志和测试结果；模拟测试不等于真实 Go 执行成功。

## V1.1 额度补充

使用 `goflow_usage` 查看官方账户的五小时、每周、每月快照及最后成功时间。約60秒缓存减少重复HTTP；不得称缓存是实时余额，不把0%显示值当作完全没有消费。API没有逐模型钱包字段时，明确说明只能读取共享账户窗口，模型差异由供应商权重决定。只对真实Go目录中的模型做路由；历史成功率和成本没有真实证据时保留未知。

低于80%正常；80%提醒，考虑质量达标的低消耗模型；95%暂停新请求并排队；100%/rate-limited停止相关Go请求直到官方窗口重置。95%一次许可只能在用户明确要求后通过本地CLI生成，绑定任务和模型、限一次及短有效期，仍不能绕过100%、费用、风险、测试或审核。必须说明渠道是OpenCode Go订阅，不能隐含启用Zen余额。

额度/授权/服务问题返回 `queued` 并说明类别，使用 `goflow_queue` 和 `goflow_resume` 延续原任务ID；不自动升高级GPT、不作为代码能力失败计数、不重新开任务绕过修复上限。用户明确选择GPT则使用当前ChatGPT/Codex订阅；复杂或高风险工作仍照原规则由GPT执行。后续任务触发额度刷新，符合原授权且输入未变的待执行任务可恢复，无需高占用常驻轮询。

查询凭据仅由私有helper在内存读取并发往固定官方额度URL；不自行打开auth文件、要求对话中粘贴Key、提取Cookie或ChatGPT令牌。新的隐藏本地输入采用Windows Credential Manager，额度缓存绑定实际推理凭据。API不返回Use balance时保留未知，不自行开启费用保护或更改账户设置。这个可信helper的用途是用户明确授权的额度查询，不能扩大为任意API密钥读取。


## 桌面本地入口 V1.1.2

默认用户目录的代码任务先用已安装GoFlow的scripts/client.mjs调用goflow_status，检查用户注册、插件显式禁用和本机固定服务路径；正式MCP工具可用时随后使用其中一个入口，当前聊天没有工具则继续用客户端。每次操作只调用一个入口。客户端参数只有原有10个tool名称，JSON参数从stdin提供，保留全部服务保护；不能指定别的配置、执行器、目录或授权。若使用自定义CODEX_HOME，客户端拒绝，使用该host的正式MCP或报告限制。

PowerShell调用示例：先从当前安装的非凭据runtime-config.json选择nodeExe字段；用明确的安装路径替换下面位置，不要打开auth文件或把API Key当参数。

```powershell
$goflowRuntime = Join-Path $env:USERPROFILE '.codex\goflow'
$goflowNode = (Get-Content -LiteralPath (Join-Path $goflowRuntime 'runtime-config.json') -Raw | ConvertFrom-Json).nodeExe
'{}' | & $goflowNode (Join-Path $goflowRuntime 'scripts\client.mjs') goflow_status
$goflowRequest = @{task='添加普通字符串工具和测试';risk='low';complexity='simple'}
$goflowRequest | ConvertTo-Json -Depth 12 -Compress | & $goflowNode (Join-Path $goflowRuntime 'scripts\client.mjs') goflow_route
```

stdout是实际MCP result，content[].text中的JSON是服务返回。CLI非0/isError/queued/escalation_required按真实证据处理；不得宣称成功。submit/task/accept等参数从实际src/server.mjs或tools/list取得，只有GPT审核实际产物与测试证据后才能accept。模式off禁止Go执行，但status/usage仍可查看；服务或插件显式disabled时客户端拒绝调用。
