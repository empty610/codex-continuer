# Windows 预览版便携包

此包包含运行时，适用于 Windows x64；仍需 Node.js 22.12+（推荐 24）以及已安装、登录且支持插件的 Codex。先完整解压，保留隐藏目录 `.agents`，在解压后的市场根目录运行：

```powershell
.\Install-Portable.ps1
# 可选：安装后显示挂件或启用随 Codex 启动
.\Install-Portable.ps1 -Open
.\Install-Portable.ps1 -Autostart
```

安装不会开启调度。重载 Codex 插件后再打开挂件；原聊天接续额外要求桌面附带 CLI 支持 `queue --thread --message`。可在插件目录运行 `node scripts/doctor.js --strict` 检查能力；此命令不启动模型，不发送消息。

从插件目录运行 `Start-Continuer.ps1` 打开原生挂件。浏览器凭据链接已停用；客户端先校验本地固定证书再发送凭据。不要上传数据目录、`tls-*.json`、访问令牌或未脱敏诊断日志。

卸载时，在实际安装的插件目录运行 `Uninstall-Plugin.ps1`，依次关闭自启动、停止服务、退出挂件并移除插件注册。任务数据保留在 `%LOCALAPPDATA%\CodexContinuer`，自定义 `CONTINUER_DATA_DIR` 时以该目录为准。卸载不会删除数据；旧版本升级前先停止其服务。

二进制包使用 GPL-3.0-only。Release 必须同时提供同版本的 `source.tar.gz`、`release.json` 和 `SHA256SUMS`；源码含编译、打包脚本及第三方原件。当前监听器未代码签名；SHA-256 校验用于检查一致性，不能代替发行者身份认证。具体限制见源码中的 `docs/compatibility.md`、`SECURITY.md` 和 `THIRD_PARTY_NOTICES.md`。
