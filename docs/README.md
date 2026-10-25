# 项目资料

## 当前说明与评估

| 文件 | 内容 |
| --- | --- |
| [开源准备](open-source-readiness.md) | 脱敏、许可证、源码交付、认证、兼容性及发布验收边界 |
| [支持范围](compatibility.md) | Windows x64 预览版、只读诊断、外部版本与尚未完成的验收 |
| [便携包安装](portable.md) | 二进制包安装、卸载及源码配套要求 |
| [按需加载与代码结构](loading-and-structure.md) | 隐藏视图停订阅、HTTP 模块拆分、冗余代码与一次性脚本清理；226 项回归 |
| [第三轮审查与修复](project-evaluation-round3.md) | 7 类问题已修复，213 项回归通过；授权、在途发送、异步轮次及中文输入 |
| [第二轮评估](project-evaluation-round2.md) | 6 项缺陷及详情缓存优化已修复，195 项回归通过；保留修复前证据 |
| [项目评估](project-evaluation.md) | 功能、架构、12 项评估与修复进展、测试及优化路线 |
| [运行、恢复与发布](operations.md) | 查询冷启动、存储恢复、资源上限、构建指纹与便携分发 |
| [额度恢复接续](quota-recovery-wake.md) | 当前原聊天队列接续方式、发送防重及验证边界 |
| [桌面内存排查](desktop-memory-audit.md) | 两轮窗口与监听器优化，以及测量口径 |
| [动画与拖动基准](animation-performance.md) | 动画、拖动、尺寸和转场的历史回归记录 |

## 界面参考

- [展开面板](images/panel.png)
- [紧凑仪表](images/gauge.png)

截图拍摄于 2026-10-22，仅作设计参考，不代表当前版本的全部状态与交互。

## 历史调查

- [旧 writer 冲突与重试问题](history/scheduler-recovery.md)
- [早期桌面桥接与定时通道验证](history/desktop-continuation-verification.md)

历史记录保留调查过程。当前原聊天接续方案以“额度恢复接续”为准。

## 本机生成文件

- `.cache/project-evaluation/`：最近评估的结果、进程快照和覆盖率日志。
- `.cache/history/`：较早的精简验证结果，不保留测试浏览器 profile。
- `.cache/rollback/`：历史任务状态和配置备份。
- `data/diagnostics/desktop-memory/`：内存快照、摘要与优化前代码备份。
- `data/diagnostics/cleanup-2026-10-24.json`：本次删除和移动清单。

这些目录可能包含本机路径或任务信息，不随插件打包。`data/state.json`、桌面配置、运行状态、日志和正在使用的 `desktop-profile` 仍位于原路径。
