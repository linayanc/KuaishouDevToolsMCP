# Kuaishou DevTools MCP

[中文](README.md) · [Tool contract](docs/tools.md) · [Compatibility](docs/compatibility.md)

A community MCP server for AI coding assistants to open Kuaishou mini-game exports, generate phone preview/debug QR codes, and read game Console logs through a local device debugging proxy. MIT licensed, independent of Kuaishou.

This targets **Kuaishou mini-game DevTools**, not the mini-program `kma` CLI or short-video APIs.

## Tools

| Tool | Purpose |
| --- | --- |
| `kuaishou_open_project` | Open an imported game; optional import can rewrite project.config.json |
| `kuaishou_preview` | Upload a development preview and return a PNG QR code |
| `kuaishou_start_debug` | Upload a phone debugging build and return its QR code |
| `kuaishou_connect_runtime` | Explicitly bind the local device CDP proxy to the open project |
| `kuaishou_get_logs` | Recent Console logs with level/text filters |
| `kuaishou_get_errors` | Errors/asserts, uncaught exceptions and runtime stacks |
| `kuaishou_watch_logs` | Cursor pagination and bounded long polling |

**Current adapter:** Windows / Kuaishou mini-game IDE 2.0.6. Opening a real project and generating a real preview QR were tested. Phone logs are pending live acceptance; protocol capture, pagination, gaps and reconnection are tested using local HTTP/WebSocket fixtures. macOS, other IDE versions and Unity device logs remain unverified.

IDE 2.0.6 runs/debugs games on a phone, not in its desktop project page. The server never substitutes editor logs for game logs. Its preload bridge is an implementation detail and can change after IDE upgrades.

## Install

Requires Node.js 22+, Git and [Kuaishou mini-game DevTools](https://ks-game-docs.kuaishou.com/minigame/start/devtool.html). Complete IDE login and import your exported game directory.

```sh
git clone https://github.com/linayanc/KuaishouDevToolsMCP.git
cd KuaishouDevToolsMCP
npm ci
npm run build
```

Source installation only; this package is not published on npm yet.

Save your work and exit other IDE instances before starting one with local debugging enabled:

```powershell
Start-Process -FilePath 'C:\Program Files\kuaishou-minigame-devtools\快手小游戏开发者工具.exe' -ArgumentList '--remote-debugging-port=9223','--remote-debugging-address=127.0.0.1'
node .\dist\index.js --doctor
```

Adjust the executable path to your installation. Keep the debugging endpoint local. The server does not patch IDE files or read account credential files.

## MCP configuration

Replace paths for your machine:

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

[Codex TOML example](examples/codex.toml). Use stdio without `--doctor`/`--help` in server arguments.

## Workflow

1. Call `kuaishou_open_project` with the absolute export directory. Set `importIfMissing: true` only if you want IDE import; it may rewrite project.config.json.
2. For a preview, call `kuaishou_preview` and scan with Kuaishou. Preview/debug tools upload code but do not publish a release.
3. For logs, call `kuaishou_start_debug` and scan on a phone on the same LAN. Run `node dist/index.js --doctor` after the device inspector appears.
4. Confirm that the listed device proxy belongs to this game. Bind it with `kuaishou_connect_runtime({projectPath, webSocketUrl:"ws://127.0.0.1:<proxy-port>/"})`. Ownership is caller-declared, not automatically verified. Never use the phone IP or IDE renderer `/devtools/page/...` socket.
5. Read `kuaishou_get_errors`/`kuaishou_get_logs`. Follow `nextCursor` with `kuaishou_watch_logs` while `hasMore` is true.

Each process has one active project. Reopening/rebinding resets logs and invalidates old cursors. Check `connection.state`, `possibleGapCount`, `dropped` and `omitted`; an empty error list alone does not establish that the game is healthy. Configure at least 150 seconds for preview/debug calls. Cancellation cannot retract uploads already received by Kuaishou.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `KUAISHOU_CDP_ENDPOINT` | `http://127.0.0.1:9223` | Local IDE HTTP debugging endpoint |
| `KUAISHOU_ALLOWED_ROOTS` | `[]` | JSON array of permitted absolute roots; real paths enforced |
| `KUAISHOU_LOG_CAPACITY` | `2000` | Retained entries, 10–10000 |

## Development

```sh
npm run verify
npm run smoke -- <absolute-export-path>
# Uploads the specified project for preview/debug
npm run smoke -- <absolute-export-path> --preview
npm run smoke -- <absolute-export-path> --debug
npm run smoke -- <absolute-export-path> --runtime=ws://127.0.0.1:12345/
```

The [diagnostic example](examples/hello-game) uses the official test AppID and intentionally emits warnings/errors. Cross-platform GitHub CI verifies the server protocol/build, not the desktop IDE on all platforms.

## Open source

Issues and PRs are welcome; include OS/Node/IDE versions and sanitized repro steps. Do not share credentials, private game code, QR codes or identity-bearing preview URLs.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE).

The log/MCP infrastructure is adapted from the same author's [DouyinDevToolsMCP](https://github.com/linayanc/DouyinDevToolsMCP) with its MIT notice retained. The Kuaishou adapter contains no bundled vendor source. Contact: **1772997956@qq.com**.
