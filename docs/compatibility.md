# 兼容性与排障

最后验证：2026-10-12。

| 环境 / 功能 | 状态 | 证据与限制 |
| --- | --- | --- |
| Windows 10 / Node 24.13.0 / 快手小游戏 IDE 2.0.6 | 本机实测 | 本地 CDP endpoint 与 project-list/project preload 接口 |
| 已导入小游戏工程打开、唯一窗口复用 | 本机实测 | examples/hello-game，验证返回项目 id/path |
| 真机预览上传、二维码 PNG | 本机实测 | 测试 AppID，IDE 返回真实 preview scheme，MCP 生成 PNG |
| 真机调试上传、二维码 PNG | 本机实测 | 真实 MCP stdio 调用 kuaishou_start_debug 成功 |
| 手机扫码后的 Console/error/异常 | 待实机验收 | 尚未接入手机，不声称已有真实游戏日志 |
| Runtime Console、堆栈、分页、过滤、缓存、重连 | 协议集成测试 | 本地 HTTP/WebSocket 夹具，包含断线回放去重 |
| 7 工具 MCP 握手、参数校验与图片返回 | 自动化测试 | TypeScript SDK stdio 客户端 |
| 路径限制、符号链接、远程 endpoint 拒绝 | 自动化测试 | realpath 与本机 URL 校验 |
| Unity 原生 / WebGL 真机日志 | 待验证 | 提供导出配置校验路径，不推断已支持 Unity 调试协议 |
| macOS / 其他 IDE 版本 | 待验证 | preload 与安装路径都可能不同 |
| Linux 桌面 IDE | 不声明支持 | CI 只运行服务协议测试与构建 |

## 为什么不使用 kma

快手小程序 IDE 的官方文档提供 kma CLI；快手小游戏 IDE 2.0.6 是另一套应用。这个适配器使用其已有 preload 项目/真机预览/真机调试接口。该接口不是稳定的官方外部 API，升级可能改变方法名、返回值或目标布局。

只通过固定接口调用 IDE 操作。游戏日志连接只发送 Runtime.enable，不修改工具安装文件、不注入游戏代码、不读取账号凭证文件、不接管登录、不暴露通用 Runtime.evaluate 工具。

## 打开失败或超时

保存工作并退出其他 IDE，再以 `--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1` 启动一个实例。2.0.6 多开时编辑器的命名管道可能冲突，导致 open 一直等待；进程启动成功不代表编辑器可用。

运行 `node dist/index.js --doctor`。如果看不到 project-list 窗口，先完成 IDE 登录。工程配置需位于导出目录，而不是 Unity Assets 源目录。默认要求先导入 IDE；设置 importIfMissing 可导入，但 IDE 可能重写配置。

同一工程存在多个 project 窗口会返回 IDE_AMBIGUOUS，关闭重复窗口再试。适配器不会随便选一个窗口。

## 打开成功但没有日志

这是正常的中间状态：IDE 2.0.6 的桌面窗口不运行小游戏。生成 start_debug 二维码，用同一局域网的快手手机端扫码，等待设备调试窗口打开。

再次运行 doctor，查看 deviceProxies；检查该窗口属于当前工程，再用 `ws://127.0.0.1:<代理端口>/` 调用 connect_runtime。候选地址来自本机 IDE inspector URL 的 ws 参数，doctor 不访问手机，也不验证候选设备归属。

不要把 IDE endpoint 的 `/devtools/page/...` 地址传给 connect_runtime。它只包含编辑器或项目 UI 的日志。没有正确连接时工具明确报错。

## 设备断线或端口变化

服务每 2 秒重连已绑定地址。旧缓存仍可读，并显示 disconnected、lastError 和 possibleGapCount。重新扫码生成新的代理端口后需显式 connect，缓存和旧游标会重置。CDP 历史回放由平台决定，无法保证补回断线日志。

IDE 本身的设备桥接实现可能限制多个调试消费者；当前协议测试不等同于对真实手机代理多客户端行为的验收。

## 预览或调试失败

在 IDE 手动确认登录、appid、game.json、权限和网络。不同项目/引擎的参数可能不同，Unity 上传和日志还需针对真实导出包验证。预览/调试不是发布正式版。

将客户端超时设为至少 150 秒。不要把密码发给 MCP，不要提交预览二维码或真实 scheme 到公开 Issue。

## 参考

- [官方快手小游戏开发者工具](https://ks-game-docs.kuaishou.com/minigame/start/devtool.html)
- [小游戏版本类型](https://ks-game-docs.kuaishou.com/minigame/guide/framework/code-package.html)
- [小程序 kma CLI（另一套产品）](https://open.kuaishou.com/docs/develop/developerTools/cli.html)
- [Chrome DevTools Protocol Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

仓库只包含本项目适配器、示例和测试；不包含 IDE 安装包、研究时读取的厂商源码、账号文件或私有业务工程。
