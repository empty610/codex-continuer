// Service-owned messages use stable IDs and explicit parameters.
export const systemMessages = Object.freeze({
  "runtime.widget_ready": { "zh": "挂件已就绪。可使用 Ctrl+Alt+C 展开。", "en": "The widget is ready. Press Ctrl+Alt+C to expand it." },
  "runtime.port_in_use": { "zh": "端口属于其他应用", "en": "Port belongs to another application" },
  "runtime.build_mismatch": { "zh": "运行服务与当前插件构建不一致，请先停止并重新启动 Continuer", "en": "The service and plugin builds differ. Stop and restart Continuer." },
  "runtime.directory_mismatch": { "zh": "该端口服务使用不同的数据目录，请检查路径后重新启动 Continuer", "en": "The service uses a different data directory. Check the paths before restarting Continuer." },
  "runtime.root_mismatch": { "zh": "端口服务使用不同的安装目录，请检查路径后重新启动 Continuer", "en": "The service uses a different installation directory. Check the paths before restarting Continuer." },
  "runtime.exited": { "zh": "Continuer 已退出，请先手动打开挂件。", "en": "Continuer has exited. Open the widget manually first." },
  "runtime.node_missing": { "zh": "缺少 Node.js 路径，请重新运行插件安装器", "en": "Node.js path is missing. Run the plugin installer again." },
  "runtime.service_timeout": { "zh": "本地服务启动失败，请查看数据目录中的 service-stderr.log", "en": "The local service did not become ready. Check service-stderr.log in the data directory." },
  "runtime.desktop_missing": { "zh": "缺少桌面运行时，请在项目目录运行 npm install 后重新构建插件", "en": "Desktop runtime is missing. Run npm install in the project directory and rebuild the plugin." },
  "runtime.widget_timeout": { "zh": "挂件未在时限内就绪，请查看 /api/health 和 widget-stderr.log", "en": "The widget did not become ready in time. Check /api/health and widget-stderr.log." },
  "connection.demo": { "zh": "演示数据 · 不执行真实任务", "en": "Demo data · No real tasks are run" },
  "connection.codex_connected": { "zh": "Codex App Server 已连接", "en": "Codex App Server connected" },
  "task.outcome_missing": { "zh": "本轮已结束，未收到明确的完成状态，请检查输出后继续。", "en": "This turn ended without a clear completion status. Check the output before continuing." },
  "error.project_missing": { "zh": "项目目录不存在", "en": "Project directory does not exist" },
  "error.operation_failed": { "zh": "操作失败，请检查本地服务状态后重试", "en": "Operation failed. Check the local service and retry." },
  "system.summary_truncated": { "zh": "列表内容较多，已精简历史和授权预览；完整内容请打开详情。", "en": "History and approval previews were shortened. Open details for the full content." },
  "log.task_activity": {
    "zh": "{name}：{activity}",
    "en": "{name}: {activity}"
  },
  "task.no_tool_activity": {
    "zh": "{summary}（本轮无工具活动，已停止自动续作）",
    "en": "{summary} (No tool activity this turn; automatic continuation stopped)"
  },
  "error.setting_range": {
    "zh": "{name} 必须为 {min}–{max} 的整数",
    "en": "{name} must be an integer between {min} and {max}"
  },
  "monitor.send_limit": {
    "zh": "已达到原聊天发送上限（{sent}/{limit} 次），监测已停止；请查看原聊天确认工作结果",
    "en": "Message limit reached ({sent}/{limit}). Monitoring stopped; check results in the original chat."
  },
  "task.wait_writer_retry": {
    "zh": "原会话被其他 Codex 客户端占用，30 秒后自动重试",
    "en": "The original chat is in use by another Codex client. Retrying in 30 seconds."
  },
  "task.wait_writer_manual": {
    "zh": "原会话被其他 Codex 客户端占用，请等待原会话结束后再继续",
    "en": "The original chat is in use by another Codex client. Wait for it to finish before continuing."
  },
  "task.wait_thread_retry": {
    "zh": "原会话仍在运行，30 秒后自动重试",
    "en": "The original chat is still running. Retrying in 30 seconds."
  },
  "task.wait_thread_manual": {
    "zh": "原会话仍在运行，请等待原会话结束后再继续",
    "en": "The original chat is still running. Wait for it to finish before continuing."
  },
  "demo.search_ready": {
    "zh": "全文索引已建立，等待继续验证搜索结果",
    "en": "Full-text index built; continue to verify search results"
  },
  "demo.components_ready": {
    "zh": "已完成 Button 和 Input，等待继续",
    "en": "Button and Input completed; waiting to continue"
  },
  "demo.tests_ready": {
    "zh": "演示记录：测试用例已补齐",
    "en": "Demo record: test cases added"
  },
  "demo.started": {
    "zh": "演示模式已启动，所有额度与工作记录均为模拟数据",
    "en": "Demo mode started. All quota and work records are simulated."
  },
  "demo.work_complete": {
    "zh": "API 服务 · 单元测试：模拟工作已完成",
    "en": "API service · Unit tests: simulated work completed"
  },
  "error.enter_a_name_project_directory_and_work_goal": {
    "zh": "请填写名称、项目目录和工作目标",
    "en": "Enter a name, project directory, and work goal."
  },
  "error.name_or_goal_is_too_long": {
    "zh": "名称或目标过长",
    "en": "Name or goal is too long"
  },
  "task.waiting_for_scheduling": {
    "zh": "等待调度",
    "en": "Waiting for scheduling"
  },
  "task.service_restarted_confirm_the_original_chat_has_stopped": {
    "zh": "服务重启，请确认原会话已停止后手动继续",
    "en": "Service restarted. Confirm the original chat has stopped before resuming manually."
  },
  "error.direct_state": {
    "zh": "工作任务状态无效",
    "en": "Invalid direct work state"
  },
  "error.direct_rounds": {
    "zh": "工作执行轮次无效",
    "en": "Invalid execution round count"
  },
  "error.direct_monitor_fields": {
    "zh": "工作任务不能包含监测发送状态",
    "en": "Direct work cannot contain monitoring delivery fields"
  },
  "error.invalid_switch_value": {
    "zh": "开关值无效",
    "en": "Invalid switch value"
  },
  "task.continuous_work_disabled": {
    "zh": "持续工作已关闭",
    "en": "Continuous work disabled"
  },
  "task.pausing": {
    "zh": "正在暂停",
    "en": "Pausing"
  },
  "task.work_paused": {
    "zh": "工作已暂停",
    "en": "Work paused"
  },
  "error.work_is_still_running_or_stopping": {
    "zh": "任务尚在运行或停止中",
    "en": "Work is still running or stopping"
  },
  "task.waiting_for_available_quota": {
    "zh": "等待可用额度",
    "en": "Waiting for available quota"
  },
  "error.pause_the_work_first": {
    "zh": "请先暂停任务",
    "en": "Pause the work first"
  },
  "task.user_marked_complete": {
    "zh": "用户确认完成",
    "en": "User marked complete"
  },
  "error.unsupported_action": {
    "zh": "不支持的操作",
    "en": "Unsupported action"
  },
  "task.backup_restored_check_the_original_chats_and_projects": {
    "zh": "已恢复备份，请检查原聊天和项目状态后手动继续",
    "en": "Backup restored. Check the original chats and projects before resuming manually."
  },
  "error.invalid_utf8": {
    "zh": "请求正文不是有效 UTF-8",
    "en": "Request body is not valid UTF-8"
  },
  "error.request_too_large": {
    "zh": "请求过大",
    "en": "Request is too large"
  },
  "error.invalid_json": {
    "zh": "请求正文不是有效 JSON",
    "en": "Request body is not valid JSON"
  },
  "error.json_object_required": {
    "zh": "请求正文必须为 JSON 对象",
    "en": "Request body must be a JSON object"
  },
  "error.note_alias_conflict": {
    "zh": "请仅提供监测备注 note；prompt 为旧版兼容字段",
    "en": "Provide only note; prompt is a legacy compatibility field"
  },
  "error.work_item_not_found": {
    "zh": "任务不存在",
    "en": "Work item not found"
  },
  "error.stream_limit": {
    "zh": "实时连接已达上限，请关闭多余页面",
    "en": "Live connection limit reached. Close extra pages."
  },
  "error.approval_expired": {
    "zh": "授权请求已失效",
    "en": "Approval request has expired"
  },
  "error.loopback_required": {
    "zh": "请使用 127.0.0.1 访问",
    "en": "Use 127.0.0.1 to access this service"
  },
  "error.cross_origin": {
    "zh": "跨站请求被拒绝",
    "en": "Cross-origin request rejected"
  },
  "error.invalid_origin": {
    "zh": "请求来源无效",
    "en": "Invalid request origin"
  },
  "error.request_rate": {
    "zh": "请求过于频繁，请稍后重试",
    "en": "Too many requests. Retry later."
  },
  "error.api_credentials": {
    "zh": "请用启动脚本重新打开 Continuer；本地 API 需要访问凭据",
    "en": "Reopen Continuer with the launcher. Local API access requires credentials."
  },
  "error.not_found": {
    "zh": "接口或页面不存在",
    "en": "API route or page not found"
  },
  "error.lease_platform": {
    "zh": "此平台不支持 Continuer 数据目录互斥锁",
    "en": "Continuer data directory locking is unavailable on this platform"
  },
  "error.lease_conflict": {
    "zh": "同一数据目录已有服务运行，请勿重复启动",
    "en": "A service is already running for this data directory"
  },
  "error.lease_corrupt": {
    "zh": "服务锁损坏，请检查进程后处理 service.lock",
    "en": "Service lock is damaged. Check running processes before handling service.lock."
  },
  "connection.connecting_to_local_codex": {
    "zh": "正在连接本机 Codex…",
    "en": "Connecting to local Codex…"
  },
  "task.connection_interrupted_check_the_original_work_before_resuming": {
    "zh": "连接中断，请检查原任务后手动继续",
    "en": "Connection interrupted. Check the original work before resuming manually."
  },
  "error.data_could_not_be_saved_recover_storage_before": {
    "zh": "数据保存失败，恢复存储后再开启调度",
    "en": "Data could not be saved. Recover storage before enabling scheduling."
  },
  "error.a_continuation_message_is_still_being_sent_wait": {
    "zh": "续作消息仍在发送，请等待发送结果确认后再恢复存储",
    "en": "A continuation message is still being sent. Wait for confirmation before recovering storage."
  },
  "error.confirm_current_work_has_stopped_before_restoring_a": {
    "zh": "请先确认当前工作已停止，再恢复备份",
    "en": "Confirm current work has stopped before restoring a backup."
  },
  "error.the_main_state_file_is_corrupt_choose_restore": {
    "zh": "主状态文件损坏，请明确选择恢复备份",
    "en": "The main state file is corrupt. Choose Restore backup to proceed."
  },
  "error.invalid_recovery_method": {
    "zh": "恢复方式无效",
    "en": "Invalid recovery method"
  },
  "task.quota_is_low_or_unknown_waiting_for_fresh": {
    "zh": "可用额度不足或未知，等待新额度样本",
    "en": "Quota is low or unknown. Waiting for fresh data."
  },
  "error.up_to_records_are_supported_end_unused_work": {
    "zh": "最多管理 100 条记录，请先结束不再需要的工作",
    "en": "Up to 100 records are supported. End unused work first."
  },
  "log.work_added": {
    "zh": "添加工作：{name}",
    "en": "Work added: {name}"
  },
  "log.scheduling_settings_updated": {
    "zh": "调度设置已更新",
    "en": "Scheduling settings updated"
  },
  "error.this_chat_has_already_been_added": {
    "zh": "该会话已添加",
    "en": "This chat has already been added"
  },
  "error.this_chat_is_being_added_do_not_import": {
    "zh": "该会话正在添加，请勿重复导入",
    "en": "This chat is being added. Do not import it again."
  },
  "log.chat_added": {
    "zh": "已添加会话：{name}",
    "en": "Chat added: {name}"
  },
  "task.monitoring_quota_a_continuation_message_will_be_sent": {
    "zh": "正在监测额度；确认耗尽后，恢复时向原聊天发送续作消息",
    "en": "Monitoring quota. A continuation message will be sent after confirmed exhaustion and recovery."
  },
  "task.quota_recovery_monitoring_paused": {
    "zh": "额度恢复续作已暂停",
    "en": "Quota recovery monitoring paused"
  },
  "error.monitoring_notes_must_be_text_of_up_to": {
    "zh": "监测备注必须为不超过 12000 字符的文本",
    "en": "Monitoring notes must be text of up to 12,000 characters."
  },
  "error.continuation_messages_must_be_text_of_up_to": {
    "zh": "续作消息必须为不超过 12000 字符的文本",
    "en": "Continuation messages must be text of up to 12,000 characters."
  },
  "task.chat_added_enable_monitoring_to_send_a_message": {
    "zh": "会话已添加，开启额度监测后在恢复时发送续作消息；工作结果请在原聊天确认",
    "en": "Chat added. Enable monitoring to send a message after quota recovery. Check results in the original chat."
  },
  "task.this_legacy_record_lacks_proof_of_quota_exhaustion": {
    "zh": "旧监测记录缺少额度耗尽依据，请检查原聊天后重新开启监测",
    "en": "This legacy record lacks proof of quota exhaustion. Check the original chat before enabling monitoring again."
  },
  "task.the_previous_delivery_is_unconfirmed_check_the_original": {
    "zh": "上次发送结果未确认，请检查原聊天后重新开启监测",
    "en": "The previous delivery is unconfirmed. Check the original chat before enabling monitoring again."
  },
  "error.monitor_state": {
    "zh": "额度监测状态无效",
    "en": "Invalid monitoring state"
  },
  "error.monitor_count": {
    "zh": "额度监测发送次数或旧计数无效",
    "en": "Invalid monitoring delivery count or legacy counter"
  },
  "error.monitor_delivery": {
    "zh": "额度监测发送状态无效",
    "en": "Invalid monitoring delivery state"
  },
  "log.continuation_message_updated": {
    "zh": "续作消息已更新",
    "en": "Continuation message updated"
  },
  "task.monitoring_paused_delivery_is_still_unconfirmed_check_the": {
    "zh": "监测已暂停，发送结果仍需确认；请核对原聊天，已发出的消息无法撤回",
    "en": "Monitoring paused. Delivery is still unconfirmed; check the original chat. Sent messages cannot be recalled."
  },
  "error.delivery_is_still_being_confirmed_wait_before_enabling": {
    "zh": "续作消息发送结果仍在确认，请等待后再开启或结束监测",
    "en": "Delivery is still being confirmed. Wait before enabling or ending monitoring."
  },
  "error.message_limit_reached_raise_the_limit_then_enable": {
    "zh": "已达到原聊天发送次数上限，请提高发送上限后再开启监测；累计次数不会重置",
    "en": "Message limit reached. Raise the limit, then enable monitoring. Counts do not reset."
  },
  "log.monitoring_ended_check_results_in_the_original_chat": {
    "zh": "已结束监测：{name}；工作结果请在原聊天确认",
    "en": "Monitoring ended: {name}; check results in the original chat"
  },
  "task.the_delivery_record_could_not_be_saved_check": {
    "zh": "发送记录保存失败，请检查原聊天后手动继续",
    "en": "The delivery record could not be saved. Check the original chat before resuming manually."
  },
  "error.project_path": {
    "zh": "项目目录必须是本地盘符绝对路径",
    "en": "Project directory must be an absolute local drive path"
  },
  "error.project_path_kind": {
    "zh": "项目目录必须是本地盘符绝对路径，不支持网络或设备路径",
    "en": "Project directory must be an absolute local drive path; network and device paths are unsupported"
  },
  "error.project_directory": {
    "zh": "项目目录必须是存在的本地目录",
    "en": "Project directory must be an existing local directory"
  },
  "error.queue_timeout": {
    "zh": "Codex 队列请求超时",
    "en": "Codex queue request timed out"
  },
  "error.queue_failed": {
    "zh": "Codex 队列请求失败 ({code})",
    "en": "Codex queue request failed ({code})"
  },
  "error.invalid_original_chat_id": {
    "zh": "原聊天 ID 无效",
    "en": "Invalid original chat ID"
  },
  "error.codex_message_queue_unavailable_update_the_desktop_app": {
    "zh": "Codex 消息队列不可用，请更新桌面端或设置 CODEX_QUEUE_BINARY",
    "en": "Codex message queue unavailable. Update the desktop app or set CODEX_QUEUE_BINARY."
  },
  "error.paused_no_continuation_message_sent": {
    "zh": "已暂停，未发送续作消息",
    "en": "Paused; no continuation message sent"
  },
  "error.delivery_unconfirmed_check_the_original_chat": {
    "zh": "发送结果未确认，请检查原聊天：{reason}",
    "en": "Delivery unconfirmed. Check the original chat: {reason}"
  },
  "task.quota_exhaustion_confirmed_one_continuation_message_will_be": {
    "zh": "已确认额度耗尽，恢复后向原聊天发送一次续作消息",
    "en": "Quota exhaustion confirmed. One continuation message will be sent after recovery."
  },
  "task.quota_recovered_waiting_for_message_delivery_to_become": {
    "zh": "额度已恢复，等待消息发送通道",
    "en": "Quota recovered. Waiting for message delivery to become available."
  },
  "error.the_last_instruction_already_received_a_complete_reply": {
    "zh": "原聊天自上次指令后已形成完整回复，已跳过本次续作消息",
    "en": "The last instruction already received a complete reply. This continuation message was skipped."
  },
  "error.the_original_chat_is_still_replying_no_continuation": {
    "zh": "原聊天仍在回复，暂不发送续作消息",
    "en": "The original chat is still replying. No continuation message sent yet."
  },
  "error.reply_status_could_not_be_confirmed_no_continuation": {
    "zh": "无法确认原聊天回复状态，暂不发送续作消息，稍后重试",
    "en": "Reply status could not be confirmed. No continuation message sent; retrying later."
  },
  "task.quota_recovered_sending_a_continuation_message_to_the": {
    "zh": "额度已恢复，正在向原聊天发送续作消息",
    "en": "Quota recovered. Sending a continuation message to the original chat."
  },
  "task.continuation_message_queued_monitoring_continues_check_results_in": {
    "zh": "已向原聊天排队发送续作消息，继续监测；工作结果请在原聊天确认",
    "en": "Continuation message queued. Monitoring continues; check results in the original chat."
  },
  "task.continuation_message_queued_monitoring_paused_queued_messages_can": {
    "zh": "已向原聊天排队发送续作消息，监测已暂停；已排队消息无法撤回",
    "en": "Continuation message queued. Monitoring paused; queued messages cannot be recalled."
  },
  "error.codex_exit": {
    "zh": "Codex 进程已退出 ({code})",
    "en": "Codex process exited ({code})"
  },
  "error.codex_connection": {
    "zh": "Codex 连接已失效",
    "en": "Codex connection is no longer valid"
  },
  "error.codex_disconnected": {
    "zh": "Codex 未连接",
    "en": "Codex is not connected"
  },
  "error.rpc_timeout": {
    "zh": "{method} 请求超时，请检查连接",
    "en": "{method} request timed out. Check the connection."
  },
  "error.codex_connection_closed": {
    "zh": "Codex 连接已关闭",
    "en": "Codex connectionOff"
  },
  "error.storage_shape": {
    "zh": "状态文件结构无效",
    "en": "Invalid state file structure"
  },
  "error.storage_version": {
    "zh": "状态文件版本不兼容",
    "en": "Incompatible state file version"
  },
  "error.storage_history": {
    "zh": "活动或额度历史格式无效",
    "en": "Invalid activity or quota history"
  },
  "error.storage_settings": {
    "zh": "状态文件设置无效",
    "en": "Invalid state file settings"
  },
  "error.storage_send_limit": {
    "zh": "状态文件发送上限无效",
    "en": "Invalid state file delivery limit"
  },
  "error.task_duplicate": {
    "zh": "任务记录无效或 ID 重复",
    "en": "Invalid task record or duplicate ID"
  },
  "error.thread_duplicate": {
    "zh": "状态中存在重复会话，请检查备份后恢复",
    "en": "Duplicate chats in state. Check the backup before restoring."
  },
  "error.storage_size": {
    "zh": "状态文件超过 64 MiB，请检查后恢复备份",
    "en": "State file exceeds 64 MiB. Inspect it before restoring a backup."
  },
  "error.storage_missing": {
    "zh": "主状态文件缺失，但存在备份，请明确恢复",
    "en": "Primary state file is missing but a backup exists. Restore it explicitly."
  },
  "error.storage_unrecovered": {
    "zh": "状态未恢复，禁止覆盖原文件：{reason}",
    "en": "State has not been restored; the original file cannot be overwritten: {reason}"
  },
  "error.task_mode": {
    "zh": "任务模式无效",
    "en": "Invalid task mode"
  },
  "error.task_record": {
    "zh": "任务记录无效",
    "en": "Invalid task record"
  },
  "error.task_switch": {
    "zh": "任务开关无效",
    "en": "Invalid task switch"
  },
  "error.task_fields": {
    "zh": "任务目标、备注、续作消息或输出字段无效",
    "en": "Invalid task goal, note, continuation message, or output fields"
  },
  "error.monitor_execution": {
    "zh": "额度监测记录不能启动执行轮次",
    "en": "A monitoring record cannot start an execution turn"
  },
  "task.start_cancelled_waiting_for_active_scheduling_and_fresh": {
    "zh": "启动已取消，等待有效调度和新鲜额度",
    "en": "Start cancelled. Waiting for active scheduling and fresh quota."
  },
  "task.resuming_chat": {
    "zh": "正在恢复会话…",
    "en": "Resuming chat…"
  },
  "task.automatic_turn_limit_reached_resume_manually_to_continue": {
    "zh": "已达到自动执行轮次上限，请手动继续",
    "en": "Automatic turn limit reached. Resume manually to continue."
  },
  "error.no_valid_turn_id_received_check_the_original": {
    "zh": "未收到有效的轮次 ID，请检查原会话后手动继续",
    "en": "No valid turn ID received. Check the original chat before resuming manually."
  },
  "log.work_started": {
    "zh": "开始工作：{name}",
    "en": "Work started: {name}"
  },
  "task.startup_events_exceeded_the_buffer_limit_interrupting_check": {
    "zh": "启动期间通知超过缓存上限，正在中断，请检查原会话后手动继续",
    "en": "Startup events exceeded the buffer limit. Interrupting; check the original chat before resuming."
  },
  "task.interruption_unconfirmed": {
    "zh": "未确认中断：{reason}",
    "en": "Interruption unconfirmed: {reason}"
  },
  "task.codex_is_working_on_the_goal": {
    "zh": "Codex 正在处理目标",
    "en": "Codex is working on the goal"
  },
  "task.plan_updated": {
    "zh": "计划已更新",
    "en": "Plan updated"
  },
  "task.running_a_command": {
    "zh": "正在执行命令",
    "en": "Running a command"
  },
  "task.editing_files": {
    "zh": "正在修改文件",
    "en": "Editing files"
  },
  "task.analyzing": {
    "zh": "正在分析",
    "en": "Analyzing"
  },
  "task.generating_a_response": {
    "zh": "正在生成回复",
    "en": "Generating a response"
  },
  "task.calling_a_tool": {
    "zh": "正在调用工具",
    "en": "Calling a tool"
  },
  "task.working": {
    "zh": "正在工作",
    "en": "Working"
  },
  "task.this_turn_failed": {
    "zh": "本轮执行失败",
    "en": "This turn failed"
  },
  "task.waiting_for_your_approval": {
    "zh": "等待你批准操作",
    "en": "Waiting for your approval"
  },
  "log.is_awaiting_approval": {
    "zh": "{name} 等待操作授权",
    "en": "{name} is awaiting approval"
  },
  "task.file_changes_cannot_be_fully_reviewed_and_were": {
    "zh": "文件修改范围无法完整审阅，已拒绝；请在原 Codex 中核对后手动继续",
    "en": "File changes cannot be fully reviewed and were declined. Review them in the original Codex chat before resuming."
  },
  "task.user_input_is_required_respond_in_codex_before": {
    "zh": "需要用户输入，请在 Codex 中处理后继续",
    "en": "User input is required. Respond in Codex before resuming."
  },
  "task.approval_details_cannot_be_fully_reviewed_and_were": {
    "zh": "授权内容超出可审阅范围，已拒绝，请在原 Codex 会话核对后继续",
    "en": "Approval details cannot be fully reviewed and were declined. Review them in the original Codex chat before resuming."
  },
  "error.recover_data_storage_before_handling_approvals": {
    "zh": "请先恢复数据保存，再处理授权",
    "en": "Recover data storage before handling approvals."
  },
  "error.approval_expired_or_decision_invalid": {
    "zh": "授权请求已过期或决定无效",
    "en": "Approval expired or decision invalid"
  },
  "error.approval_details_cannot_be_fully_reviewed_handle_this": {
    "zh": "授权内容无法完整审阅，请在原 Codex 中处理",
    "en": "Approval details cannot be fully reviewed. Handle this in the original Codex chat."
  },
  "error.the_approval_turn_is_no_longer_active_or": {
    "zh": "授权所属轮次已失效或正在暂停",
    "en": "The approval turn is no longer active or is pausing"
  },
  "task.more_operations_await_approval": {
    "zh": "仍有操作等待授权",
    "en": "More operations await approval"
  },
  "task.approved_continuing": {
    "zh": "已批准，继续执行",
    "en": "Approved; continuing"
  },
  "task.operation_declined": {
    "zh": "已拒绝操作",
    "en": "Operation declined"
  }
});
