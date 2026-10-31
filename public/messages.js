// Stable IDs own both translations; literal source text is never a lookup key.
export const messages = Object.freeze({
  "ui.start_monitoring_after_adding": {
    "zh": "加入后开始监测",
    "en": "Start monitoring after adding"
  },
  "ui.import_monitoring_choice_hint": {
    "zh": "不勾选则保持暂停。后台调度暂停时，请先开启调度。",
    "en": "Leave unchecked to add paused. If background scheduling is paused, enable it to begin monitoring. "
  },
  "ui.chat_added_monitoring_enabled": {
    "zh": "已加入工作并开启监测",
    "en": "Chat added with monitoring enabled"
  },
  "ui.request_failed": {
    "zh": "请求失败",
    "en": "Request failed"
  },
  "ui.overview": {
    "zh": "概览",
    "en": "Overview"
  },
  "ui.work": {
    "zh": "工作任务",
    "en": "Work"
  },
  "ui.quota_monitor": {
    "zh": "额度监测",
    "en": "Quota monitor"
  },
  "ui.activity_log": {
    "zh": "活动日志",
    "en": "Activity log"
  },
  "ui.settings": {
    "zh": "设置",
    "en": "Settings"
  },
  "ui.just_now": {
    "zh": "刚刚",
    "en": "Just now"
  },
  "ui.min_ago": {
    "zh": "{p0} 分钟前",
    "en": "{p0} min ago"
  },
  "ui.h_ago": {
    "zh": "{p0} 小时前",
    "en": "{p0} h ago"
  },
  "ui.reset_time_unknown": {
    "zh": "恢复时间未知",
    "en": "Reset time unknown"
  },
  "ui.waiting_for_fresh_quota_confirmation": {
    "zh": "等待额度刷新确认",
    "en": "Waiting for fresh quota confirmation"
  },
  "ui.until_reset": {
    "zh": "{p0}后重置",
    "en": "{p0} until reset"
  },
  "ui.d_h": {
    "zh": "{p0} 天 {p1} 小时",
    "en": "{p0} d {p1} h"
  },
  "ui.h_min": {
    "zh": "{p0} 小时 {p1} 分钟",
    "en": "{p0} h {p1} min"
  },
  "ui.min": {
    "zh": "{p0} 分钟",
    "en": "{p0} min"
  },
  "ui.new_work": {
    "zh": "新建工作",
    "en": "New work"
  },
  "ui.refresh_quota": {
    "zh": "刷新额度",
    "en": "Refresh quota"
  },
  "ui.unknown": {
    "zh": "数据未知",
    "en": "Unknown"
  },
  "ui.remaining": {
    "zh": "% 剩余",
    "en": "% remaining"
  },
  "ui.waiting_for_account_data": {
    "zh": "等待账户数据",
    "en": "Waiting for account data"
  },
  "ui.used": {
    "zh": "已用 {p0}%",
    "en": "Used {p0}%"
  },
  "ui.day_quota": {
    "zh": "{p0} 天额度",
    "en": "{p0} day quota"
  },
  "ui.hour_quota": {
    "zh": "{p0} 小时额度",
    "en": "{p0} hour quota"
  },
  "ui.short_term_quota": {
    "zh": "短期额度",
    "en": "Short-term quota"
  },
  "ui.long_term_quota": {
    "zh": "长期额度",
    "en": "Long-term quota"
  },
  "ui.active_work": {
    "zh": "进行中的工作",
    "en": "Active work"
  },
  "ui.work_items": {
    "zh": " 个工作",
    "en": " work items"
  },
  "ui.working_toward_project_goals": {
    "zh": "正在推进项目目标",
    "en": "Working toward project goals"
  },
  "ui.ready_for_the_next_step": {
    "zh": "准备好继续下一步",
    "en": "Ready for the next step"
  },
  "ui.runs_one_at_a_time": {
    "zh": "串行执行",
    "en": "Runs one at a time"
  },
  "ui.continuous_work_enabled": {
    "zh": "持续工作已开启",
    "en": "Continuous work enabled"
  },
  "ui.work_items_2": {
    "zh": "个工作",
    "en": "work items"
  },
  "ui.resumes_after_quota_recovery": {
    "zh": "额度恢复后自动接续",
    "en": "Resumes after quota recovery"
  },
  "ui.keep_work_moving": {
    "zh": "让工作持续向前",
    "en": "Keep work moving"
  },
  "ui.scheduling_paused": {
    "zh": "自动调度已暂停",
    "en": "Scheduling paused"
  },
  "ui.monitor_available_quota_and_resume_work_when": {
    "zh": "监测可用额度，在合适的时刻接续每一项工作。",
    "en": "Monitor available quota and resume work when ready."
  },
  "ui.current_turns_continue_new_turns_wait_until": {
    "zh": "当前轮次继续执行，新轮次将等待你重新开启调度。",
    "en": "Current turns continue. New turns wait until scheduling is enabled."
  },
  "ui.scheduling": {
    "zh": "自动调度",
    "en": "Scheduling"
  },
  "ui.all_work": {
    "zh": "全部工作",
    "en": "All work"
  },
  "ui.continuous_work": {
    "zh": "持续工作",
    "en": "Continuous work"
  },
  "ui.no_work_here_yet": {
    "zh": "这里还没有工作",
    "en": "No work here yet"
  },
  "ui.add_a_project_goal_to_make_progress": {
    "zh": "添加项目目标，让每一次额度都用在进展上。",
    "en": "Add a project goal to make progress with available quota."
  },
  "ui.completed_work_is_removed_automatically_approvals_wait": {
    "zh": "已完成的工作自动清除；需授权时等待你的决定",
    "en": "Completed work is removed automatically; approvals wait for you"
  },
  "ui.continuation_policy": {
    "zh": "持续工作策略",
    "en": "Continuation policy"
  },
  "ui.enabled": {
    "zh": "已启用",
    "en": "Enabled"
  },
  "ui.paused": {
    "zh": "已暂停",
    "en": "Paused"
  },
  "ui.monitor_quota": {
    "zh": "持续监测额度",
    "en": "Monitor quota"
  },
  "ui.every": {
    "zh": "每 ",
    "en": "Every "
  },
  "ui.sec_with_live_updates": {
    "zh": " 秒同步，实时接收更新",
    "en": " sec, with live updates"
  },
  "ui.preserve_work_when_quota_is_low": {
    "zh": "额度不足，保留现场",
    "en": "Preserve work when quota is low"
  },
  "ui.save_the_chat_and_wait_for_all": {
    "zh": "保存会话，等待所有额度窗口恢复",
    "en": "Save the chat and wait for all quota windows to recover"
  },
  "ui.resume_according_to_work_mode": {
    "zh": "恢复后，按模式接续",
    "en": "Resume according to work mode"
  },
  "ui.resume_at": {
    "zh": "剩余额度 ≥ ",
    "en": "Resume at ≥ "
  },
  "ui.resume_percent_suffix": {
    "zh": "% 时自动续作",
    "en": "% "
  },
  "ui.direct_work_stops_when_completed_blocked_or": {
    "zh": "直接执行：完成、阻塞或达到 ",
    "en": "Direct work stops when completed, blocked, or after "
  },
  "ui.rounds_original_chats": {
    "zh": " 轮时停止。原聊天：",
    "en": " rounds. Original chats: "
  },
  "ui.each_record_can_send_up_to": {
    "zh": "每条记录累计最多发送 ",
    "en": "Each record can send up to "
  },
  "ui.messages": {
    "zh": " 次。",
    "en": "  messages."
  },
  "ui.adjust_policy": {
    "zh": "调整工作策略 ",
    "en": "Adjust policy "
  },
  "ui.recent_activity": {
    "zh": "最近活动",
    "en": "Recent activity"
  },
  "ui.all": {
    "zh": "全部 ",
    "en": "All "
  },
  "ui.activity_will_appear_here_after_your_first": {
    "zh": "开始第一项工作后，活动会记录在这里。",
    "en": "Activity will appear here after your first work item."
  },
  "ui.quota_usage_trend": {
    "zh": "额度使用趋势",
    "en": "Quota usage trend"
  },
  "ui.the_trend_appears_after_at_least_two": {
    "zh": "收集到至少两个额度样本后显示趋势",
    "en": "The trend appears after at least two samples"
  },
  "ui.short_term_quota_usage": {
    "zh": "短期额度 · 已使用比例",
    "en": "Short-term quota · Usage"
  },
  "ui.recent_quota_usage_trend": {
    "zh": "近期已使用额度趋势",
    "en": "Recent quota usage trend"
  },
  "ui.demo_simulated_quota_and_work_no_real": {
    "zh": "演示模式 · 模拟额度与任务，不执行真实项目",
    "en": "Demo · Simulated quota and work; no real projects run"
  },
  "ui.simulate_exhaustion": {
    "zh": "模拟耗尽",
    "en": "Simulate exhaustion"
  },
  "ui.simulate_recovery": {
    "zh": "模拟恢复",
    "en": "Simulate recovery"
  },
  "ui.run_codex_login_confirm_cli_is_available": {
    "zh": "。请先在终端运行 codex login，确认 CLI 可用后刷新。额度未知时不会自动执行。",
    "en": ". Run codex login, confirm CLI is available, then refresh. Unknown quota prevents automatic execution."
  },
  "ui.approval_required": {
    "zh": "操作等待授权",
    "en": "Approval required"
  },
  "ui.full_approval_details_are_not_loaded_refresh": {
    "zh": "完整授权内容尚未加载，请刷新重试；加载完成后可允许操作。",
    "en": "Full approval details are not loaded. Refresh and review them before allowing the operation."
  },
  "ui.allow_once": {
    "zh": "允许本次",
    "en": "Allow once"
  },
  "ui.decline": {
    "zh": "拒绝",
    "en": "Decline"
  },
  "ui.sec": {
    "zh": " 秒",
    "en": " sec"
  },
  "ui.watcher_running": {
    "zh": "监听器运行中",
    "en": "Watcher running"
  },
  "ui.off": {
    "zh": "已关闭",
    "en": "Off"
  },
  "ui.watcher_stopped_or_status_unknown": {
    "zh": "监听器未运行或状态未知",
    "en": "Watcher stopped or status unknown"
  },
  "ui.set_when_and_how_your_work_resumes": {
    "zh": "按照你的工作节奏，安排每一次继续。",
    "en": "Set when and how your work resumes."
  },
  "ui.when_off_no_new_turns_start_current": {
    "zh": "关闭后不再启动新轮次，正在进行的轮次会继续。",
    "en": "When off, no new turns start. Current turns continue."
  },
  "ui.quota_sync_interval": {
    "zh": "额度同步间隔",
    "en": "Quota sync interval"
  },
  "ui.seconds_with_live_updates_and_periodic_checks": {
    "zh": "10–90 秒，接收实时事件并定期校验；额度有效期仍为 90 秒。",
    "en": "10–90 seconds, with live updates and periodic checks. Quota samples expire after 90 seconds."
  },
  "ui.resume_threshold": {
    "zh": "恢复阈值",
    "en": "Resume threshold"
  },
  "ui.all_returned_quota_windows_must_meet_this": {
    "zh": "所有返回的额度窗口剩余比例达到此值，才允许启动。",
    "en": "All returned quota windows must meet this remaining percentage before starting."
  },
  "ui.direct_work_turn_limit": {
    "zh": "直接执行轮次上限",
    "en": "Direct-work turn limit"
  },
  "ui.applies_to_new_work_resume_manually_after": {
    "zh": "仅用于新建工作的自动执行；到限等待手动继续。",
    "en": "Applies to new work. Resume manually after reaching the limit."
  },
  "ui.turns": {
    "zh": " 轮",
    "en": " turns"
  },
  "ui.original_chat_message_limit": {
    "zh": "原聊天发送次数上限",
    "en": "Original-chat message limit"
  },
  "ui.counts_are_cumulative_per_record_and_survive": {
    "zh": "每条监测记录累计计数，暂停或重新开启不清零。到限停止；提高上限后手动开启监测。",
    "en": "Counts are cumulative per record and survive pausing. Monitoring stops at the limit; raise it and enable monitoring manually to resume."
  },
  "ui.messages_2": {
    "zh": " 次",
    "en": " messages"
  },
  "ui.local_connection": {
    "zh": "本地连接",
    "en": "Local connection"
  },
  "ui.uses_local_codex_sign_in_and_the": {
    "zh": "使用本机 Codex 登录状态与默认模型，凭据由 Codex CLI 管理。",
    "en": "Uses local Codex sign-in and the default model. Credentials are managed by Codex CLI."
  },
  "ui.work_runs_in_the_project_directory_sandbox": {
    "zh": "工作在项目目录沙箱内进行；请求额外权限时需单独批准。",
    "en": "Work runs in the project directory sandbox; extra permissions require approval."
  },
  "ui.connected": {
    "zh": "已连接",
    "en": "Connected"
  },
  "ui.disconnected": {
    "zh": "未连接",
    "en": "Disconnected"
  },
  "ui.save_settings": {
    "zh": "保存设置",
    "en": "Save settings"
  },
  "ui.the_local_service_must_stay_running_work": {
    "zh": "本地服务需持续运行，关机或休眠期间不执行。关闭页面不影响后台服务；原生挂件提供系统托盘；随 Codex 启动：",
    "en": "The local service must stay running; work pauses during shutdown or sleep. Closing the page keeps the service running. The native widget provides a system tray. Start with Codex : "
  },
  "ui.build": {
    "zh": "构建 ",
    "en": "Build "
  },
  "ui.protocol": {
    "zh": " · 协议 ",
    "en": " · Protocol "
  },
  "ui.diagnostics": {
    "zh": "运行诊断",
    "en": "Diagnostics"
  },
  "ui.local_service_disconnected": {
    "zh": "本地服务断开",
    "en": "Local service disconnected"
  },
  "ui.demo_connection": {
    "zh": "演示连接",
    "en": "Demo connection"
  },
  "ui.local_service_connected": {
    "zh": "本地服务已连接",
    "en": "Local service connected"
  },
  "ui.waiting_for_codex_connection": {
    "zh": "等待 Codex 连接",
    "en": "Waiting for Codex connection"
  },
  "ui.local_service_disconnected_reconnecting": {
    "zh": "本地服务断开，正在重连",
    "en": "Local service disconnected; reconnecting"
  },
  "ui.demo_simulated_data": {
    "zh": "演示模式 · 模拟数据",
    "en": "Demo · Simulated data"
  },
  "ui.codex_app_server_connected": {
    "zh": "Codex App Server 已连接",
    "en": "Codex App Server connected"
  },
  "ui.waiting_for_codex_cli_connection": {
    "zh": "等待连接 Codex CLI",
    "en": "Waiting for Codex CLI connection"
  },
  "ui.every_sec": {
    "zh": "每 {p0} 秒同步 · {p1}",
    "en": "Every {p0} sec · {p1}"
  },
  "ui.updated_at": {
    "zh": "更新于 {p0}",
    "en": "Updated at {p0}"
  },
  "ui.quota_data_unknown": {
    "zh": "额度数据未知",
    "en": "Quota data unknown"
  },
  "ui.work_overview": {
    "zh": "工作概览",
    "en": "Work overview"
  },
  "ui.track_your_quota_and_keep_projects_moving": {
    "zh": "掌握每一份额度，让每一个项目稳步向前。",
    "en": "Track your quota and keep projects moving."
  },
  "ui.my_work": {
    "zh": "我的工作 ",
    "en": "My work "
  },
  "ui.import_chat": {
    "zh": "导入会话",
    "en": "Import chat"
  },
  "ui.your_goals_progress_and_next_steps_in": {
    "zh": "目标、进度、下一步，在这里井然有序。",
    "en": "Your goals, progress, and next steps in one place."
  },
  "ui.track_account_quota_and_when_work_can": {
    "zh": "同步账户可用额度，准确掌握下一次出发的时间。",
    "en": "Track account quota and when work can resume."
  },
  "ui.account_quota": {
    "zh": "账户额度",
    "en": "Account quota"
  },
  "ui.primary_quota_window": {
    "zh": "主要额度窗口",
    "en": "Primary quota window"
  },
  "ui.secondary_quota_window": {
    "zh": "次要额度窗口",
    "en": "Secondary quota window"
  },
  "ui.quota_unavailable": {
    "zh": "额度暂不可用",
    "en": "Quota unavailable"
  },
  "ui.connect_a_signed_in_codex_cli_to": {
    "zh": "连接已登录的 Codex CLI 后显示真实额度。",
    "en": "Connect a signed-in Codex CLI to see your quota."
  },
  "ui.reset_times_come_from_the_server_and": {
    "zh": "重置时间来自服务端，仅作参考。系统会读取恢复后的新样本，再决定是否继续工作。",
    "en": "Reset times come from the server and are estimates. Fresh quota samples determine when work resumes."
  },
  "ui.shows_the_latest_events_export_up_to": {
    "zh": "显示最近 50 条活动；导出可获取最多 300 条。",
    "en": "Shows the latest 50 events. Export up to 300."
  },
  "ui.export_logs": {
    "zh": "导出日志",
    "en": "Export logs"
  },
  "ui.time": {
    "zh": "时间",
    "en": "Time"
  },
  "ui.type": {
    "zh": "类型",
    "en": "Type"
  },
  "ui.activity": {
    "zh": "活动",
    "en": "Activity"
  },
  "ui.success": {
    "zh": "成功",
    "en": "Success"
  },
  "ui.attention": {
    "zh": "关注",
    "en": "Attention"
  },
  "ui.info": {
    "zh": "信息",
    "en": "Info"
  },
  "ui.no_activity_yet": {
    "zh": "暂无活动记录",
    "en": "No activity yet"
  },
  "ui.scheduling_activity_appears_here_after_you_add": {
    "zh": "添加工作后，调度记录将显示在这里。",
    "en": "Scheduling activity appears here after you add work."
  },
  "ui.close": {
    "zh": "关闭",
    "en": "Close"
  },
  "ui.import_codex_chat": {
    "zh": "导入 Codex 会话",
    "en": "Import Codex chat"
  },
  "ui.choose_a_local_chat_to_manage_monitoring": {
    "zh": "选择需要管理的本机会话。导入后先保持暂停。",
    "en": "Choose a local chat to manage. Monitoring stays paused after import."
  },
  "ui.loading_chats": {
    "zh": "正在读取会话…",
    "en": "Loading chats…"
  },
  "ui.untitled_chat": {
    "zh": "未命名会话",
    "en": "Untitled chat"
  },
  "ui.select": {
    "zh": "选择",
    "en": "Select"
  },
  "ui.no_chats_available_to_import": {
    "zh": "没有可导入的会话",
    "en": "No chats available to import"
  },
  "ui.load_more": {
    "zh": "加载更多",
    "en": "Load more"
  },
  "ui.only_monitored_chats_support_editing_continuation_messages": {
    "zh": "仅原聊天监测支持编辑续作消息",
    "en": "Only monitored chats support editing continuation messages."
  },
  "ui.wait_for_the_full_work_details_to": {
    "zh": "请等待完整工作详情加载后再编辑",
    "en": "Wait for the full work details to load before editing."
  },
  "ui.edit_continuation_message": {
    "zh": "编辑续作消息",
    "en": "Edit continuation message"
  },
  "ui.monitor_original_chat_quota": {
    "zh": "监测原聊天额度",
    "en": "Monitor original chat quota"
  },
  "ui.storage_recovered_scheduling_remains_off": {
    "zh": "恢复完成，调度保持关闭",
    "en": "Storage recovered; scheduling remains off"
  },
  "ui.quota_synced": {
    "zh": "额度已同步",
    "en": "Quota synced"
  },
  "ui.connection_failed_check_the_notice": {
    "zh": "连接未成功，请查看提示",
    "en": "Connection failed; check the notice"
  },
  "ui.scheduling_enabled": {
    "zh": "自动调度已开启",
    "en": "Scheduling enabled"
  },
  "ui.monitoring_enabled": {
    "zh": "额度监测已开启",
    "en": "Monitoring enabled"
  },
  "ui.monitoring_ended_and_removed": {
    "zh": "监测已结束并移除",
    "en": "Monitoring ended and removed"
  },
  "ui.monitoring_paused": {
    "zh": "额度监测已暂停",
    "en": "Monitoring paused"
  },
  "ui.work_queued": {
    "zh": "工作已加入队列",
    "en": "Work queued"
  },
  "ui.marked_complete": {
    "zh": "已标记完成",
    "en": "Marked complete"
  },
  "ui.pause_requested": {
    "zh": "已请求暂停",
    "en": "Pause requested"
  },
  "ui.wait_for_the_full_approval_details_to": {
    "zh": "请先等待完整授权内容加载",
    "en": "Wait for the full approval details to load"
  },
  "ui.simulated_quota_exhausted": {
    "zh": "模拟额度已耗尽",
    "en": "Simulated quota exhausted"
  },
  "ui.simulated_quota_recovered": {
    "zh": "模拟额度已恢复",
    "en": "Simulated quota recovered"
  },
  "ui.work_created": {
    "zh": "工作已创建",
    "en": "Work created"
  },
  "ui.chat_imported_monitoring_stays_paused": {
    "zh": "会话已导入，监测保持暂停",
    "en": "Chat imported; monitoring stays paused"
  },
  "ui.continuation_message_saved": {
    "zh": "续作消息已保存",
    "en": "Continuation message saved"
  },
  "ui.settings_saved": {
    "zh": "设置已保存",
    "en": "Settings saved"
  },
  "ui.could_not_connect_to_the_local_service": {
    "zh": "本地服务连接失败，正在自动重连。请确认 npm start 仍在运行。",
    "en": "Could not connect to the local service. Reconnecting. Check that npm start is still running."
  },
  "ui.waiting_to_sync": {
    "zh": "待同步",
    "en": "Waiting to sync"
  },
  "ui.awaiting_refresh": {
    "zh": "待刷新",
    "en": "Awaiting refresh"
  },
  "ui.d": {
    "zh": "{p0}天 ",
    "en": "{p0}d "
  },
  "ui.data_could_not_be_saved_or_loaded": {
    "zh": "数据保存或读取失败，自动调度已停止：",
    "en": "Data could not be saved or loaded. Scheduling stopped: "
  },
  "ui.retry_save_scheduling_stays_off": {
    "zh": "重试保存（调度保持关闭）",
    "en": "Retry save (scheduling stays off)"
  },
  "ui.restore_backup_pause_all_records": {
    "zh": "恢复上次备份（暂停全部记录）",
    "en": "Restore backup (pause all records)"
  },
  "ui.a_copy_of_the_current_file_is": {
    "zh": "恢复会保留当前主文件副本；恢复后请先核对原聊天与项目状态。",
    "en": "A copy of the current file is kept. Check your original chats and projects after restoring."
  },
  "ui.read_only_mode_work_starts_only_after": {
    "zh": "当前为查询模式，尚未恢复自动调度。开启调度或明确继续工作后才会执行。",
    "en": "Read-only mode. Work starts only after you enable scheduling or explicitly resume work."
  },
  "ui.enter_an_absolute_path_to_an_existing": {
    "zh": "填写本机现有目录的绝对路径，Codex 将在此目录工作。",
    "en": "Enter an absolute path to an existing local directory; Codex will work there."
  },
  "ui.create_work": {
    "zh": "创建工作 {p0}",
    "en": "Create work {p0}"
  },
  "ui.create_and_queue": {
    "zh": "创建并加入队列",
    "en": "Create and queue"
  },
  "ui.cancel": {
    "zh": "取消",
    "en": "Cancel"
  },
  "ui.give_your_project_a_clear_goal_continuer": {
    "zh": "给项目一个明确目标，Continuer 帮你接续进展。",
    "en": "Give your project a clear goal; Continuer helps you keep going."
  },
  "ui.work_name": {
    "zh": "工作名称\n        ",
    "en": "Work name\n        "
  },
  "ui.example_improve_knowledge_base_search": {
    "zh": "例如：完善个人知识库搜索",
    "en": "Example: Improve knowledge base search"
  },
  "ui.example_finish_knowledge_base_search": {
    "zh": "例如：完成个人知识库搜索",
    "en": "Example: Finish knowledge base search"
  },
  "ui.project_directory": {
    "zh": "项目目录",
    "en": "Project directory"
  },
  "ui.work_goal": {
    "zh": "工作目标",
    "en": "Work goal"
  },
  "ui.goal_and_acceptance_criteria": {
    "zh": "目标与验收标准",
    "en": "Goal and acceptance criteria"
  },
  "ui.describe_the_desired_features_and_acceptance_criteria": {
    "zh": "描述需要完成的功能与验收标准…",
    "en": "Describe the desired features and acceptance criteria…"
  },
  "ui.describe_the_desired_changes_and_how_to": {
    "zh": "描述需要完成的功能和验证方式…",
    "en": "Describe the desired changes and how to verify them…"
  },
  "ui.keep_working_after_quota_recovers": {
    "zh": "持续工作，额度恢复后自动继续\n      ",
    "en": "Keep working after quota recovers\n      "
  },
  "ui.queued_after_creation_work_starts_when_quota": {
    "zh": "创建后加入队列；额度充足且调度开启时开始执行。",
    "en": "Queued after creation. Work starts when quota is sufficient and scheduling is enabled."
  },
  "ui.work_is_queued_after_creation_extra_permissions": {
    "zh": "创建后进入执行队列。需要额外权限时会等待你确认。",
    "en": "Work is queued after creation. Extra permissions require your approval."
  },
  "ui.codex_chat": {
    "zh": "Codex 对话",
    "en": "Codex chat"
  },
  "ui.add_to_my_work": {
    "zh": "加入我的工作",
    "en": "Add to my work"
  },
  "ui.continuation_message_optional": {
    "zh": "续作消息（可选）\n      ",
    "en": "Continuation message (optional)\n      "
  },
  "ui.leave_blank_to_send_continue_example_run": {
    "zh": "留空发送：继续；例如：优先完成测试，遇到阻塞时说明原因",
    "en": "Leave blank to send: Continue. Example: Run tests first; explain any blockers."
  },
  "ui.sent_to_the_original_chat_after_each": {
    "zh": "额度恢复时发送给原聊天；每次恢复使用此消息。",
    "en": "Sent to the original chat after each quota recovery."
  },
  "ui.monitoring_note_optional_local_only": {
    "zh": "监测备注（可选，仅本地保存）\n      ",
    "en": "Monitoring note (optional, local only)\n      "
  },
  "ui.placeholder_example_project_to_resume": {
    "zh": "placeholder=\"例如：待继续的项目名称\"",
    "en": "placeholder=\"Example: Project to resume\""
  },
  "ui.monitoring_stays_paused_after_adding": {
    "zh": "加入后保持暂停。",
    "en": "Monitoring stays paused after adding. "
  },
  "ui.monitoring_stays_paused_after_import": {
    "zh": "导入后保持暂停。",
    "en": "Monitoring stays paused after import. "
  },
  "ui.after_confirmed_quota_exhaustion_and_recovery_the": {
    "zh": "确认额度耗尽并恢复后，先检查原聊天最新回复；上次指令后已有完整回复则跳过，否则发送一次自定义续作消息（留空发送“继续”）。仍在回复或无法确认状态时等待重试；备注不发送，项目结果请在原聊天确认。",
    "en": "After confirmed quota exhaustion and recovery, the latest reply is checked first. If the last instruction already received a complete reply, sending is skipped; otherwise one custom continuation message is sent (blank sends “Continue”). Active or unknown replies wait for a retry. Notes are not sent; check project results in the original chat."
  },
  "ui.monitoring_note_local_only": {
    "zh": "监测备注：{p0}（仅本地保存）",
    "en": "Monitoring note: {p0} (local only)"
  },
  "ui.not_provided": {
    "zh": "未填写",
    "en": "Not provided"
  },
  "ui.queued_messages": {
    "zh": "已排队发送 {p0} / {p1} 次",
    "en": "Queued {p0} / {p1} messages"
  },
  "ui.executed_turns": {
    "zh": "已执行 {p0} / {p1} 轮",
    "en": "Executed {p0} / {p1} turns"
  },
  "ui.check_progress_in_the_original_chat": {
    "zh": "进度请在原聊天查看",
    "en": "Check progress in the original chat"
  },
  "ui.pause_monitoring": {
    "zh": "暂停监测",
    "en": "Pause monitoring"
  },
  "ui.pause": {
    "zh": "暂停",
    "en": "Pause"
  },
  "ui.enable_monitoring": {
    "zh": "开启监测",
    "en": "Enable monitoring"
  },
  "ui.continue": {
    "zh": "继续",
    "en": "Continue"
  },
  "ui.end_monitoring_and_remove": {
    "zh": "结束监测并移除",
    "en": "End monitoring and remove"
  },
  "ui.mark_complete": {
    "zh": "标记完成",
    "en": "Mark complete"
  },
  "ui.continuation_message_optional_2": {
    "zh": "续作消息（可选）",
    "en": "Continuation message (optional)"
  },
  "ui.leave_blank_to_use_the_default_message": {
    "zh": "留空时按当前语言发送“继续”或“Continue”。",
    "en": "Leave blank to use the default message for the current language."
  },
  "ui.the_saved_message_is_used_for_future": {
    "zh": "从下次发送起使用保存后的消息；已排队的消息不会被更改。",
    "en": "The saved message is used for future sends. Already queued messages stay unchanged."
  },
  "ui.save_message": {
    "zh": "保存消息",
    "en": "Save message"
  },
  "ui.queued": {
    "zh": "排队中",
    "en": "Queued"
  },
  "ui.waiting_for_quota": {
    "zh": "等待额度",
    "en": "Waiting for quota"
  },
  "ui.starting": {
    "zh": "准备中",
    "en": "Starting"
  },
  "ui.running": {
    "zh": "进行中",
    "en": "Running"
  },
  "ui.pausing": {
    "zh": "暂停中",
    "en": "Pausing"
  },
  "ui.needs_attention": {
    "zh": "需要关注",
    "en": "Needs attention"
  },
  "ui.failed": {
    "zh": "执行失败",
    "en": "Failed"
  },
  "ui.completed": {
    "zh": "已完成",
    "en": "Completed"
  },
  "ui.awaiting_approval": {
    "zh": "等待授权",
    "en": "Awaiting approval"
  },
  "ui.monitoring": {
    "zh": "监测中",
    "en": "Monitoring"
  },
  "ui.waiting_for_delivery": {
    "zh": "等待发送通道",
    "en": "Waiting for delivery"
  },
  "ui.waiting_for_chat": {
    "zh": "等待会话",
    "en": "Waiting for chat"
  },
  "ui.no_plan": {
    "zh": "无计划",
    "en": "No plan"
  },
  "ui.monitoring_note": {
    "zh": "监测备注",
    "en": "Monitoring note"
  },
  "ui.see_details_for_the_full_note": {
    "zh": "更多内容见详情",
    "en": "See details for the full note"
  },
  "ui.view_details": {
    "zh": "查看详情",
    "en": "View details"
  },
  "ui.view_in_original_chat": {
    "zh": "原聊天中查看",
    "en": "View in original chat"
  },
  "ui.details": {
    "zh": "详情",
    "en": "Details"
  },
  "ui.continuation_message": {
    "zh": "续作消息",
    "en": "Continuation message"
  },
  "ui.no_plan_yet": {
    "zh": "· 暂无计划",
    "en": "· No plan yet"
  },
  "ui.plan_progress": {
    "zh": "计划进度 ",
    "en": "Plan progress "
  },
  "ui.the_percentage_shows_completed_plan_steps_only": {
    "zh": "计划百分比仅表示已完成步骤比例。",
    "en": "The percentage shows completed plan steps only."
  },
  "ui.only_the_end_of_long_output_is": {
    "zh": "输出较长，仅保留末尾预览；完整内容请在原 Codex 会话查看。",
    "en": "Only the end of long output is shown. View the full output in the original Codex chat."
  },
  "ui.turn_output": {
    "zh": "本轮输出",
    "en": "Turn output"
  },
  "ui.no_output_yet": {
    "zh": "尚无输出",
    "en": "No output yet"
  },
  "ui.current_status": {
    "zh": "当前状态：",
    "en": "Current status: "
  },
  "ui.chat": {
    "zh": "会话：",
    "en": "Chat: "
  },
  "ui.rhine_could_not_load_animation": {
    "zh": "Rhine 动画资源读取失败",
    "en": "Rhine Could not load animation"
  },
  "ui.rhine_invalid_animation": {
    "zh": "Rhine 动画资源无效",
    "en": "Rhine Invalid animation"
  },
  "ui.chats_unavailable": {
    "zh": "会话暂不可用",
    "en": "Chats unavailable"
  },
  "ui.choose_a_chat_to_manage": {
    "zh": "选择当前要管理的对话…",
    "en": "Choose a chat to manage…"
  },
  "ui.loading_chats_2": {
    "zh": "正在读取已有对话…",
    "en": "Loading chats…"
  },
  "ui.no_local_codex_chats": {
    "zh": "暂无本地 Codex 对话",
    "en": "No local Codex chats"
  },
  "ui.view_added_work": {
    "zh": "查看已加入的工作",
    "en": "View added work"
  },
  "ui.could_not_load_click_chats_to_retry": {
    "zh": "读取失败：{p0}，请点击「↻ 对话」重试。",
    "en": "Could not load: {p0}, click “↻ Chats” to retry."
  },
  "ui.no_project_directory": {
    "zh": "未提供项目目录",
    "en": "No project directory"
  },
  "ui.updated": {
    "zh": " · {p0} 更新",
    "en": " · {p0} updated"
  },
  "ui.choose_a_chat_sorted_by_most_recently": {
    "zh": "按最近更新排序，选择你正在进行的对话。",
    "en": "Choose a chat, sorted by most recently updated."
  },
  "ui.waiting_for_recovery_confirmation": {
    "zh": "等待恢复确认",
    "en": "Waiting for recovery confirmation"
  },
  "ui.d_h_until_reset": {
    "zh": "{p0} 天 {p1} 小时后重置",
    "en": "{p0} d {p1} h until reset"
  },
  "ui.h_min_until_reset": {
    "zh": "{p0} 小时 {p1} 分钟后重置",
    "en": "{p0} h {p1} min until reset"
  },
  "ui.min_until_reset": {
    "zh": "{p0} 分钟后重置",
    "en": "{p0} min until reset"
  },
  "ui.unknown_2": {
    "zh": "未知",
    "en": "Unknown"
  },
  "ui.d_2": {
    "zh": "天",
    "en": "d"
  },
  "ui.hour": {
    "zh": "五小时",
    "en": "5-hour"
  },
  "ui.day": {
    "zh": "七天",
    "en": "7-day"
  },
  "ui.available_quota": {
    "zh": "{p0}可用额度",
    "en": "{p0} available quota"
  },
  "ui.until_reset_2": {
    "zh": "距离重置",
    "en": "UNTIL RESET"
  },
  "ui.click_to_expand_drag_to_move_ctrl": {
    "zh": "{p0}。点击展开，拖动移动；Ctrl + 滚轮调整大小。",
    "en": "{p0}. Click to expand; drag to move; Ctrl + scroll to resize."
  },
  "ui.available_quota_time_until_reset": {
    "zh": "{p0}可用额度 {p1}%，重置倒计时 {p2}",
    "en": "{p0} available quota {p1}%, time until reset {p2}"
  },
  "ui.waiting_for_quota_data": {
    "zh": "{p0}额度数据待同步",
    "en": "{p0}Waiting for quota data"
  },
  "ui.synced": {
    "zh": "{p0} 同步",
    "en": "{p0} synced"
  },
  "ui.waiting_to_sync_2": {
    "zh": "等待同步",
    "en": "Waiting to sync"
  },
  "ui.widget_settings_were_not_saved": {
    "zh": "挂件设置未保存：{p0}",
    "en": "Widget settings were not saved: {p0}"
  },
  "ui.local_service_disconnected_reconnecting_2": {
    "zh": "本地服务断开，正在重连。",
    "en": "Local service disconnected. Reconnecting."
  },
  "ui.quota_data_is_stale_scheduling_waits_for": {
    "zh": "额度样本已过期，等待刷新后再调度。",
    "en": "Quota data is stale. Scheduling waits for fresh data."
  },
  "ui.connected_codex_live_updates_periodic_sync": {
    "zh": "已连接 Codex · 实时事件 + 定期同步",
    "en": "Connected Codex · Live updates + periodic sync"
  },
  "ui.resume_at_2": {
    "zh": "剩余额度 ≥ {p0}% 时自动接续",
    "en": "Resume at ≥ {p0}% "
  },
  "ui.scheduling_paused_current_turn_continues": {
    "zh": "调度已暂停 · 当前轮次仍会继续",
    "en": "Scheduling paused · Current turn continues"
  },
  "ui.no_work_yet": {
    "zh": "还没有工作",
    "en": "No work yet"
  },
  "ui.add_a_chat_above_or_create_new": {
    "zh": "选择上方对话加入管理，或新建工作。",
    "en": "Add a chat above, or create new work."
  },
  "ui.full_approval_details_are_not_loaded_refresh_2": {
    "zh": "完整授权内容尚未加载，请刷新重试。",
    "en": "Full approval details are not loaded. Refresh to retry."
  },
  "ui.no_activity_yet_2": {
    "zh": "暂无活动",
    "en": "No activity yet"
  },
  "ui.loading_local_chats": {
    "zh": "正在读取本机会话…",
    "en": "Loading local chats…"
  },
  "ui.retry": {
    "zh": "重试",
    "en": "Retry"
  },
  "ui.import_an_existing_chat": {
    "zh": "导入已有会话",
    "en": "Import an existing chat"
  },
  "ui.work_details": {
    "zh": "工作详情",
    "en": "Work details"
  },
  "ui.quota_sync_requested": {
    "zh": "额度同步请求已完成",
    "en": "Quota sync requested"
  },
  "ui.saved": {
    "zh": "已保存",
    "en": "Saved"
  },
  "ui.widget_position_reset": {
    "zh": "挂件位置已重置",
    "en": "Widget position reset"
  },
  "ui.could_not_connect_to_the_local_service_2": {
    "zh": "本地服务连接失败，正在重连…",
    "en": "Could not connect to the local service. Reconnecting…"
  },
  "ui.codex_continuer_keep_work_moving": {
    "zh": "Codex Continuer · 让工作持续向前",
    "en": "Codex Continuer · Keep work moving"
  },
  "ui.codex_continuer_home": {
    "zh": "Codex Continuer 首页",
    "en": "Codex Continuer Home"
  },
  "ui.workspace": {
    "zh": "工作空间",
    "en": "Workspace"
  },
  "ui.preferences": {
    "zh": "偏好设置",
    "en": "Preferences"
  },
  "ui.local_workspace": {
    "zh": "本地工作空间",
    "en": "Local workspace"
  },
  "ui.data_stays_on_this_device": {
    "zh": "数据保存在此设备",
    "en": "Data stays on this device"
  },
  "ui.loading_version": {
    "zh": "读取版本…",
    "en": "Loading version…"
  },
  "ui.connecting": {
    "zh": "正在连接",
    "en": "Connecting"
  },
  "ui.switch_language": {
    "zh": "切换语言",
    "en": "Switch language"
  },
  "ui.language_chinese": {
    "zh": "中文",
    "en": "中文"
  },
  "ui.switch_light_dark_theme": {
    "zh": "切换深浅主题",
    "en": "Switch light/dark theme"
  },
  "ui.switch_theme": {
    "zh": "切换主题",
    "en": "Switch theme"
  },
  "ui.loading_workspace": {
    "zh": "正在载入工作空间…",
    "en": "Loading workspace…"
  },
  "ui.connecting_to_local_service": {
    "zh": "正在连接本地服务",
    "en": "Connecting to local service"
  },
  "ui.syncing_quota_data": {
    "zh": "额度数据正在同步",
    "en": "Syncing quota data"
  },
  "ui.continuer_codex_widget": {
    "zh": "Continuer · Codex 挂件",
    "en": "Continuer · Codex Widget"
  },
  "ui.expand_quota_and_work_panel": {
    "zh": "展开额度和工作面板",
    "en": "Expand quota and work panel"
  },
  "ui.click_to_expand_drag_to_move_ctrl_2": {
    "zh": "点击卡片展开，拖动移动；Ctrl + 滚轮调整大小",
    "en": "Click to expand; drag to move; Ctrl + scroll to resize"
  },
  "ui.quota_and_reset_countdown": {
    "zh": "额度与重置倒计时",
    "en": "Quota and reset countdown"
  },
  "ui.hour_available_quota": {
    "zh": "五小时可用额度",
    "en": "5-hour available quota"
  },
  "ui.quota_monitor_continuous_work": {
    "zh": "额度监测 · 持续工作",
    "en": "Quota monitor · Continuous work"
  },
  "ui.collapse_to_gauge": {
    "zh": "收起为仪表",
    "en": "Collapse to gauge"
  },
  "ui.collapse": {
    "zh": "收起",
    "en": "Collapse"
  },
  "ui.quit_continuer_and_stop_background_services": {
    "zh": "退出 Continuer 并停止后台",
    "en": "Quit Continuer and stop background services"
  },
  "ui.quit_continuer": {
    "zh": "退出 Continuer",
    "en": "Quit Continuer"
  },
  "ui.account_quota_2": {
    "zh": " 账户额度",
    "en": " Account quota"
  },
  "ui.connecting_to_local_service_2": {
    "zh": "正在连接本地服务…",
    "en": "Connecting to local service…"
  },
  "ui.auto_continue": {
    "zh": "自动续作 ",
    "en": "Auto continue "
  },
  "ui.resume_work_after_quota_recovery": {
    "zh": "额度恢复后接续工作",
    "en": "Resume work after quota recovery"
  },
  "ui.my_work_2": {
    "zh": " 我的工作 ",
    "en": " My work "
  },
  "ui.chats": {
    "zh": "↻ 对话",
    "en": "↻ chats"
  },
  "ui.refresh_chats": {
    "zh": "刷新对话列表",
    "en": "Refresh chats"
  },
  "ui.new": {
    "zh": "＋ 新建",
    "en": "＋ New"
  },
  "ui.select_a_codex_chat": {
    "zh": "选择 Codex 对话",
    "en": "Select a Codex chat"
  },
  "ui.more_chats": {
    "zh": "更多对话",
    "en": "More chats"
  },
  "ui.loading_work": {
    "zh": "正在读取工作记录…",
    "en": "Loading work…"
  },
  "ui.policy_and_display": {
    "zh": "工作策略与显示",
    "en": "Policy and display"
  },
  "ui.resume_threshold_2": {
    "zh": "恢复阈值 ",
    "en": "Resume threshold "
  },
  "ui.sync_interval": {
    "zh": "同步周期 ",
    "en": "Sync interval "
  },
  "ui.direct_work_turn_limit_2": {
    "zh": "直接执行轮次上限 ",
    "en": "Direct-work turn limit "
  },
  "ui.original_chat_message_limit_2": {
    "zh": "原聊天发送上限 ",
    "en": "Original-chat message limit "
  },
  "ui.follow_codex_window": {
    "zh": "跟随 Codex 窗口 ",
    "en": "Follow Codex window "
  },
  "ui.widget_size": {
    "zh": "桌面卡片大小 ",
    "en": "Widget size "
  },
  "ui.widget_size_2": {
    "zh": "桌面卡片大小",
    "en": "Widget size"
  },
  "ui.reset_widget_position": {
    "zh": "重置挂件位置",
    "en": "Reset widget position"
  },
  "ui.sync_every_seconds_direct_work_has_a": {
    "zh": "同步周期为 10–90 秒。直接执行受轮次上限约束；原聊天按每条监测记录累计发送次数，到限停止。暂停、重新开启不会清零；提高上限后需手动开启。原聊天工作是否完成需自行确认。",
    "en": "Sync every 10–90 seconds. Direct work has a turn limit. Original-chat messages are counted per record; monitoring stops at the limit. Pausing does not reset counts. Raise the limit and enable monitoring manually to resume. Check completion in the original chat."
  },
  "ui.save_policy": {
    "zh": "保存策略",
    "en": "Save policy"
  },
  "ui.saved_locally_runs_in_background": {
    "zh": "本机保存 · 后台持续工作",
    "en": "Saved locally · Runs in background"
  },
  "ui.close_dialog": {
    "zh": "关闭对话框",
    "en": "Close dialog"
  },
  "native.continuer_could_not_start": {
    "zh": "Continuer 启动失败",
    "en": "Continuer could not start"
  },
  "native.select_project_directory": {
    "zh": "选择工作项目目录",
    "en": "Select project directory"
  },
  "native.codex_continuer_quota_and_continuous_work": {
    "zh": "Codex Continuer · 额度与持续工作",
    "en": "Codex Continuer · Quota and continuous work"
  },
  "native.open_quota_and_work_panel": {
    "zh": "打开额度与工作面板",
    "en": "Open quota and work panel"
  },
  "native.follow_codex_window": {
    "zh": "跟随 Codex 窗口",
    "en": "Follow Codex window"
  },
  "native.show_independently": {
    "zh": "独立显示面板",
    "en": "Show independently"
  },
  "native.hide_to_tray": {
    "zh": "隐藏到托盘",
    "en": "Hide to tray"
  }
});
