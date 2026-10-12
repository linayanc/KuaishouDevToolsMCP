# Kuaishou DevTools MCP

[English](README.en.md) · [工具协议](docs/tools.md) · [兼容性与排障](docs/compatibility.md)

让 Codex、Claude Desktop、Cursor 等 MCP 客户端打开快手小游戏工程、生成真机预览/调试二维码，并通过本地设备调试代理读取 Console、错误堆栈和增量日志。

这是一个社区项目，采用 MIT 许可证，与快手官方无隶属关系。针对 **快手小游戏开发者工具**，不是快手小程序 `kma` CLI，也不是短视频数据采集工具。

## 功能

| MCP 工具 | 用途 |
| --- | --- |
| `kuaishou_open_project` | 打开已导入工程，可选择导入；重新打开重置日志会话 |
| `kuaishou_preview` | 调用 IDE 真机预览，返回二维码 PNG |
| `kuaishou_start_debug` | 调用 IDE 真机调试，返回手机扫码二维码 |
| `kuaishou_connect_runtime` | 将本地设备 CDP 代理明确绑定到当前工程 |
| `kuaishou_get_logs` | 读取近期 Console，支持等级和字面文本过滤 |
| `kuaishou_get_errors` | 读取 error/assert 与未捕获异常、运行时堆栈 |
| `kuaishou_watch_logs` | 游标增量读取、分页和有限长轮询 |

日志使用有限缓存、会话游标、回放去重和断线重连。断线或缓存溢出会明确返回缺口信息。工具失败返回结构化错误。

**版本边界：** 本机适配快手小游戏 IDE **2.0.6 / Windows** 的 preload 接口。这个版本通过手机运行和调试游戏；桌面项目窗口不是游戏运行时。预览二维码与工程打开已实测；真实手机日志尚待验收，日志协议、分页、重连已通过本地 HTTP/WebSocket 集成测试。macOS、其他 IDE 版本和 Unity 真机日志尚未实测。详见 [验证矩阵](docs/compatibility.md)。

## 安装

