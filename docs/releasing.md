# 发布检查

1. 运行 npm ci、npm run verify、npm pack --dry-run。
2. 检查 README 与 compatibility 中的验证矩阵，不能把协议测试写成实机验收。
3. 确认没有 .research、node_modules、IDE 源码、安装包、账号、二维码、凭证、私有工程或真实 scheme 进入 Git 与 npm 包。
4. 保留依赖及复用源码的许可证，更新 CHANGELOG 和版本。
5. 推送 GitHub 后检查 Windows/macOS/Linux 的协议测试 CI。

目前采用 GitHub 源码安装，未发布 npm 包。未来发布 npm 前需核对包名、元数据、files 清单与许可证；执行 npm publish 是独立的发布动作。
