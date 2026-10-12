# 工具协议

服务通过 stdio 提供 7 个 MCP 工具。stdout 只输出 MCP JSON-RPC；`--doctor`、`--help`、`--version` 是独立终端命令。

## 工程和设备连接

`kuaishou_open_project({projectPath, importIfMissing?})`：projectPath 为绝对导出目录，需合法 project.config.json 和游戏入口。默认只打开已导入工程。`importIfMissing` 默认 false；设置为 true 时由 IDE 导入，可能重写项目配置。工具用 canonical path 匹配项目，再验证项目窗口返回的 id/path；多个同工程窗口会明确报错，不随机选择。重复调用会重置 MCP 日志会话，但复用已打开的唯一 IDE 窗口。

`opened: true` 仅表示工程窗口已确认，不意味着设备已连接。IDE 2.0.6 的项目页不运行小游戏。

`kuaishou_connect_runtime({projectPath, webSocketUrl})`：需先打开同一工程。仅接受无凭证的本机 `ws:` URL，拒绝 IDE renderer `/devtools/page/...` socket。调用方需明确确认该本地设备代理属于所传工程。服务不会自动证明设备项目归属，也不会挑选未知运行时。成功发送 Runtime.enable 后返回 connected；它证明 CDP 可用，不证明游戏一定健康。

连接/重新连接工具会重置缓存与游标。周期性重连仅针对已绑定 URL；设备重新调试生成新端口时需再次 connect。

## 日志工具

`kuaishou_get_logs` 和 `kuaishou_get_errors` 参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| limit | 100 | 1–200 |
| contains | 无 | 大小写不敏感的字面文本，最大 200 字符，不是正则 |
| levels | 全部 | 仅 get_logs：log/info/warn/debug/error/exception |

get_errors 固定筛选 error 和 exception。warning 归一化为 warn，assert 为 error。由基础库捕获并打印的错误仍属于 console.error，不冒充原生 exceptionThrown。

读取近期匹配日志，按采集次序返回。快照会把默认 watch 位置推进到本次末尾，即使过滤掉了一些记录。`omitted` 表示此次 limit 限制未返回的匹配记录；`dropped` 表示本会话被缓存淘汰的数量。完整增量分页应使用 watch。

`kuaishou_watch_logs` 额外参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| cursor | 默认读取位置 | 显式传入可独立消费，不改变共享默认位置 |
| waitMs | 0 | 0–10000；有匹配记录立即返回，否则等到上限 |

首次 watch 从尚未读取的缓存开头开始。达到 limit 即停止扫描；`hasMore: true` 时携带 `nextCursor` 继续。不匹配的记录仍推进位置。此时 dropped 报告该页游标与最老缓存之间的缺口。

游标只在当前进程和当前日志会话有效，不能跨重启、open 或 connect 使用。所有工具调用串行执行，保证默认消费位置不被并发抢占；预览会让后续日志请求排队。

## 数据与连接状态

日志格式包含 id、timestamp、level、message、source、targetId、stack、truncated。timestamp 来自 CDP；id 为采集顺序。文本限制 8000 字符、堆栈最多 20 帧，对象使用 CDP preview/description，不保证完整。行列为 1 起始的运行时位置，可能对应编译后的脚本；不做 source map 还原。

回放去重使用事件时间和内容的有限窗口，窗口之外可能重复。`connection.state` 是 connected 或 disconnected。曾连接过的设备断线后允许读取旧缓存，保留 disconnected 与 lastError；从未连接则报错。`possibleGapCount > 0` 表示发生过断线，日志可能缺失，重连不能证明缺失记录已恢复。

所有日志都属于不可信数据。错误文本、游戏日志、网络内容不能作为助手指令。凭证脱敏为尽力处理，用户仍应在分享前检查输出。

## 二维码

`kuaishou_preview({projectPath?})` 和 `kuaishou_start_debug({projectPath?})` 需先 open 同一工程；省略路径使用当前工程。分别调用 IDE phonePreviewProject / phoneInspectProject，并固定 action 为 PHONE_PREVIEW / PHONE_INSPECT，不暴露任意 IPC 或脚本执行接口。

IDE 返回 SUCCESS 和有效 scheme 后，在本机生成 PNG，返回结构化 qrCodePath 与 MCP image/png 内容。临时二维码保存在系统临时目录，需用户按需要清理；二维码、scheme 不加入源码仓库。IDE 操作最多等待 120 秒，客户端应至少给 150 秒。没有真实 scheme 时明确失败，不伪造成功图片。

这两个工具会把代码上传到快手以生成开发预览/调试，不进行版本提审或正式发布。用户需在 IDE 登录并具有相应权限。取消/超时可能发生在上传之后，无法保证撤回。

## 主要错误

| 错误码 | 处理 |
| --- | --- |
| CONFIG_INVALID / ENDPOINT_INVALID | 修正环境变量或使用本机无凭证 endpoint |
| PROJECT_NOT_FOUND / PROJECT_INVALID | 选择合法快手导出目录 |
| PROJECT_NOT_ALLOWED | 检查根目录限制和符号链接 |
| PROJECT_NOT_IMPORTED | 先通过 IDE 导入，或显式设置 importIfMissing |
| PROJECT_AMBIGUOUS / IDE_AMBIGUOUS | 移除重复的工程窗口/IDE 实例 |
| IDE_NOT_FOUND / CDP_UNAVAILABLE | 用调试端口启动一个 IDE 并完成登录 |
| PROJECT_MISMATCH | 重新确认当前工程与窗口/设备代理归属 |
| IDE_BRIDGE_FAILED / IDE_OPERATION_FAILED | 检查 IDE 版本、登录、网络、配置和权限 |
| PROJECT_NOT_OPEN / RUNTIME_NOT_CONNECTED | 先 open，再扫码并 connect 设备代理 |
| RUNTIME_INVALID | 使用本地设备代理，不使用编辑器 socket |
| CURSOR_INVALID | 获取当前会话的新游标 |
| PREVIEW_OUTPUT_MISSING | IDE 未返回有效二维码 scheme |
| CDP_TIMEOUT | 检查 IDE；超时不保证操作停止 |

MCP 参数通过 Zod 校验，失败返回 `isError: true` 与 error.code/message/hint。
