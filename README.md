# GoFlow — Codex GPT × OpenCode Go

GoFlow 是 Windows 本地的 Codex 协作工作流：保留当前 ChatGPT 订阅登录的 Codex GPT 作为主智能体，把范围清晰、低风险的普通编程任务委派给 OpenCode Go。GPT 负责需求、风险判断、复杂工作、代码审核和失败接手。

这个仓库提供用户级 MCP、全局技能及本地插件配套文件。安装器注册用户 MCP 和全局技能；它不是已经验收的 Marketplace 一键安装产品。不会替换 Codex 登录、主模型或已有权限设置。

## 支持范围

- Windows；Node.js 24 或更高版本；Git；本机原生 Python；**OpenCode CLI 1.18.15**。
- OpenCode Go 订阅和已有官方 CLI 授权。OpenCode 其它版本未经这份实现审查，版本不匹配时停止 Go 工作，不自动下载或升级。
- 当前自动 Go 测试支持普通 JavaScript 与 Node 内置测试，不安装项目依赖、不运行 npm 生命周期脚本。其他语言、复杂测试框架、架构、安全和高风险工作留给当前 GPT，保留原需求及必要测试。
- 在任意项目都可加载全局分工规则；这不表示全部编程语言都已自动 Go 验收。

## 安装

先阅读本仓库代码，再从本地检出的仓库目录运行。安装器不下载依赖，不执行远程安装脚本，不要求管理员权限。

```powershell
powershell -NoProfile -File .\scripts\install.ps1
```

安装器从 `USERPROFILE` 找到 `.codex`，发现 PATH 上的 Node/Git/Python 原生 `.exe`，并优先从 APPDATA 下的 npm 安装寻找 OpenCode 的实际 `.exe`。它不会把 `.cmd` 或 `.ps1` shim 作为 worker 执行程序。所有路径也可以显式传入：

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

自定义 npm 前缀或不同安装方式可通过 `-OpenCodeExe` 指定已审核的本地原生文件。没有找到可用依赖时安装会停止，需本人先安装依赖。Windows Store 的 Python 占位程序须换成实际解释器。

安装位置：

```text
<CodexRoot>/goflow/                 本地运行文件及独立任务状态
<CodexRoot>/goflow/runtime-config.json  从 false 费用确认模板派生
<CodexRoot>/goflow/.mcp.json         生成的绝对本机 MCP 路径
<CodexRoot>/skills/goflow/           全局技能
<CodexRoot>/config.toml             仅自己的 MCP 标记区块
<CodexRoot>/AGENTS.md               仅自己的全局规则标记区块
```

源仓库只含 `.mcp.example.json` 和 `runtime-config.example.json`。安装后路径生成在用户目录，不把个人路径写回仓库。已有本导出版本的配置会保留模式、费用确认及其他设置；显式传入的执行程序参数用于更新对应路径。没有本导出版本精确拥有标记的现存目录、技能或同名 MCP 会被保留并拒绝覆盖。旧私有部署应按原说明关闭或回滚，不能由这个安装器暗中覆盖。

安装或更新前先结束 Go 任务并关闭旧会话。完成后新启动 Codex，加载全局规则和 MCP。`-CodexRoot` 可用于隔离安装验证；它本身不会改变 Codex 的默认配置根，若要实际运行该根须按 Codex 官方说明设置对应配置根。

## 费用与凭据

**新安装的两项费用确认默认 false，Go 推理默认被阻止。** 模型目录存在或额度 GET 成功都不能代替账户确认。

本人先在 OpenCode Go 控制台确认订阅有效、`Use balance` 已关闭，再在本机终端确认：

```powershell
$runtime = Join-Path $env:USERPROFILE '.codex\goflow'
$node = (Get-Content (Join-Path $runtime 'runtime-config.json') -Raw | ConvertFrom-Json).nodeExe
& $node (Join-Path $runtime 'src\cli.mjs') billing-confirm --use-balance-is-off --go-subscription-is-active
```

这记录本人确认，不会修改账户开关，也不是服务端无超额保证。设置或订阅变化时先撤销：

```powershell
& $node (Join-Path $runtime 'src\cli.mjs') billing-revoke
```

Go 模型只从实际 `opencode-go` 目录选择，不能自动改用按量 API 或其它 provider。GPT 接手使用当前 Codex 会话，GoFlow 不调用额外 GPT API。

可信私有 helper 在本机内存使用现有 Go 认证，只向固定官方 HTTPS 额度接口发 GET；公开结果、模型上下文、MCP 参数、源码、普通配置和日志不接收 Key。它不提取 ChatGPT 登录令牌或浏览器 Cookie，不把 Bearer 转发到重定向地址。官方 OpenCode CLI 仍需在自己的本地进程内使用已有认证。

