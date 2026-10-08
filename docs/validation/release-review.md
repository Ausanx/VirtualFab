# 发布审查与验证

日期：2026-10-08。基线：`d942c83`；范围为已完成的区域物理参数和工艺到体硅 PN/PIN 平衡闭环（A–B），以及现有工艺、材料、文件操作和 DFT 工作区。C–F 继续按[原路线](../plans/2026-10-07-physics-closure-design.md)分别验收。

## 本轮修复

| 问题 | 修复与证据 |
| --- | --- |
| 非等距接面使用半半平均掺杂 | 改为按真实控制体积积分给定的分段掺杂。新增非等距 PN/PIN 真求解回归，核对每个控制体积和全域掺杂积分；旧实现先失败，修复后通过。 |
| 短端部仍标为精度通过 | `validation.boundary` 独立记录耗尽近似端部距离筛查，并纳入总体通过条件；保留已收敛曲线和数值检查。桌面回归确认出现“边界适用性 · 未通过”，且结果仍可导出。 |
| 历史结果沿用旧检查状态 | 读取任务时保留原始文件/哈希并重新评估返回值。旧均匀结果保持可用，旧错误非等距结果的掺杂检查失败，旧短端部结果的边界检查失败。 |
| 中断下载留下永久失效缓存 | Ubuntu、赝势、求解器归档及许可证只复用 SHA256 匹配的缓存；临时下载校验后替换，失败清理临时文件。离线模拟检查覆盖中断、重试、坏缓存恢复及有效缓存复用。 |
| 发布说明与依赖不完整 | 标明 Node ≥22.12；增加 MIT 许可、源码仓库信息和 Windows/Linux 核心 CI。中英首页使用真实截图，并将详细操作说明保留在[指南](../guide.zh-CN.md)。 |

数值改动与阈值详见[平衡基准报告](equilibrium-results.md)。新检查可以识别旧结果的数值问题，不会修改或伪造原始求解证据。

CI 按平台执行：Windows 运行全部 69 项核心测试；Linux 跳过 6 项涉及 Windows→WSL 路径转换的任务测试及 1 项 PowerShell 下载测试，运行其余 62 项。平台条件使用 Node 原生测试选项，Windows 专用检查继续完整保留。

## 本机验证

| 检查 | 结果 |
| --- | --- |
| `npm test` / `npm run check` | 69 项 Node 测试与 JavaScript 语法检查通过。 |
| `npm run test:browser` | WebGL、工艺编辑/回放、模板、材料、JSON/CSV、持久化及移动布局通过。 |
| `npm run test:desktop` / `npm run test:desktop:packaged` | 开发版与新便携版的文件操作、取消、恢复及 WebGL 通过。 |
| `npm run package:win` | 从当前源码重建硅求解器、DFT 适配器与 Windows x64 便携版成功。 |
| `npm run validate:physics -- --python` / `npm run validate:physics` | 源码 Python 与重建的冻结求解器各通过 8 组真实算例；包含非等距 PN/PIN、短端部与粗网格负对照。 |
| `npm run validate:device` | 映射 PN/PIN、粗网格警告、取消、哈希和无后端历史读取通过。 |
| `npm run test:physics:desktop -- --packaged` | 独立 PN/PIN、中文/CSV、移动布局、短端部边界状态与曲线保留通过；仅 System32 的 PATH 和错误外部数学库配置下仍可使用内置求解器。 |
| `npm run test:device:desktop -- --packaged` | 区域未知/零、映射预览、真求解、历史/失效绑定、保存重开、结果 JSON、CSV 元数据和移动布局通过。 |
| `npm run test:dft:core` | 7 项 Python 核心检查通过。 |
| `npm run test:dft:desktop -- --view-only` / `npm run test:dft:desktop:packaged -- --view-only` | 开发版与便携版的结构导入、非空可交互画布、移动布局、保存重开通过。 |

桌面检查使用隔离配置；网页和桌面交互检查未发现远程请求或渲染错误。主页三张截图为当前应用的实际渲染，均为 1440 × 1000，并已目视检查。硅截图来自本轮计算；原子能带截图读取此前已完成并校验的 Si 任务。本轮没有重新运行完整 QE 参数扫描，原数值及尚需加密的条件见 [DFT 报告](dft-results.md)。

## 保留的模型边界

默认 MoS₂/WSe₂ 参数仍未通过文献实测带阶比较；`validate:literature:strict` 应返回非零。工程回归通过不等于文献或实验标定通过。工艺数值为示例条件，掺杂为给定输入，硅模型限于 300 K、零偏压及已说明的边界假设。

独立数值实现、完整公开基准、可迁移证据包、暗态 J–V 和二维输运尚未交付。本轮发布这些限制已在中英首页说明的工程原型。

## 发布资料

公开发布的内容为项目源码、示例、文档、测试和工作台截图。运行依赖、WSL 环境、原始计算任务及本机配置不纳入 Git。检查了当前文件和全部 17 个既有提交的内容，未发现明显凭据或非项目私有数据。

介绍页的同类项目来源与结构取舍见 [README 参考记录](../readme-references.md)。项目自有源码为 MIT；第三方仍按各自许可分发。
