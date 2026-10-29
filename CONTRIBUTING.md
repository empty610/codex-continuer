# 参与开发

安装 Node.js 24、Visual Studio Build Tools（MSBuild/Roslyn），然后运行 `npm ci`、`npm run check`、`npm run check:public` 和 `npm test`。构建使用 `npm run build:plugin -- --portable`；安装指南和功能边界见 README 与 docs/compatibility.md。

请先提交带最小复现的 Issue 或小范围 PR。调度、审批、发送、存储和访问控制改动应有对应行为回归。测试必须使用临时数据与模拟 RPC/消息通道；不得读取贡献者真实任务、发送真实消息或为了通过测试关闭 Electron 沙箱、修改系统 ACL。

服务组件的职责和协作边界见 [Manager 职责拆分](docs/manager-responsibilities.md)。迁移、持久化和轮次协议分别维护，新增功能通过明确的组件接口接入。

提交前检查日志、截图和 Git diff 是否包含本机路径、聊天 ID、凭据或任务内容。不要提交 data、缓存、运行时或分发包。素材与依赖必须记录来源、许可证和修改日期。贡献按 GPL-3.0-only 提交；第三方原件保留各自版权和许可声明。

公开仓库 main 要求通过 PR 合入、通过 verify 检查并满足签名提交规则，禁止强推和删除；单人维护不强制第二位审批者。不要为绕过签名要求重写旧公开历史。可使用 GitHub 验证签名的网页合并流程，或维护者自行配置并登记签名密钥；自动化不会替维护者生成身份密钥。

Actions 仅允许所需组件且强制完整 SHA 固定。Dependabot 安全更新与 CodeQL 默认扫描在仓库设置中启用，版本更新计划位于 .github/dependabot.yml；该文件需进入默认分支后计划才生效。未来 Release 启用不可变发布，发布前完成所有附件并验证来源证明；本项目尚未提供 Windows Authenticode 签名，不能将普通 SHA-256 校验表当作发布者签名。

维护者在合并前确认测试、跨机器验收范围和发布说明；安全问题使用 SECURITY.md 指定渠道。