现有官方认证存储保持原样。可选 Windows Credential Manager 输入仅通过本人本地终端隐藏输入进行，不要把 Key 粘贴到聊天、Issue 或源码。Vault 与实际 Go 推理凭据不匹配会拒绝额度许可。仓库不提供真实凭据、账户使用记录或本机日志。

## 使用方式

开始代码任务时，GPT 按全局技能读取状态、分类并派发明确文件。Go 返回受限 JSON 补丁；所有本地执行和测试由桥接器在独立快照中完成，worker 模型工具禁用。测试通过后仍需 GPT 查看实际代码、需求覆盖及测试，再核对原文件哈希后应用。

真实代码或测试失败最多追加两次有依据的修复，再交当前 GPT；不得新建任务规避次数。额度、认证、网络和本地验证环境故障进入队列，不假称 Go 编程能力失败，不默认把大量普通任务转给 GPT。Node 权限和静态检查是本地防护，不是恶意代码的 OS 沙箱；不受支持或无法可靠检查的代码留给 GPT。

可以说「关闭自动委派」「强制 GPT」「强制 Go」「恢复自动模式」。持久模式对应 `off/gpt/go/auto`；只要求本轮切换时不要改变全局模式。强制 Go 仍不能绕过风险、费用、测试和审核。

```powershell
& $node (Join-Path $runtime 'src\cli.mjs') status
& $node (Join-Path $runtime 'src\cli.mjs') models
& $node (Join-Path $runtime 'src\cli.mjs') usage --force
& $node (Join-Path $runtime 'src\cli.mjs') queue
& $node (Join-Path $runtime 'src\cli.mjs') mode auto
```

额度是账户共享窗口，不是每模型独立钱包。低于 80% 正常；80% 提醒但保持质量；95% 停止自动派发；100% 或官方限额始终停止。本人针对具体任务的临时许可只允许一次订阅请求，不提高额度。每次请求含修复都会重新核查额度；本地锁不能限制其它设备的消费。

## 关闭和撤销

```powershell
& .\scripts\control.ps1 -Action disable
& .\scripts\control.ps1 -Action enable
& .\scripts\control.ps1 -Action rollback
```

如果安装用了自定义根，每次都传同一个 `-CodexRoot`。`disable` 关闭用户 MCP 注册，已有进程不会被强制终止；重新开会话生效。恢复 `enable` 不改变费用确认。

`rollback` 仅移除本导出的 MCP 与全局规则标记区块，并把本导出的全局技能归档到其运行目录。区块外原字节保留，运行文件、任务状态和日志留在原处供本人调查；不删除原配置、不修改认证存储。撤销前须完成 Go 任务，活跃或未到期的租约会阻止撤销；完成后关闭旧会话并新启动。本仓库没有旧机器备份，也不提供退回旧私有 V1.0 的操作。

## 验证记录与限制

脱敏发布摘要：原开发环境的 **74 项离线检查（63 项 Node + 11 项 Python）** 通过，另有 **7/7 真实 smoke** 通过，首次真实 Go smoke 约 **13.21 秒**。耗时依模型与环境变化，不是性能保证。离线 fake worker 和合成凭据检查不会被记为真实模型成绩。

此前简单修改曾被桥接器 Windows 路径/TAP 报告识别问题误判，随后由 GPT 接手；该问题已修复并新增回归。真实 Go 测试编写和普通功能开发另有实际测试、GPT 审核和应用后测试。发布仓库仅提供脱敏说明和可运行测试，不上传本机原始日志、账号、余额、凭据或旧备份。

没有执行物理 Windows 重启。新终端和新进程验证不能替代物理重启。Codex CLI 的原默认模型可能不兼容，开发环境的新会话验收用过单次兼容模型覆盖，未擅改全局默认模型。当前测试不能证明所有 Windows 版本、模型或技术栈都已兼容，也不代表全部安全边界已经由渗透或故障注入测试验证。

官方参考：[Codex 全局规则](https://developers.openai.com/codex/guides/agents-md/)、[Codex MCP](https://developers.openai.com/codex/mcp/)、[OpenCode Go](https://opencode.ai/v2/docs/console/go/)。

## 许可证

GoFlow 原创实现采用 MIT，见 [LICENSE](LICENSE)。上游桥接方案的声明保留为 [LICENSE.upstream](LICENSE.upstream)；使用或分发对应上游内容时保留其许可声明。
