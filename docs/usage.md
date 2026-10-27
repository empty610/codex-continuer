# 功能与使用细节

**0.4.1-preview · Windows x64 预览版。** 开源准备、验证证据与剩余验收见 [开源准备记录](open-source-readiness.md)。使用范围见 [兼容性说明](compatibility.md)，参与开发和反馈见 [CONTRIBUTING.md](../CONTRIBUTING.md)、[SECURITY.md](../SECURITY.md)。本工具独立于 OpenAI、Rhine 和 Clash Verge，不代表这些项目官方产品。

一个可运行的本地 Codex 插件：监测账户额度、查看任务计划，并在额度恢复后继续指定工作。v0.3.3 基于 [Rhine 仓库的动画 SVG](https://github.com/empty610/rhine_ui_clash-verge/blob/a298150dbbd13a217bf48fe574f8fd27bfec2b80/src/assets/image/rhine-signal-loop.svg)，保留 60 秒的轮廓、飞行、行星、轨道形变动画。本地版本精简重复关键帧与叠加滤镜，将 48 个粒子动画合并为 3 组，并移除方形外框；不使用图片序列缓存或额外合成层。界面使用仓库中的暖灰、琥珀配色，支持明暗主题。

运行诊断、存储恢复、资源上限和发布流程见 [运行、恢复与发布](operations.md)。打开挂件或通过 MCP 冷启动读取状态时只进入查询模式；明确开启调度或继续工作后才执行。版本之外还显示内容指纹 buildId，避免同一版本号下的不同代码被混用。

收起后显示动态仪表：默认先显示**五小时额度及其重置倒计时**，每 12 秒切换一次，使用 1 秒的淡出、换值、淡入过渡；额度文字不再随装饰动画长时间隐藏，原版 SVG 的 60 秒动画时间线保持连续。倒计时每秒更新，数据未知或过期时显示「待同步」，重置时间已到则显示「待刷新」。这仅切换显示，续作调度仍需所有窗口的真实新额度样本达标。系统开启「减少动态效果」时关闭装饰动画与转场，但保留额度轮播。

桌面卡片默认 256 px，可在「工作策略与显示」中用滑块调为 160–420 px，也可按住 Ctrl 在卡片上滚动鼠标滚轮调整；大小会保存。**点击整张卡片展开，拖动任意位置移动**；桌面光标移动超过 6 个逻辑像素视为拖动，不触发展开。静止按住或轻微抖动不会移动卡片或保存新位置；失焦、取消或丢失指针捕获时结束拖动。展开/收起先淡出，在不可见时一次切换窗口尺寸和位置，再淡入；两种模式分别记住位置。

**右键卡片**可打开与系统托盘相同的菜单：打开面板、跟随 Codex、独立显示、重置位置、隐藏挂件或退出挂件。隐藏到托盘只隐藏界面；关闭按钮和“退出 Continuer”会保存状态、停止本工具的执行轮次与服务、结束跟随和自启动监听进程。已进入原聊天队列的消息仍不能撤回。

卡片采用普通窗口层级，其他应用可以正常覆盖它。独立模式不运行窗口跟随监测；切换到跟随模式时才启动监测，切回独立模式后结束。隐藏窗口使用 Chromium 默认的后台节流。窗口枚举和内存排查记录见 [桌面内存排查](desktop-memory-audit.md)。

源码构建使用 Visual Studio Build Tools 的 Roslyn 编译器确定性生成 `desktop/continuer-monitor.exe`，可通过 `CONTINUER_CSC` 指定编译器。自启动与跟随监测优先使用此隐藏程序，PowerShell 启动入口在交接后退出。便携包已经包含监听器，无需安装编译工具。源码环境仍保留 PowerShell 监测回退。

导入原聊天后，开启「额度监测」即开始等待耗尽与恢复。只有后台确认额度耗尽（某窗口已用 ≥100% 或服务端返回限制标记），随后获取所有窗口达标的新样本，才通过官方 `codex queue` 向原聊天排队发送一次「继续」。开启时额度正常、仅低于阈值、倒计时到零、额度未知或部分更新事件都不会直接触发。每次耗尽恢复周期只发送一次；暂停监测可取消尚未发送的消息。已进入 Codex 队列的消息不能由本工具撤回。

原聊天的「监测备注」仅本地保存，可留空，不作为新目标发送。每条记录受独立的「原聊天发送次数上限」约束（1–100 次，默认 20 次），累计次数在暂停、重新开启和重启后保留；到限自动停止，提高上限后需手动开启。原聊天进度和完成状态由原聊天负责，本工具不自动识别目标完成；「结束监测并移除」只移除监测记录。新建工作仍使用自己的执行目标、轮次上限和结构化完成结果。

此模式使用新版桌面端附带的 CLI 队列，不通过 `thread/resume` 接管原聊天，不需要模型定时检查额度，也不依赖活跃助手调用上下文。可用 `CODEX_QUEUE_BINARY` 指定支持 `queue` 的 CLI。原聊天及其执行端必须可用；队列接收成功不等于项目已完成。发送超时或重启时结果不明将停止自动重发，请检查原聊天后重新开启监测。当前旧版「等待会话占用」任务会迁移到监测模式，迁移不会把历史占用错误当作新额度耗尽。

原版 SVG 与像素数字相关内容按 GPL-3.0-only 使用，来源与完整许可证见 `THIRD_PARTY_NOTICES.md` 和 `LICENSE`；分发包包含对应源文件。

## 安装 Codex 插件（Windows）

源码安装需要 Windows x64、Node.js 22.12+（推荐 24）、Visual Studio Build Tools（MSBuild/Roslyn）、已安装并登录且支持插件的 Codex CLI。安装器先运行只读能力检查；`npm run doctor` 可单独检查。其他系统和架构尚未完成验收。

下载便携包的用户请按 [便携包安装说明](portable.md) 使用解压根目录的 `Install-Portable.ps1`，无需执行下面的源码构建步骤。

```powershell
cd .\codex-continuer
.\Install-Plugin.ps1
```

安装器下载锁定版本的 Electron 运行时，构建本地插件包，注册 `continuer-local` 市场并安装 `codex-continuer`，随后打开挂件。使用官方本地插件机制，不修改 Codex 安装文件。首次安装后，在 Codex 中重新加载插件或打开新聊天，再让 Codex「打开 Continuer 挂件」或「查看额度和任务进度」。

也可以双击 `Open-Widget.cmd` 直接打开，或运行 `npm run widget`。**Ctrl+Alt+C** 展开面板，点击减号收起成圆形仪表。收起后点击任意位置展开、拖动移动；展开后拖动顶部标题栏移动。两种状态分别记住位置，跟随模式保存相对 Codex 的偏移。系统托盘和工作策略中提供「重置挂件位置」。跟随模式在 Codex 位于前台时显示，挂件获得焦点时保持显示；其他应用在前台或 Codex 最小化时隐藏。

这是与 Codex 窗口联动的独立原生挂件，不是向 Codex 内部侧栏注入 UI。插件工具与挂件共用本地服务。隐藏到托盘仍保持运行；退出会停止后台调度和服务。退出标记会阻止普通 MCP 查询或自动启动重新拉起，需手动打开挂件恢复。Codex 托管的 MCP 工具连接可保持空闲，不执行后台调度。

### 随 Codex 启动

```powershell
.\Install-Plugin.ps1 -Autostart
# 或对当前源码启用
.\Enable-Autostart.ps1
# 关闭自动启动（不删除任务）
.\Enable-Autostart.ps1 -Disable
```

在当前用户的 Windows 登录启动项 `HKCU/Software/Microsoft/Windows/CurrentVersion/Run/CodexContinuer` 中注册隐藏监听器，每 2 秒检查 Codex 桌面主窗口。打开 Codex 时自动打开挂件，保留收起/展开状态且不抢焦点；手动退出挂件后监听器也会结束，直到手动重新打开才恢复；不会因为重新打开 Codex 就撤销退出操作。监听器不启动模型任务，也不把普通 ChatGPT 或 Codex CLI 当作桌面。无需管理员权限，不修改 Codex 快捷方式或安装文件。`data/autostart-status.json` 记录监听器状态；卸载插件前用上述禁用命令移除启动项。

### 直接选择对话

「我的工作」会自动读取本机 Codex 对话，按最近更新时间排列，可刷新、加载更多，并记住选中项。选择后点击「加入我的工作」，可填写仅本地保存的监测备注。已有项目目录自动读取，加入后保持暂停。当前桌面页面的前台对话 ID 未通过这里使用的接口公开，因此需要从列表选择一次，不将最近更新时间当作当前页面身份。

同一聊天同时只允许一个导入操作；挂件和 MCP 共用这项保护。重复请求会提示已添加或正在添加，不会创建第二条记录，也不会重置已有监测。读取失败后可以重新导入，不同聊天可以同时添加。

插件工具：`continuer_open_widget`、`continuer_status`、`continuer_list_sessions`、`continuer_import_session`、`continuer_task_action`、`continuer_update_settings`。MCP 仅可查询、打开挂件、暂停状态导入、暂停/结束任务、关闭持续工作和关闭调度。创建任务、恢复执行、开启监测以及修改执行上限/额度策略必须由用户在挂件中操作；旧的 create/resume/enabled=true 工具调用会被拒绝，模型提供“已确认”字段也不能绕过。

本机构建产物在 `dist/marketplace/plugins/codex-continuer`，runtime 保留本项目数据目录与 Node 路径。`npm run build:plugin -- --portable` 另生成 `dist/portable-marketplace`，不绑定本机绝对路径，默认使用目标电脑的 `%LOCALAPPDATA%\CodexContinuer`，需安装 Node。两种包都带 portable 插件清单和 CLI 兼容清单；白名单不包含任务历史、凭据和缓存。构建在暂存目录完成并验证 SHA-256 清单后才替换正式包，避免旧文件残留。

```powershell
npm ci
node node_modules/electron/install.js
npm run build:plugin
node scripts/verify-artifact.js
codex plugin list --json
# 在实际安装的插件目录卸载：关闭自启动、服务和挂件，保留任务数据
.\Uninstall-Plugin.ps1
```

插件机制依据：[官方 Plugins 文档](https://developers.openai.com/plugins/build/plugins)。挂件架构参考：[Codex Whale](https://github.com/Yang-huai406/Codex-Whale-Public)，未复制该项目的实现或素材。

## 启动

启动入口统一使用原生挂件，浏览器凭据链接已停用。后台服务无第三方 npm 运行时依赖；原生挂件另外使用 Electron。

Windows 双击 `Start.cmd`，或在 PowerShell 中运行：

```powershell
cd .\codex-continuer
.\Start-Continuer.ps1
```

启动脚本以查询模式启动本地 HTTPS 服务并打开原生挂件；客户端固定校验服务证书后才发送凭据。`-NoBrowser` 参数保留兼容，仅启动查询模式服务；`node plugin/control.js url` 已停用且不会输出凭据。

也可前台运行：

```powershell
codex login
npm start
```

CLI 已登录时不必重复登录。普通 Windows 用户环境即可运行，无需以管理员身份启动。若在受限工具沙箱内出现 `Could not find home directory`，请从正常用户终端启动；不要复制或上传登录凭据。

停止后台服务：

```powershell
.\Stop-Continuer.ps1
```

停止会关闭调度并请求中断本工具管理的当前轮次；重新打开后需开启调度。强制关闭进程或意外断线时，原运行任务进入「需要关注」，不会自动再启动。

## 使用

1. 新建工作：填写名称、现有项目的绝对目录、目标和验收标准。创建后即排队执行。
2. 或导入已有本地 Codex 会话：填写可选备注，导入后保持暂停；开启额度监测，确认耗尽并恢复后向原聊天发送固定「继续」。备注不发送，原聊天中的最新要求继续有效。
3. 为需要长期推进的任务开启「持续工作」。等待额度的任务在所有返回窗口恢复到阈值后自动继续。
4. 新建工作的进度来自 Codex 步骤计划；没有计划显示「无计划」。原聊天显示「进度请在原聊天查看」，不推断完成度。
5. 新建工作详情显示目标、计划、输出和执行轮次；原聊天详情显示备注、已排队发送次数和监测状态。
6. 设置中调整轮询周期（10–90 秒）、恢复阈值（1–99%）、直接执行上限（1–100 轮）和原聊天发送上限（每条记录累计 1–100 次）。
7. 新建工作完成后清除记录；原聊天需选择「结束监测并移除」，该操作不确认原聊天工作已完成。原始 Codex 对话和项目文件保留。

全局调度开关控制新轮次和新的续作消息。新建工作的「暂停」请求中断本工具当前轮次；原聊天的「暂停监测」不打断原聊天执行，也不能撤回已排队的消息。修改上限时，已经开始排队的消息可能完成；已确认排队次数仍会计入累计。

## 真实接入

通过 `codex app-server` 的 stdio JSON-RPC 连接本机 Codex，不抓取网页、不手工读取登录 token。沿用 CLI 默认模型与登录状态。

- `account/rateLimits/read` + `account/rateLimits/updated`：读取与订阅额度；优先读取 `rateLimitsByLimitId`，兼容旧字段。
- `thread/list`、`thread/read`：分页列出、读取本地会话。
- `thread/start`、`thread/resume`、`turn/start`：新建与续作。
- `turn/plan/updated`、`item/*`、`turn/completed`：计划与活动更新。
- `turn/interrupt`：暂停当前轮次。

接口依据：[官方 Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。实现枚举值以本机 Codex CLI 0.153.2 生成的协议为准，服务端未来变更可能需要适配。

## 调度规则与边界

- 单进程串行执行，调度锁防止重叠检查导致重复启动；同端口只允许一个服务。
- 轮次通知和审批仅接受当前聊天、当前运行轮次的消息；旧轮次、重复完成、缺少轮次 ID 和失效连接的消息不会改写当前任务。启动响应前的通知暂存后按返回 ID 筛选；缓存超过 256 条或 4 MiB 时中断并要求人工检查。
- 剩余额度取 `100 - usedPercent`。所有返回的额度桶与窗口均需达标；这是保守策略，可能因不相关模型桶耗尽而延后任务。
- 额度样本超过 90 秒、未知或连接失败时不运行。重置时间已到仍需新样本确认，不能推断额度恢复。
- 轮询周期最多 90 秒；旧版本超过上限的配置会在加载时收紧至 90 秒。旧监测目标转存为本地备注，旧发送计数迁移为 sentCount；新增发送上限首次沿用原配置 maxRounds，之后两个上限独立。读取或迁移不会开启监测。
- 额度类失败按协议错误码判断，至少退避 60 秒；其他失败需人工处理。
- 新建工作每轮要求结构化 `done / continue / blocked` 结果；`continue` 且存在工具活动才可自动开始下一轮。结果不明确、需要输入、没有工具活动或达到轮次上限均停止。原聊天只监测额度并发送消息，不读取这类完成结果。
- `done` 由模型报告，不是独立验证器。验收要求应写入目标，用户可检查输出后手动标记完成。
- 使用 `workspace-write` 沙箱和 `on-request` 审批策略。支持可完整审阅的命令审批；文件变更、空命令、未展示的权限字段及其他交互会拒绝并暂停，需用户到原 Codex 手工处理。
- 只主动管理本工具创建或导入的任务；不会接管未导入的聊天。其他 Codex 客户端的实时进度不保证跨进程同步；不应在两个客户端同时执行同一会话。
- 电脑和本地服务必须保持运行，关机或休眠期间不能续作。启用「随 Codex 启动」后，重新打开 Codex 会恢复挂件与本地服务。

## 演示与验证

```powershell
.\Start-Continuer.ps1 -Demo
# 通过启动器进入 4318 端口；全部为模拟数据，不调用模型
npm test
npm run check
npm run check:public
node scripts/probe.js
```

演示页提供「模拟耗尽 / 模拟恢复」，可以实际操作等待、续作、暂停和完成流程。真实与演示状态分别保存在 `data/state.json` 与 `data/demo-state.json`。

`scripts/probe.js` 只读额度并检查会话列表，不发送模型请求。已在本机账号验证额度与会话读取；自动调度通过协议替身测试与浏览器演示验收，未对用户真实项目启动续作测试。

`node scripts/smoke-plugin.js <插件安装目录>` 检查实际插件包的 MCP 握手、工具发现与只读状态查询。`data/widget-status.json` 记录原生挂件进程、就绪状态和是否检测到 Codex 窗口，便于诊断；它不包含聊天内容。

## 数据与部署

- 默认仅绑定 `127.0.0.1`，固定校验 HTTPS 服务证书，并校验 Host、Origin、写请求头和随机 Bearer 令牌；所有 `/api/` 接口均需认证，不提供跨站访问。信任边界、私钥文件和凭据重置见 SECURITY.md。
- 任务、计划、输出、最近 300 条活动与 240 个额度样本保存在项目 `data/`。写入使用临时文件再替换。
- 状态带 schema 版本和格式校验，保留上次有效备份；损坏文件不会被空状态覆盖。保存失败会停止后续自动调度与发送，页面提供重试保存或明确恢复备份，恢复后调度保持关闭。
- 状态与 SSE 仅传任务摘要，目标、计划和输出在打开详情时读取；实时连接最多 16 个，对持续背压的客户端断开重连。最多新建/导入 100 条记录，会话选择最多 300 项。
- 应用日志达到 1 MiB 时轮转并保留 3 份副本，原生重定向日志每 60 秒检查。`/api/health` 给出当前构建、存储、挂件、自启动和退出诊断；数据目录说明以运行诊断为准。
- 输出片段在内存中即时更新，以固定 250 毫秒窗口合并保存；连续输出不会无限延后写盘。最终回复、任务状态、审批、暂停和队列发送记录仍立即保存，正常停止服务时会补写暂存输出。强制结束进程可能丢失尚未保存的短时输出片段。
- 增量与完整回复统一只保留末尾最多 16000 个 UTF-16 单元，截断时详情会提示查看原 Codex 会话。完成状态在截断前独立解析，摘要最多保留前 2000 个 UTF-16 单元；旧版本保存的超长输出会在加载时收缩。
- 凭据继续由 Codex 管理；应用不存储 API key。项目路径、目标与本轮输出可能包含私人内容，请勿公开 `data/`。
- `PORT` 可指定服务端口；`CONTINUER_PORT` 指定插件与挂件连接的端口；`CONTINUER_DATA_DIR` 指定数据目录。`CODEX_BINARY` 可指向真实 Codex 可执行文件（Windows 使用 `.exe`，不要填写 `.cmd`）。Windows 启动脚本固定使用默认端口。

```text
server/rpc.js       stdio 客户端与 CLI 进程生命周期
server/manager.js   工作状态机、调度、事件、审批
server/policy.js    额度与结果判定
server/store.js     原子持久化
server/index.js     本地 HTTP API 与 SSE
server/demo.js      独立演示适配器
public/            完整控制台与一体化挂件界面
plugin/            本地 MCP 工具、服务与挂件启动
desktop/           Electron 外壳、托盘、Codex 窗口跟随
scripts/build-plugin.js  白名单打包与本地市场生成
tests/             调度、策略、插件协议与窗口布局测试
docs/              当前文档、评估、界面参考与历史记录（索引：docs/README.md）
.cache/            评估结果、历史验证记录与回滚备份，不打包
data/              运行数据；排查材料集中在 data/diagnostics/，不打包
dist/marketplace/  当前本地插件市场与构建包，安装和更新时使用
```
