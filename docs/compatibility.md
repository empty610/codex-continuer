# 支持范围与验收边界

当前版本为 Windows 预览版。主要验证环境为 Windows x64、Node.js 24、Electron 45.0.0；最低 Node 版本为 22.12。Windows ARM64、macOS、Linux 未完成发布验收，不声明支持。源码编译原生监听器需要 Visual Studio Build Tools 的 MSBuild/Roslyn，`vswhere` 可自动定位，也可设置 `CONTINUER_CSC`。

Codex app-server 协议基线为本机验证过的 CLI 0.153.2。不能据此保证所有后续版本兼容。RPC CLI 与桌面队列 CLI 可能是不同安装：分别用 `CODEX_BINARY`、`CODEX_QUEUE_BINARY` 指定真实可执行文件。工具会对队列命令进行能力检查；失败时停止发送，不降级为接管原聊天。

运行 `npm run doctor`（源码）或 `node scripts/doctor.js`（安装包）只调用 `--version` 和 `--help`。输出分别报告 app-server、plugin 和 queue 能力，不读取聊天，不发送消息；`--strict` 对核心能力缺失返回失败，缺少 queue 时不能使用原聊天接续。

现有证据包含隔离回归、实际 HTTP/MCP、隐藏 Electron 窗口以及历史真实队列投递。还没有完成真实账号完整耗尽/恢复周期、跨机器安装、Windows ARM64 和长期无人值守验收。CI 工作流可在远程仓库运行，本机通过不能写成托管 CI 已通过。

发布验收需记录系统、架构、Node/Codex/Electron 版本、安装/卸载、暂停/重启、额度过期、不确定发送处理与实测时长。真实账号耗尽及任何测试消息需要用户针对该测试明确授权，不通过自动化测试消耗真实额度。模型报告 done 仍不等于独立验收通过。
