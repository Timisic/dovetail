# Dovetail

Dovetail 在 Pi 中带你改一个几行的 Agent 工具调用函数。你只需要认识基本循环。

## 开始练习

在你想存放练习的目录，用已配置好的 Pi 加载本项目：

```bash
pi -e /absolute/path/to/dovetail
```

在本仓库中也可以运行 `pi -e .`。云端已安装的 Pi 1.1.0 可用以下命令启动：

```bash
cd /workspace/dovetail
./scripts/pi -e .
```

`scripts/pi` 默认把 Pi 配置放在 `.local/pi-agent`，不会读取你平时的用户配置。需要使用已有配置时，显式设置 `PI_CODING_AGENT_DIR` 为该配置目录，或使用你已经配置好的 `pi`。本项目不安装认证、不生成凭据、不修改持久 Pi 设置。

输入 `/dovetail start`。首次开始会运行起始代码，显示固定请求 `greet({name: "Ada"})`、实际调用、`Hello, Ada!` 和最终回复。恢复练习会运行你当前保存的代码，可能失败或报告语法错误；教学会依据实际反馈展开。示例使用固定脚本，不调用真实模型。

然后修改 `.dovetail/project/agent.mjs`。用循环按 `call.name` 找到工具，把 `call.arguments` 交给 `execute`；找不到时抛出包含工具名的错误。只有 `greet` 这一个工具。检查会换一个姓名，并请求不存在的 `weather`。

你可以直接编辑文件，也可以在聊天中给出完整代码或明确逻辑，教学助手会先读取当前源码，再应用代码并测试。你可以先猜结果，或明确请求答案；没有强制测验。查看答案会记录帮助，不会自动应用代码。聊天教学使用你的 Pi 模型，可能产生你已有服务的费用。

`/dovetail status` 显示当前状态。`/dovetail off` 暂停教学并保留代码。再次 `start` 或重启 Pi 会保留代码和检查记录，即使没有保存聊天。测试通过只证明观察到的行为，不代表独立掌握。

## 运行检查

```bash
npm test
npm run verify
```

不需要在仓库根目录安装依赖。产品只依赖 Pi 宿主和 Node 内置模块。检查用仓库已有的 `tooling/pi` 安装。`test/verify.mjs` 以独立临时目录和干净环境启动实际 Pi CLI，通过 RPC 检查命令、skill、启动、状态、暂停和恢复；不发送普通聊天，不启动模型回合。

[验证操作说明](.cursor/skills/verify-dovetail/SKILL.md) 包含完整步骤。证据保存在 `.local/verification/`，临时进程和目录在结束后清理，证据保留。已验证 Linux Node 执行、Pi 1.1 CLI/RPC 和实际扩展加载器。Mac、交互 TUI、真实模型教学表现尚未验证。

每个工作目录只运行一个 Pi 进程。Dovetail 的完整操作在该进程内排队。执行代码使用独立 Node 子进程、两秒超时、输出上限和不含凭据的最小环境。这用于可信学习代码，不是隔离恶意代码的沙箱。首次创建先在独立暂存目录中构建完整项目，再发布；源文件与检查记录分别通过独立暂存目录原子替换。中断留下的暂存文件不会阻止重试，也不会被自动删除。应用代码会在暂存完成后重新校验项目和当前源码，但检查与替换之间仍可能发生外部编辑；这是乐观冲突检查，不是跨进程锁或严格的比较并交换。检查记录保存实际执行的源码，之后与当前源码逐字比较；中断或直接编辑造成的旧检查会显示过期。新 checkpoint 使用版本 2；合法版本 1 在读取时保留代码、暂停状态和答案帮助标记，清除无法验证的旧检查，下一次正常保存写入版本 2。状态查看不写入文件，异常 checkpoint 不会被自动重置。

实现结构见 [架构图](docs/architecture.svg)（[可编辑 DOT](docs/architecture.dot)）。

## 重建云端环境

仓库为 `/workspace/dovetail`，origin 为 `https://github.com/Timisic/dovetail.git`。安装的 Pi 是 `@earendil-works/pi-coding-agent` 1.1.0，要求 Node >=22.19.0；锁文件与安装脚本保留在 `tooling/pi` 和 `scripts`。

```bash
bash scripts/setup.sh
```

脚本运行 `npm ci --ignore-scripts` 并验证版本。它不配置 Git 身份或认证。需要参考源码时显式恢复固定快照：

```bash
python3 scripts/fetch-references.py
```

[参考清单](references/README.md) 记录来源和许可证。参考快照不属于产品运行依赖。练习代码是原创；Pi 的工具查找代码只作为教学链接。`.dovetail/`、`.local/`、参考源码和已安装依赖均被 Git 忽略。
