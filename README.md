# VirtualFab Studio

面向二维材料与薄膜器件的本地工艺工作台。提供 Windows 桌面版和开发用本地网页入口。运行时不使用 CDN、远程 AI 或云存储；项目使用本地 JSON 文件。

## Windows 桌面版

打开 `dist/VirtualFab-win32-x64/VirtualFab.exe`。整个 `VirtualFab-win32-x64` 文件夹需放在一起，程序不依赖已安装的 Node.js、浏览器或本地服务。桌面窗口由 Electron 内嵌 Chromium 渲染，目前不是 Qt 或 .NET 原生控件重写。文件菜单和顶部工具栏提供新建、打开、保存、另存为（快捷键 Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S）。编辑内容另存有本机自动恢复副本，但“保存”才会写入所选 JSON 文件；重启后恢复的副本需要重新指定保存位置。首次从旧网页版本迁移时，先在网页中下载 JSON，再从桌面版“打开项目”导入。

重新构建便携版：

```powershell
npm ci
uv venv --python 3.13 .venv-solver
uv pip install --python .venv-solver\Scripts\python.exe -r solver/requirements.txt
npm run package:win
```

## 本地 DFT 后端

“原子计算”页支持 Si 金刚石、单层 1H MoS₂ 原型，以及 CIF、POSCAR、扩展 XYZ 导入。可编辑晶胞/原子坐标与参数，运行真实 QE 的 SCF、均匀网格 NSCF 和高对称路径能带，并检查截断能、两类 k 网格与二维真空层的参数敏感度。输入与任务引用随项目保存；历史任务显示原输入，原始计算文件保留在本机应用数据目录的 `dft-jobs/<UUID>`，可用“原始文件”定位。项目 JSON 不包含这些计算文件，换电脑后需要另外转移任务目录或重算。

DFT 使用独立的 `VirtualFab-QE` WSL2 环境。便携包包含适配器和安装脚本，**没有内置 Linux 或 QE 运行时**。这台开发机器已完成后端安装；在其他电脑上，需要先安装 WSL2 和 Git for Windows，再执行一次：

```powershell
# 源码目录
npm run setup:dft
# 便携程序目录
powershell -NoProfile -ExecutionPolicy Bypass -File .\resources\dft\setup.ps1
```

安装器下载并校验 Ubuntu Base、官方 QE 7.5 源码与 Si/Mo/S 赝势，安装 Ubuntu 签名软件包并本地编译。首次安装需要联网、下载空间和编译时间，之后导入、计算和读结果均在本机执行。应用当前只支持本地磁盘上的任务目录；网络共享路径不在首版范围内。后端检查不运行真实器件计算。

任务有日志、取消和显式恢复。完整扫描可从校验后的检查点复用；被中断的扫描从头重算，旧日志保留。更换 QE、ASE、NumPy 或数值库后需建立新任务。结果文件、输入和原始证据损坏时不会显示为有效结果。方法、溯源与理论边界见 [DFT 方法](docs/validation/dft-method.md)，依赖见 [第三方说明](dft/THIRD-PARTY.md)。

首版限制为固定几何、PBE、标量相对论、非磁性、中性和固定占据。输出是采样 Kohn-Sham 带隙与晶体 E(k)，**不是光学/准粒子带隙、真空带边或器件 E(x)**；没有自动写回材料库。单次参数增量满足容差不等于渐近收敛、结构稳定或实验标定。原子计算与当前工艺几何、Te/InON 器件识别及硅 PN/PIN 连续模型保持独立。

## 开发入口

需要 Node.js 22 或更新版本。首次在本目录执行：

```powershell
npm install
npm start
```

