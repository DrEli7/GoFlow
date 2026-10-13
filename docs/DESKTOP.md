# 桌面默认分工与正式插件

GoFlow在本机的全局规则和技能中设置默认分工；模型本身不需要内置这段代码。Codex桌面宿主加载用户MCP或正式插件后，GPT即可查询额度、选择任务执行者、审查并接收Go产物。

本次原部署电脑已通过官方桌面自带Codex CLI安装并启用个人插件 `goflow@goflow-local`（插件包1.1.2），个人marketplace策略为 `INSTALLED_BY_DEFAULT`。真实新host查询发现用户MCP `goflow`、插件MCP `goflow_plugin`各10个工具，以及启用的cache技能。独立插件服务名避开现有用户服务名；所有入口引用同一个用户安装的server和共享状态，每项操作只选一个入口。[官方本地插件说明](https://developers.openai.com/plugins/build/plugins)

本仓库安装器部署用户MCP、全局规则、技能和受限本地客户端。它保留已有登录、主模型和权限，默认费用确认仍为false，不自动获取额外API。作者电脑的个人marketplace、cache、账户确认、日志和配置不随源码分发；不能把作者的安装记录当作新机器已经安装了正式marketplace插件。

若需在插件目录管理GoFlow，按官方本地marketplace流程创建个人catalog并正式安装。应只打包manifest、技能、说明和生成的无凭据MCP配置；MCP命令引用本机已安装的server，不把runtime/state/auth/备份整个复制到插件cache。plugin服务使用唯一名称 `goflow_plugin`，保留既有用户服务。此额外打包登记应在本机审查并验收，安装器不会擅自覆盖已有个人marketplace。

旧聊天的工具目录可能仍旧；客户端 `scripts/client.mjs` 会验证当前用户的服务注册、固定Node/server路径、插件与项目的明确禁用，再通过标准stdio调用同一个服务。只允许原有10个工具，JSON参数从stdin进入，不能覆盖命令、配置根、执行器或授权。自定义CODEX_HOME、项目命令覆盖、禁用或无法安全确认时拒绝，保留GPT原工作方式。关闭自动委派使用off模式，仍可查看状态和用量。[官方MCP配置说明](https://learn.chatgpt.com/docs/extend/mcp)

默认分工适用于该电脑、该Codex host的本地代码聊天：普通清晰任务优先Go；复杂算法、架构、安全、生产及范围不明任务由GPT完成；非代码闲聊不调用Go。普通Node测试仍是目前自动Go验证范围，其他栈由GPT保持原要求完成。全局覆盖文件、项目规则、不同配置根、云端或网页聊天可能改变范围，无法将自然语言规则当作每条消息绝对强制执行机制。[官方全局规则说明](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

实际风险回归修正了“不得读取凭据”这类明确安全约束被误判为凭据操作的问题。修正仅在风险分类时识别少量明确排除句，完整任务与限制仍原样发送Go；实际认证/密钥操作和显式high风险仍保留GPT。

验收区分真实Go任务、独立freshhost/CLI及桌面UI重启。实际原部署已有受保护客户端完成Go功能开发与测试、GPT审查接收的证据；独立freshhost能够发现正式插件工具。完整桌面UI重启与物理Windows重启不能用这些证据替代。原机器的更详细验收及回滚记录保存在本地，没有将日志中的个人路径或运行状态上传。

回滚本仓库用户MCP部署沿用README的控制工具。原机器新增桌面插件有独立拥有范围的回滚工具：只移除自己的plugin/marketplace登记、恢复本次规则和技能及路由补丁，不修改登录或其他配置；存在活动Go任务或后来修改时拒绝。完整撤销原机器GoFlow应先撤销新增桌面集成，再运行原部署的完整回滚，避免留下引用已卸载server的插件。请不要删除整个Codex配置目录。
