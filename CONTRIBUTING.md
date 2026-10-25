# 参与开发

安装 Node.js 24、Visual Studio Build Tools（MSBuild/Roslyn），然后运行 `npm ci`、`npm run check`、`npm run check:public` 和 `npm test`。构建使用 `npm run build:plugin -- --portable`；安装指南和功能边界见 README 与 docs/compatibility.md。

请先提交带最小复现的 Issue 或小范围 PR。调度、审批、发送、存储和访问控制改动应有对应行为回归。测试必须使用临时数据与模拟 RPC/消息通道；不得读取贡献者真实任务、发送真实消息或为了通过测试关闭 Electron 沙箱、修改系统 ACL。

提交前检查日志、截图和 Git diff 是否包含本机路径、聊天 ID、凭据或任务内容。不要提交 data、缓存、运行时或分发包。素材与依赖必须记录来源、许可证和修改日期。贡献按 GPL-3.0-only 提交；第三方原件保留各自版权和许可声明。

维护者在合并前确认测试、跨机器验收范围和发布说明；安全问题使用 SECURITY.md 指定渠道。
