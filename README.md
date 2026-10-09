# dovetail 云端开发环境

本轮仅准备 Pi 和教学项目参考源码，没有实现产品功能。拟议的 extension / skill / 项目包边界，以及第一个练习，都还未定案。

## 当前环境

- 仓库路径：`/workspace/dovetail`。
- origin：`https://github.com/Timisic/dovetail.git`。
- 仓库从空远端起步，主分支为 `main`。远端只读核查成功。
- Git 2.52.0、Node 24.19.0、npm 11.9.0 已可用。已有全局 `user.name` / `user.email`，本轮保留，没有添加 Git 身份或认证。
- 初始仓库及其祖先没有 AGENTS.md，也没有 `.agents/skills`。

## Pi

2026-10-09 从官方 npm 注册表核实：`@earendil-works/pi-coding-agent` 的 `latest` 为 **1.1.0**，要求 Node **>=22.19.0**。

- 官方源码：<https://github.com/earendil-works/pi>。
- 安装目录：`tooling/pi/node_modules/`。
- `tooling/pi/package.json` 固定 Pi 1.1.0；`tooling/pi/package-lock.json` 固定本次解析的完整依赖和 npm integrity。
- 安装使用 `--ignore-scripts`，符合 [官方安装说明](https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/README.md)。没有运行依赖生命周期脚本。
- `scripts/pi` 默认将 Pi 状态目录设为本仓库的 `.local/pi-agent`，也允许显式指定 `PI_CODING_AGENT_DIR`；没有写入任何模型凭据、登录或发起模型调用。

```bash
cd /workspace/dovetail
./scripts/pi --version
./scripts/pi --help
# 仅添加到当前 shell 的 PATH，不修改全局或登录配置：
export PATH="$PWD/tooling/pi/node_modules/.bin:$PATH"
pi --version
```

直接使用 PATH 中的 `pi` 时，配置目录采用 Pi 自身默认值；需要项目内状态目录时使用 `./scripts/pi`。

## 新云端任务的重建

在具备 Git、Node >=22.19.0 和 npm 的新云端任务中，从仓库 `main` checkout 后运行：

```bash
bash scripts/setup.sh
```

该命令运行锁文件驱动的 `npm ci --ignore-scripts` 并验证 Pi 版本。参考源码不参与日常 setup，不是产品运行依赖。脚本不会拉取浮动 latest，也不会配置 Git 身份或认证。

需要阅读参考资料时，使用 Python 3.12+ 显式恢复或校验：

```bash
python3 scripts/fetch-references.py
python3 scripts/fetch-references.py cursor-pstack mattpocock-teach
```

`references/sources/`、node_modules 和 `.local/` 已被忽略。仓库保存清单、脚本、说明和锁文件，不依赖 `/tmp`、Mac 或现有安装跨任务保留。下载使用公开 Git HTTPS；脚本不创建认证，若访问受限，应由云端平台提供。

## 验证范围

已检查 Pi `--version` / `--help`、官方包信息和锁文件来源，执行 setup 重建并单独校验全部参考快照。参考程序与安装脚本均未执行，没有模型调用。当前没有产品实现，也没有配置 CI。
