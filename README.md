# VirtualFab Studio

面向二维材料与薄膜器件的本地工艺工作台。提供 Windows 桌面版和开发用本地网页入口。运行时不使用 CDN、远程 AI 或云存储；项目可导入导出 JSON。

## Windows 桌面版

打开 `dist/VirtualFab-win32-x64/VirtualFab.exe`。整个 `VirtualFab-win32-x64` 文件夹需放在一起，程序不依赖已安装的 Node.js、浏览器或本地服务。桌面窗口由 Electron 内嵌 Chromium 渲染，目前不是 Qt 或 .NET 原生控件重写。项目自动保存在当前 Windows 用户的应用数据中。首次从旧网页版本迁移时，先在网页中导出 JSON，再从桌面版“打开项目”导入。

重新构建便携版：

```powershell
npm ci
npm run package:win
```

## 开发入口

需要 Node.js 22 或更新版本。首次在本目录执行：

```powershell
npm install
npm start
```

然后打开 [VirtualFab 工作台](http://127.0.0.1:4173)。Windows 也可右键运行 `start.ps1`。端口占用时设置 `$env:VIRTUALFAB_PORT=4174` 后启动。直接调试桌面窗口可用 `npm run desktop`。

## 当前可用

- 二端交叉阵列、全局底栅、局部顶栅、Te/InON 异质结和空白模板。
- 工艺卡片新增、复制、重排、禁用、删除及参数编辑；曝光、曝光后烘烤与显影是不同步骤，金属剥离显式执行；NR9-3000PY 缺少曝光后烘烤时会停止显影。
- 三维局部结构、展开层、晶圆与划片示意、可移动 Y 剖面；显示单位与 Z 放大倍率。
- 桌面工作台的资源栏和参数栏可拖动分隔条调整宽度，也可聚焦分隔条后用左右方向键调整；窄屏自动恢复固定布局。
- 25 个初始材料条目，包含 InON、Te、ITO、NR9-3000PY；可自定义、编辑能带数据和证据来源。
- 由采样几何的实际接触关系识别 PN、PIN、同型结、异质界面、导体接触、MIS、SIS、MIM 与栅控拓扑。
- 源漏与栅极按多层导体连通网络检查；双栅要求同一连通沟道。电极短接时显示诊断，不认作独立 MIM / FET 端子。
- 能带 Type-I/II/III 是独立于 n/p 类型的标签。缺失带边不绘制假数值。
- 手动参数的 Shockley I–V 示例与 CSV 导出，供检查模型，不声称从材料组合预测得到器件性能。
- 自动保存在当前桌面应用或浏览器的本机存储；导入格式与大小校验；模板切换/导入前保留一个 `virtualfab.project.v1.previous` 备份。

## 模型边界

这是首个可运行工程原型。XY 区域为采样列（默认 40 × 40 μm、40 × 40 列），Z 为连续膜厚区间。通过项目 JSON 可调整区域与分辨率（8–80 列）。衬底真实厚度保留在参数中，视窗底部截断。图形小于横向采样间距无法可靠重建。

沉积是顶表面几何近似；未求解全三维水平集、侧壁通量、光化学曝光、ALD 成核、湿法侧蚀/掏空、机械坍塌或材料化学反应。非热蒸镀类沉积用于 lift-off 时会提示侧壁连续包覆风险。刻蚀只使用卡片指定的目标材料速率，其他外露材料的选择比未知会提示。内置工艺数值均为演示条件，不能直接用于实验操作。

交叉阵列采用 Pt 10 nm / HfO₂ 12 nm / Au 50 nm 的示例厚度，使底电极台阶小于介质厚度。增加底电极高度可能在本顶表面模型中形成侧面短接；真实 ALD 的侧壁绝缘需另外建模和验证。

初始电子参数大多是明确标注的 estimated 示例值；InON 的带隙和电子亲和能为 missing。附带论文主要支持材料/流程的身份，不能当作每个数值的实测依据。每个参数可填写 measured / derived / estimated / missing、数值、来源与测量条件。ITO 按透明导体建模，石墨烯按半金属建模。

识别结果是结构候选，尚未包含自洽 Poisson/输运、实际掺杂标定、动态陷阱/离子迁移和完整光生过程。绝缘体不当成 PIN 的 i 区；MIM 不保证忆阻；栅堆栈不保证正常开关。DVS、长时记忆、隧穿、完整 I–V/转移曲线预测需要独立的物理模型与数据标定。

## 检查

```powershell
npm test
npm run check
npm run test:browser
npm run test:desktop
npm run test:desktop:packaged
```

最后一个检查需先执行 `npm run package:win`。桌面检查使用 `artifacts/desktop-smoke-profile` 隔离配置，不修改正常使用的项目。

2026-09-28 验证：开发与打包后的桌面程序均能启动、渲染三维结构、导入导出 JSON，并在关闭后恢复项目；字体层级和桌面、移动布局已通过截图检查。

2026-09-24 验证：15 项核心 / HTTP 测试通过；语法检查通过；Edge 无头浏览器完整操作检查通过，未发现浏览器错误或远程请求。浏览器测试覆盖 WebGL、NR9 步骤回放、参数编辑、卡片重排、模板切换、自定义材料、来源校验、刷新恢复、JSON 导入导出、CSV 及异常参数，另检查 1440 px 桌面和 390 px 移动布局。截图保存在 `artifacts/`，该目录不纳入版本控制。

浏览器测试使用独立临时端口和全新浏览器配置，不影响已有项目。Windows 默认使用已安装的 Edge；其他系统先执行 `npx playwright install chromium`。可通过 `VIRTUALFAB_BROWSER` 指定 Playwright 支持的浏览器通道。Playwright 只用于开发验证，运行工作台只需 Three.js。

当前实现依据：`docs/plans/2026-09-24-virtualfab-design.md`。初始 `virtualfab_engine_ui.md` 保留为远期功能草案。