然后打开 [VirtualFab 工作台](http://127.0.0.1:4173)。Windows 也可右键运行 `start.ps1`。端口占用时设置 `$env:VIRTUALFAB_PORT=4174` 后启动。直接调试桌面窗口可用 `npm run desktop`。

PN/PIN 本地求解使用 DEVSIM 2.11.0，便携版已包含独立求解器、Python 运行时和 OpenBLAS 0.3.31，使用者无需安装 Python 或数学库。开发或重新打包时按上面的隔离环境步骤安装构建依赖，运行 `npm run build:solver` 后调试桌面。构建时下载固定版本的公开依赖并校验归档哈希；运行求解不联网。求解器只通过桌面 IPC 接收数值参数；网页入口保留工艺编辑和界面数据视图，不开放物理 HTTP 服务。第三方许可及 UMFPACK 对应源码随求解器包保留，详情见 [求解器依赖](solver/THIRD-PARTY.md)。

## 当前可用

- 二端交叉阵列、全局底栅、局部顶栅、异质结（默认 Te / InON）和空白模板。
- 工艺卡片新增、复制、重排、禁用、删除及参数编辑；连续曝光累积，曝光后烘烤与显影是不同步骤，金属剥离显式执行；NR9-3000PY 缺少曝光后烘烤或烘烤时长为零时会停止，偏离厂商参考条件时提示未验证。
- 三维局部结构、展开层、晶圆与划片示意、可移动 Y 剖面；显示单位与 Z 放大倍率。
- 桌面工作台的资源栏和参数栏可拖动分隔条调整宽度，也可聚焦分隔条后用左右方向键调整；窄屏自动恢复固定布局。
- 25 个初始材料条目，包含 InON、Te、ITO、NR9-3000PY；可自定义、编辑能带数据和证据来源。
- 由采样几何的实际接触关系识别 PN、PIN、同型结、异质界面、导体接触、MIS、SIS、MIM 与栅控拓扑。
- 源漏与栅极按多层导体连通网络检查；双栅要求同一连通沟道。电极短接时显示诊断，不认作独立 MIM / FET 端子。
- 能带 Type-I/II/III 是独立于 n/p 类型的标签。缺失带边不绘制假数值。
- 带隙分类为光学、准粒子、输运或未确定；光学/未确定带隙不进入电子带阶和接触势垒计算。亲和能需确认为真空参考。旧 v1 项目仍可打开，缺少新分类时保留未确定。
- 单层 MoS₂/WSe₂ 的 Chiu 2015 相对界面档案，附样品条件和带阶误差。选择档案、确认条件且实际膜厚符合单层范围后应用；相对图和真空带边图分别显示。
- 独立一维体硅 PN/PIN 平衡模型：300 K、零偏压、完全电离、Boltzmann 统计和理想欧姆端部，输出平衡能带、载流子、电场、内建电势与耗尽近似对比。参数随项目保存，结果更改后需重新求解；CSV 通过桌面原生保存对话框导出。
- 本地原子计算、输入与结果溯源、参数敏感度扫描和任务恢复；首版仅验证 Si / MoS₂，不推断原子级异质界面和器件输运。
- 网格设置可修改局部窗口和 8–80 列采样，并比较不同网格的实际膜层面积；物理求解另做网格减半检查。面积差是采样敏感度，不保证达到指定误差。
- 手动参数的 Shockley I–V 示例与 CSV 导出，供检查模型，不声称从材料组合预测得到器件性能。
- 桌面项目文件支持新建、打开、保存、另存为及未保存更改提醒；自动恢复副本保存在本机。网页入口保留 JSON 上传/下载；导入格式与大小校验，模板切换/导入前保留一个 `virtualfab.project.v1.previous` 备份。

## 模型边界

这是可运行工程原型。XY 区域为采样列（默认 40 × 40 μm、40 × 40 列），Z 为连续膜厚区间。通过网格设置可调整区域与分辨率（8–80 列）。衬底真实厚度保留在参数中，视窗底部截断。图形小于两列横向采样间距会提示不可靠，中心采样误差不保证单调缩小。

沉积是顶表面几何近似；未求解全三维水平集、侧壁通量、光化学曝光、ALD 成核、湿法侧蚀/掏空、机械坍塌或材料化学反应。非热蒸镀类沉积用于 lift-off 时会提示侧壁连续包覆风险。刻蚀只使用卡片指定的目标材料速率，其他外露材料的选择比未知会提示。内置工艺数值均为演示条件，不能直接用于实验操作。

交叉阵列采用 Pt 10 nm / HfO₂ 12 nm / Au 50 nm 的示例厚度，使底电极台阶小于介质厚度。增加底电极高度可能在本顶表面模型中形成侧面短接；真实 ALD 的侧壁绝缘需另外建模和验证。

初始电子参数大多是明确标注的 estimated 示例值；InON 的带隙和电子亲和能为 missing。附带论文主要支持材料/流程的身份，不能当作每个数值的实测依据。每个参数可填写 measured / derived / estimated / missing、数值、来源与测量条件。ITO 按透明导体建模，石墨烯按半金属建模。

识别结果是结构候选，尚未将三维工艺或原子层异质结映射到自洽输运、实际掺杂标定、动态陷阱/离子迁移和完整光生过程。新增平衡求解限于独立 300 K 体硅同质 PN/PIN；不用于 Te/InON 或二维异质结。绝缘体不当成 PIN 的 i 区；MIM 不保证忆阻；栅堆栈不保证正常开关。DVS、长时记忆、隧穿、完整 I–V/转移曲线预测需要独立的物理模型与数据标定。

## 检查

文献标定与交叉验证：`npm run validate:literature` 生成三组可打开的项目、带阶残差和网格扫描 CSV。`npm run validate:literature:strict` 在定量比较不通过时返回非零；当前默认 MoS₂/WSe₂ 参数未通过实测带阶比较，工程测试通过不代表实验标定通过。方法和边界见 [文献验证方法](docs/validation/literature-calibration.md)，数值见 [运行报告](docs/validation/literature-results.md)。样例位于 `examples/literature/`，桌面操作检查为 `npm run test:literature:desktop`。

```powershell
npm test
npm run check
npm run test:browser
npm run test:desktop
npm run test:desktop:packaged
npm run validate:physics
npm run test:physics:desktop
npm run test:physics:desktop -- --packaged
npm run test:literature:desktop -- --packaged
npm run test:dft:core
npm run validate:dft
npm run test:dft:desktop
npm run test:dft:desktop:packaged
```

带 `packaged` 的检查需先执行 `npm run package:win`；开发版物理检查需先执行 `npm run build:solver`。桌面检查使用 `artifacts/` 下的隔离配置，不修改正常使用的项目。物理报告见 [PN/PIN 平衡验证](docs/validation/equilibrium-results.md)。

DFT 检查需要先安装后端；`validate:dft` 与 DFT 桌面检查运行真实计算，不是模拟成功状态。真实 Si/MoS₂ 结果、每组参数差异及 ASE 文本/XML 独立解析检查见 [DFT 运行报告](docs/validation/dft-results.md)。其宽带隙范围和直接/间接趋势检查仅作算例合理性检查，尚未完成不同电子结构引擎之间的定量交叉验证。

2026-09-30 验证：57 项 Node 测试、7 项 Python 测试与语法检查通过。Si 的 4 组和单层 MoS₂ 的 5 组真实 QE 扫描完成，文本/XML 解析检查全部通过；Si 电荷密度网格、MoS₂ 截断能仍需加密。开发与便携版均通过结构导入、中文任务目录、取消后复用已完成扫描、历史结果和保存重开检查；1440 px / 390 px 原子画布非空且可交互。便携版 PN/PIN、CSV 导出与原有网页入口回归通过。

2026-09-29 验证：42 项测试通过；4 个正常 PN/PIN 算例通过解析交叉检查和网格减半检查，2 个负对照正确报告短端部或粗网格问题。独立求解器在仅含 Windows System32 的 PATH、故意错误的外部数学库配置与中文搬移目录中均使用内置 OpenBLAS 求解。文献严格验证仍预期返回 1，默认材料库尚未获得独立实验标定。

2026-09-28 验证：开发与打包后的桌面程序均能启动、渲染三维结构、导入导出 JSON，并在关闭后恢复项目；字体层级和桌面、移动布局已通过截图检查。

2026-09-24 验证：15 项核心 / HTTP 测试通过；语法检查通过；Edge 无头浏览器完整操作检查通过，未发现浏览器错误或远程请求。浏览器测试覆盖 WebGL、NR9 步骤回放、参数编辑、卡片重排、模板切换、自定义材料、来源校验、刷新恢复、JSON 导入导出、CSV 及异常参数，另检查 1440 px 桌面和 390 px 移动布局。截图保存在 `artifacts/`，该目录不纳入版本控制。

浏览器测试使用独立临时端口和全新浏览器配置，不影响已有项目。Windows 默认使用已安装的 Edge；其他系统先执行 `npx playwright install chromium`。可通过 `VIRTUALFAB_BROWSER` 指定 Playwright 支持的浏览器通道。Playwright 只用于开发验证，运行工作台只需 Three.js。

交互 MVP 的开源项目分析与取舍见 `docs/plans/2026-09-29-interaction-mvp.md`。原始设计见 `docs/plans/2026-09-24-virtualfab-design.md`；初始 `virtualfab_engine_ui.md` 保留为远期功能草案。
