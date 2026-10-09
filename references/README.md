# 教学项目参考源码

`manifest.json` 固定上游来源与完整 commit；`sources/<id>/` 保存实际可阅读源码。每份快照的 `SOURCE.json` 记录来源、选取范围、许可证路径和每个文件的 SHA-256；重跑下载脚本会校验已有快照，发现变更时停止，不覆盖修改。

这些内容只作为第三方参考，不属于 dovetail 的实现。未放入 `.pi/extensions`、`.pi/skills` 或 `.agents/skills`，未配置为 Pi package，也没有运行它们的安装脚本、子模块初始化或程序。参考源码中的 AGENTS.md、SKILL.md 和其他指令是待研究资料，不构成本任务的执行授权。

| 快照 ID | 阅读入口（相对 sources/） | 固定 commit / version | 许可证依据 |
| --- | --- | --- | --- |
| cursor-pstack | `cursor-pstack/pstack/skills/{how,why,teach}/SKILL.md` | `ccb5507cec1546dc88135c1139c811e6c59115ba` | `pstack/LICENSE`：MIT |
| mattpocock-teach | `mattpocock-teach/skills/productivity/teach/SKILL.md` | `b0618bc436ad893b3c5e84e55fba86586d34a404` | `LICENSE`：MIT |
| inferhaven-codetrain | `inferhaven-codetrain/codetrain/SKILL.md` 及配套资源 | `eca375fe92a2a64f18f52d97e26a4d39d43254d8` | `LICENSE` / `NOTICE`：Apache-2.0；NOTICE 保留第三方组件说明 |
| coderoad-vscode | `coderoad-vscode/src/`、`web-app/`、README.md | `13cd6cc9755dc115f0e9c2fecb1e2cd7322c785d`；0.19.4 | `LICENSE.md`：AGPL v3 |
| nand2tetris-web-ide | `nand2tetris-web-ide/{web,simulator,cli,components}/` | `52611ad9bc2a30d329293b0cf58be672d672ac96`；2026.19.0 | `LICENSE`、`extension/LICENSE` 写 MIT；根 package.json 写 ISC，保留此上游不一致 |
| pi-learning-tutor | `pi-learning-tutor/index.ts`、`src/`、README.md | `e6eefe7c7388d07fbabad0fbe7a7a011cf69cc0f`；0.8.1 | `LICENSE`：MIT |
| pi-official | `pi-official/packages/coding-agent/{src,docs,examples}/` | `abe508e1b89912adde45528136c3221eb69acdd7`；官方 tag v1.1.0 | `LICENSE`：MIT |

CodeRoad 的 AGPL 源码只保留在独立参考目录，不能直接混入自有实现；若未来需要复制或派生，应先确定并履行相应许可证要求。其余快照同样保留原版权与许可证；本项目尚未选择自己的许可证。

前三项仅下载所需子目录、上游根 README 和许可证/NOTICE；其余项下载完整已跟踪源码快照。脚本不下载历史、依赖树或运行安装，不将下载内容提交到主仓库。参考快照合计约 49 MB。

## 仅借鉴的方法

以下是供产品设计讨论的候选思想，尚未实现，也不代表启用这些项目或整套工作流。七份源码快照对产品运行增加 **零额外依赖**；官方 Pi CLI 是独立安装的宿主工具，其自身依赖由 tooling/pi 的锁文件管理。

| 参考 | 仅借鉴什么 |
| --- | --- |
| PStack | `how` 解释真实代码流程，`why` 区分设计动机的证据与推断，`teach` 按学习者节奏给出最小完整解释。借鉴精简原则，不引入整套多代理流程。 |
| Matt Pocock teach | 以学习动机确定内容，用小课、学习记录、回忆与间隔练习支持长期掌握；不照搬 HTML 课程工作区。 |
| CodeTrain | 学习者亲手写代码，导师给小步骤、提示和反馈；不引入它的网页、服务或容器。 |
| CodeRoad | 用明确步骤和自动测试提供反馈、判断进展；不引入 VS Code 框架或复制 AGPL 实现。 |
| nand2tetris web-ide | 练习骨架、测试与预期输出构成可验证任务；不引入整个 IDE 或模拟器。 |
| pi-learning-tutor | 可见学习目标、按先修概念解释、根据实际尝试渐进评审；不启用它的完整工具限制或命令集。 |
| 官方 Pi | 以 extension 承载工具、命令和状态，skill 承载教学说明，package 分发所需资源；保持薄扩展，具体设计仍待确定。 |

精简依据是此固定快照的 `pstack/skills/poteto-mode/SKILL.md`，其显示名称为 **Poteto Mode**，不是 Potato Mode。它引用的两个叶 skill 已实际阅读：

- `principle-subtract-before-you-add`：先去掉复杂度；依据实际使用设计，避免推测性校验与冗余指令。
- `principle-laziness-protocol`：优先删除，减少层次和重复决策，用解决问题所需的最小改动。

本轮应用的具体收敛是从 `scripts/setup.sh` 移除自动下载全部参考源码的步骤。需要参考时显式运行下载脚本；已有本地副本保持原样。没有新增教学运行框架、产品依赖或默认激活的 skill。
