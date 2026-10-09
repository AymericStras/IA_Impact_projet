# GPT API 与 Stitch 调用

两个入口均可在本目录直接使用，重开终端或 Codex 会话后仍有效。需要当前 macOS 用户可访问已解锁的钥匙串，以及可用网络。未安装依赖、修改全局 shell 配置或启动后台服务。

## 保存位置

| 用途 | 持久保存位置 | 运行时环境变量 |
| --- | --- | --- |
| GPT，原 RTF 标签 `sncf` | macOS 钥匙串 `sncf-openai-api-key` | `OPENAI_API_KEY` |
| Stitch，沿用 Medici 凭据 | macOS 钥匙串 `medici-stitch-api-key` | `STITCH_API_KEY` |

钥匙串 account 为当前 macOS 用户。实际密钥不在仓库中；原始 RTF 保持原样，调用时不再依赖它。只复制仓库到另一台机器不会复制凭据。

GPT 原文件未提供自定义 URL 或默认模型，因此入口使用 `https://api.openai.com/v1`，生成请求必须显式指定模型。凭据通过后端进程环境传递的方式参照 [OpenAI 官方认证文档](https://developers.openai.com/api/reference/overview#authentication)。

## 直接调用

```sh
./tools/gpt status               # 检查钥匙串，可离线
./tools/gpt check                # 只读认证检查，不生成内容
./tools/gpt models               # 查询此密钥可用的模型 ID
./tools/gpt request @request.json # 将 JSON 发送至 Responses API

./tools/stitch status
./tools/stitch tools             # 获取当前工具及参数格式
./tools/stitch call list_projects '{}'
./tools/stitch call TOOL_NAME @arguments.json
```

`request.json` 包含 `model` 和 `input` 等 Responses API 参数；模型填写 `gpt models` 返回且适合任务的 ID。`request` 和 Stitch 生成/编辑调用可能计费或修改远端内容；按具体开发任务执行。CLI 不自动重试写请求。

## 给程序注入凭据

```sh
./tools/with-api-env gpt -- python3 your_script.py
./tools/with-api-env stitch -- your_stitch_command
./tools/with-api-env all -- your_backend_command
```

凭据仅注入指定子进程，覆盖该子进程的同名环境变量，不输出密钥。不要用 `env`、`printenv`、shell tracing 或打印环境的程序作为子命令。

需要短命令时，在当前终端执行以下命令，随后可直接使用 `gpt`、`stitch`、`with-api-env`；其他目录也能通过绝对路径调用：

```sh
export PATH="/Users/zephyrsui/Developer/sncf_chatbot/tools:$PATH"
```

## 找到的原有 Stitch 接入

- Medici 项目配置：`/Users/zephyrsui/Developer/meidiqi/medici-ui-prototype/.codex/config.toml`
- 原生成脚本：该项目 `scripts/stitch-generate-screen.sh`
- 原编辑脚本：该项目 `scripts/stitch-edit-screen.sh`
- 原凭据注入脚本：`/Users/zephyrsui/.codex/skills/medici-ui-prototype-runner/scripts/with-stitch-key.sh`
- 服务地址：`https://stitch.googleapis.com/mcp`

发现的是上述命令脚本与 MCP 配置；检查时 PATH 及本机 npm 缓存中没有独立 Stitch CLI。本目录的 `tools/stitch` 是基于同一接口补充的轻量命令入口，可查询工具并调用任意工具，不依赖 Medici 源码目录，也不预设 Medici 的项目 ID。

## 验证记录

2026-10-10（Europe/Paris）：

- GPT 钥匙串读回与原 RTF 密钥完全一致；`gpt check` 认证成功，模型列表返回 146 个 ID。
- `stitch tools` 返回 15 个工具；`stitch call list_projects '{}'` 只读调用成功。
- `with-api-env all` 已验证能把两个凭据注入子进程，仅输出存在与否。
- Python 语法和三个入口链接检查通过。没有执行内容生成或修改 Stitch 项目，生成额度未验证。
- 操作前后主机 boot ID 相同，检查到的 PostgreSQL、MySQL、Docker 后台及三个既有 Node 服务进程未更换。

以上是本次验证结果；后续实际可用性取决于密钥状态、账户权限/额度和网络。
