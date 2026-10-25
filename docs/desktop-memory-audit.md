# 桌面层级与内存排查 · 2026-10-24

## 第二轮：移除常驻 PowerShell 运行时

将窗口枚举与监听循环编译为 12 KiB 的 .NET Framework 隐藏程序 `continuer-monitor.exe`。它同时支持自启动监听和跟随监测。旧的登录启动入口仍有效：PowerShell 脚本启动隐藏程序后退出；缺少编译产物时保留原脚本回退。禁用自启动的脚本同时识别新旧监听器。

在同一个未重启的 Electron 界面进程下测量，自启动监听器私有内存从 56.8 MiB 降至 16.6 MiB，直接减少约 40 MiB。界面与监听器总计从 245.3 MiB 到 195.6 MiB；约 9.5 MiB 的额外差额来自界面自身波动，不作为本次优化的固定收益。此前第一轮刚重启时的 321–327 MiB 也不能与这次已预热的界面直接对比。

真实桌面跟随测试持续约 34 秒，56 次输出全部识别到 Codex，私有内存为 12.7–15.8 MiB，句柄为 212–213。测试结束后关闭临时跟随进程。随后重新打开挂件以加载新跟随启动方式，保留普通窗口层级与原显示设置，后台任务服务没有重启。原始结果见本机 `data/diagnostics/desktop-memory/memory-round2-before.json`、`data/diagnostics/desktop-memory/memory-round2-after-same-widget.json`、`data/diagnostics/desktop-memory/native-follow-summary.json`。

78 项测试通过，包括编译并运行生产监听程序的集成测试：含空格及中文路径、重复实例互斥、桌面关闭/重开、启动失败与重试间隔、标准输出和错误日志。另通过 JavaScript、PowerShell 语法检查和分发构建。

下面保留第一轮记录，其中 PowerShell 常驻状态已由第二轮实现替代。

已更新源码、构建包和本机正在使用的 0.3.3 插件；仅重启桌面挂件与自启动监听器，后台服务和任务保持运行。

## 窗口层级

`show()` 原先每次显示时都会调用 `setAlwaysOnTop(true, 'floating')`。
现在移除此调用，并在创建窗口时明确设置 `alwaysOnTop: false`。
在实际桌面读取窗口扩展样式，确认 `WS_EX_TOPMOST` 为 false、窗口可见。
主动点击托盘或使用快捷键仍可正常聚焦面板。

## 内存来源和修复

1. 挂件处于独立模式时仍常驻 `follow-window.ps1`，未使用的监测器私有内存约 195.8 MiB。现在仅跟随模式启动，退出跟随模式立即结束；已结束进程的迟到事件不会改变新的模式或监测器。
2. 跟随监测每 600 ms 使用 `Get-Process` 管道枚举 Codex 的多个进程，并构造 PowerShell 回调；自启动监听器每 2 秒重复类似枚举。这增加了对象分配和运行时堆的占用。现在共用 `codex-windows.cs`，枚举实际原生窗口，复用回调及缓冲区，并及时释放查询进程的原生句柄。跟随循环也移至托管代码，避免逐次进入 PowerShell 管道。
3. 移除 `backgroundThrottling: false`，恢复隐藏窗口的默认后台节流。
4. Electron 仍包含主进程、GPU、网络服务和渲染进程。它们仍占用数百 MiB；本次没有更换桌面运行时。另观察到 4 个由 Codex 管理的 MCP 连接进程，合计约 80.4 MiB 私有内存，未擅自结束这些连接。

## 本机测量

单位为 MiB；使用 Windows 进程私有提交量（`PrivatePageCount`），不将可共享的工作集直接当作独占物理内存。

| 范围 | 修改前快照 | 修改后连续采样 |
| --- | ---: | ---: |
| 独立模式的跟随监测 | 195.8 | 0（不启动进程） |
| 自启动监听器 | 164.9 | 66.6–66.7 |
| Electron 四个进程 | 204.4 | 254.6–260.1 |
| 窗口及上述监听器合计 | 565.1 | 321.3–326.7 |

修改前是已运行较长时间的进程快照；修改后是重启后的采样，缓存、动画阶段和垃圾回收状态不同。尤其 Electron 的本次数值高于旧快照，因此不能把两组结果当作相同预热条件的严格基准。实际快照合计减少约 240 MiB（约 43%），主要来自删除闲置监测和降低监听器占用。

在修复后每 20 秒采样一次，持续约 2 分钟：监听器稳定，渲染进程在约 139–143 MiB 间波动，没有在这段观察期内持续增长。短时采样不能排除长期泄漏，也未进行 JS 堆快照分析。

另单独运行生产跟随脚本约 44 秒，72 次输出均识别到 Codex 并返回有效坐标；私有内存从 60.2 到 61.3 MiB，句柄从 604 到 577。结束后关闭测试进程，卡片保持用户原有的独立模式、位置和大小设置。

本地原始快照保存在 `data/diagnostics/desktop-memory/memory-before.json`、`data/diagnostics/desktop-memory/memory-after-samples.json`、`data/diagnostics/desktop-memory/follow-audit-summary.json`，不会打入分发包。安装前桌面源文件备份在 `data/diagnostics/desktop-memory/desktop-before-memory-fix/`。

## 验证

- 76 项 Node 测试通过，覆盖普通窗口层级、监测器启停、迟到退出事件、错误降级，以及已有的拖动、位置恢复和调度行为。
- JavaScript 语法检查通过；Windows PowerShell 5.1 成功编译并调用新的 C# 枚举器。
- 实际桌面窗口层级、独立模式无跟随进程、生产跟随脚本的连续输出均已核验。
- 源码与已安装桌面文件一致，后台服务 PID 保持不变。