前置条件：Node.js **22+**、Git、[快手小游戏开发者工具](https://ks-game-docs.kuaishou.com/minigame/start/devtool.html)。先在 IDE 完成快手扫码登录，并导入小游戏导出目录。

```sh
git clone https://github.com/linayanc/KuaishouDevToolsMCP.git
cd KuaishouDevToolsMCP
npm ci
npm run build
```

当前从源码安装，未发布到 npm；不要把 npm 包名当成已发布的安装入口。

保存工作并退出其他快手 IDE 实例，然后用本地调试端口启动。Windows PowerShell 示例：

```powershell
Start-Process -FilePath 'C:\Program Files\kuaishou-minigame-devtools\快手小游戏开发者工具.exe' -ArgumentList '--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1'
node .\dist\index.js --doctor
```

安装位置不同请替换路径。`--doctor` 只检查 IDE 可达性并列出候选设备代理，不代表游戏已连接。调试端口只用于本机，不应暴露到公网。工具不会修改 IDE 安装文件或读取账号凭证文件。

## 接入 MCP 客户端

通用 JSON 配置，按本机情况替换 Node 与项目路径：

```json
{
  "mcpServers": {
    "kuaishou": {
      "command": "node",
      "args": ["E:/ks-mcp/dist/index.js"],
      "env": { "KUAISHOU_CDP_ENDPOINT": "http://127.0.0.1:9223" }
    }
  }
}
```

Codex 的 TOML 示例见 [examples/codex.toml](examples/codex.toml)，其他客户端参考 [examples/mcp.json](examples/mcp.json)。服务使用 **stdio**；不要将 `--doctor`、`--help` 放进 MCP 服务启动参数。

## 使用流程

1. 调用 `kuaishou_open_project`，传入包含 `project.config.json` 的快手导出目录绝对路径。默认要求工程已导入 IDE。设置 `importIfMissing: true` 可让 IDE 导入，**此操作可能重写项目配置**。
2. 真机预览：调用 `kuaishou_preview`，用快手 App 扫码。它会上传工程生成开发预览，不发布正式版本。
3. 读取游戏日志：调用 `kuaishou_start_debug`，用与电脑同一局域网的手机扫码并运行游戏。IDE 会弹出设备调试窗口。
4. 在终端执行 `node dist/index.js --doctor`，查看 `deviceProxies`。候选端口来自设备调试窗口 URL 的 `ws=` 参数，连接时使用 **`ws://127.0.0.1:<代理端口>/`**。
5. 确认该设备调试窗口属于当前工程，再调用 `kuaishou_connect_runtime`，传入 `projectPath` 和 `webSocketUrl`。项目关联由调用方明确指定，服务不能自动证明设备归属；多个工程同时调试时尤其需要确认。
6. 调用 `kuaishou_get_errors` 排查故障，使用 `kuaishou_get_logs` 查看上下文。持续读取使用 `kuaishou_watch_logs`，带上 `nextCursor`，在 `hasMore: true` 时继续分页。

**不要传入手机 IP 或 IDE 的 `/devtools/page/...` 地址。** 后者是编辑器/项目 UI，不是游戏。未连接设备时日志工具返回错误，不会把 IDE 日志冒充游戏日志。

可以直接对助手说：

> 打开 E:/my-game/Build/Kuaishou/minigame，生成真机调试二维码。连接我确认属于该工程的本地设备代理，读取最近的错误和堆栈。修改代码后重新预览，检查新增日志。

代码修改由你的编码助手完成；MCP 不暴露任意脚本执行、账号登录、正式发布或源码编辑工具。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `KUAISHOU_CDP_ENDPOINT` | `http://127.0.0.1:9223` | 本机 IDE 调试 HTTP 地址 |
| `KUAISHOU_ALLOWED_ROOTS` | `[]` | JSON 数组；设置后只允许这些绝对目录下的工程，解析符号链接 |
| `KUAISHOU_LOG_CAPACITY` | `2000` | 保留日志数量，10–10000 |

每个 MCP 进程管理一个活动工程。重新 open 或 connect 会重置缓存并使旧游标失效。预览/调试调用可能执行 120 秒，请将客户端工具超时设为至少 150 秒。取消或超时不保证撤回平台已收到的上传。

## 验证与开发

```sh
npm run verify
npm run smoke -- <工程绝对路径>
# 下列命令会上传指定工程生成二维码
npm run smoke -- <工程绝对路径> --preview
npm run smoke -- <工程绝对路径> --debug
# 手机连接后，替换为实际设备代理端口
npm run smoke -- <工程绝对路径> --runtime=ws://127.0.0.1:12345/
```

[examples/hello-game](examples/hello-game) 包含刻意输出的 warn/error/异常和定时日志，使用官方测试 AppID `kwai_game_test_appid`。不要将这些诊断错误误认为业务故障。

GitHub Actions 覆盖 Windows、macOS、Linux 的协议测试和构建；这不等于在三个系统上实测快手桌面工具。

## 开源与贡献

欢迎 Star、Fork、提交 Issue 和 PR。提报兼容性问题时提供系统、Node/IDE 版本、脱敏错误和复现步骤。请勿提交账号数据、凭证、私有项目、预览二维码或带身份参数的链接。

- [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [路线图](ROADMAP.md) · [变更记录](CHANGELOG.md)
- MIT 许可证，允许在保留许可声明的前提下使用、修改、分发和商用，详见 [LICENSE](LICENSE)。
- 日志缓存与 MCP 基础结构复用自同作者的 [DouyinDevToolsMCP](https://github.com/linayanc/DouyinDevToolsMCP)，保留其 MIT 版权声明。快手适配层单独实现，不包含快手工具私有源码。
- 联系邮箱：**1772997956@qq.com**。
