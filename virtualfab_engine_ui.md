# 半导体与叠层器件虚拟工艺制造与缺陷诊断系统 (VirtualFab Engine)
## 软件架构、UI 交互与工程落地设计规范文档

---

## 1. 软件架构总览 (System Architecture)

系统基于“数据驱动 + 物理场微元演化 + 状态响应式 UI”的解耦思想设计。为了保证微米/纳米级工艺演化的毫秒级交互体验，计算核心与渲染表现层严格分离。

```
+-----------------------------------------------------------------------------------+
| 5. 表现与交互层 (Presentation & UI Layer)                                          |
|    - 节点工作流画布 (Node Canvas)                                                  |
|    - 3D 空间透视渲染器 (Three.js / WebGPU Viewport)                               |
|    - 2.5D 高精剖面尺规视窗 (2.5D Metric Slice Viewport)                            |
|    - 属性检查器与工艺诊断面板 (Inspector & DRC Report Drawer)                     |
+-----------------------------------------------------------------------------------+
| 4. 业务逻辑与调度层 (Orchestration & Verification Layer)                           |
|    - DAG 流程拓扑分析与时间轴调度器 (Recipe Timeline & Pipeline Scheduler)        |
|    - 几何/物理设计规则检查器 (DRC Engine)                                         |
|    - 外部 TCAD 脚本生成与求解代理接口 (TCAD Adapter Interface)                    |
+-----------------------------------------------------------------------------------+
| 3. 工艺知识与检索服务层 (Knowledge & Parameter Hub)                                |
|    - 文献与工艺手册数据抓取代理 (Web & Cleanroom Database Harvester)               |
|    - 阿伦尼乌斯温控速率拟合器 (Arrhenius Equation Fitting Engine)                  |
|    - 本地材料与刻蚀选择比矩阵 (Material & Selectivity Matrix DB)                   |
+-----------------------------------------------------------------------------------+
| 2. 几何形貌物理演化引擎 (Morphology & Physics Engine)                             |
|    - 稀疏体素场与有符号距离场核心 (Sparse SDF / Level-Set Engine - OpenVDB/C++)   |
|    - 各向异性刻蚀 / 视线通量微观阴影偏微分算子 (PDE Solvers)                      |
|    - 等值面动态提取器 (Dual Contouring / Marching Cubes)                           |
+-----------------------------------------------------------------------------------+
| 1. 基础数据与硬件抽象层 (Foundation Layer)                                        |
|    - 连续内存块管理 (GPU Buffer & Memory Pool)                                    |
|    - GDSII / DXF 版图解析器                                                        |
|    - 本地 SQLite 缓存与项目 Recipe 存储                                           |
+-----------------------------------------------------------------------------------+
```

---

## 2. 软件 UI 界面线框与交互设计规范 (UI/UX Specification)

主工作区采用工程仿真软件经典的“**四分区联动沉浸式工作台**”布局，支持拖拽、自适应缩放与双视窗无缝协同。

### 2.1 主界面线框布局图 (Layout Wireframe)

```
+-------------------------------------------------------------------------------------------------------+
| [图标] VirtualFab Studio v1.0   [文件] [编辑] [工艺库] [版图导入] [DRC检测] [导出TCAD]   [项目: Tandem_01] [-][□][×] |
+---------------------+---------------------------------------------------------+-----------------------+
| 工艺元件库 (Palette)| 主工作视窗 A: 3D 三维全局透视区                          | 属性检查器 (Inspector)|
|---------------------| [ 视角切换: 顶/前/侧/透视 ] [ 显示网格 ] [ X-Ray透视模式 ] |-----------------------|
| [ 搜索工艺/材料... ]|                                                         | 选定节点:             |
| > 衬底准备          |                                                         | [ Wet_Etch_Step_04 ]  |
|   - 晶圆基底 (Si)   |                                                         |-----------------------|
|   - 玻璃基底 (Glass)|                                                         | 基础参数:             |
| > 薄膜沉积          |                                                         | - 反应试剂: HCl (15%) |
|   - ALD 原子层沉积  |                                                         | - 槽液温度: [45.0] °C |
|   - PVD 磁控溅射    |                                                         | - 处理时间: [30.0] s  |
|   - 热蒸镀金属      |                                                         |-----------------------|
|   - 旋涂平坦化      |                                                         | 速率与选择比:         |
| > 光刻图案化        |                                                         | - 垂直速率: 3.5 nm/s  |
|   - 旋涂光刻胶      |                                                         | - 横向掏空: 2.1 nm/s  |
|   - 掩膜曝光显影    |---------------------------------------------------------| - 阻挡层比: 1:120     |
| > 刻蚀工艺          | 副工作视窗 B: 2.5D 高精剖面微米尺规视窗                  | [ 🌐 联网校准参数 ]   |
|   - 湿法化学刻蚀    | [ 切片位置: Y = 250.0 nm ] [ 标尺单位: nm ] [ 锁定比例 ]|-----------------------|
|   - 反应离子刻蚀 RIE|  500nm +------+           +------+                      | 工艺体检报告 (DRC)    |
|   - 离子束剥离      |        | 胶层 |           | 胶层 |                      |-----------------------|
| > 热退火处理        |  250nm +------+-----------+------+                      | ✕ [严重] 步4: 结构断阶|
|                     |        | 钻刻空腔 (Undercut)      |                      |   金属侧壁厚度仅3.2nm |
| [+ 新建自定义卡片]  |    0nm +==========================+                      | ⚠ [警告] 步4: 掏空超限|
|                     |  (纳米尺规与材料色标: 衬底[灰] 金属[金] 介质[蓝] 胶[红]) | 点击定位三维微观区域  |
+---------------------+---------------------------------------------------------+-----------------------+
| 底部：节点工作流编排画布 (Node-based Pipeline Canvas) 与 仿真时间轴控制条                             |
|-------------------------------------------------------------------------------------------------------|
|  +------------+       +------------+       +------------+       +------------+       +------------+   |
|  | Substrate  | ===>  | PVD_Metal  | ===>  | Photoresist| ===>  | Litho_Mask | ===>  | Wet_Etch   |   |
|  | (Si Wafer) |       | (Au 100nm) |       | (PR 500nm) |       | (Pitch 2um)|       | (HCl 45°C) |   |
|  +------------+       +------------+       +------------+       +------------+       +------------+   |
|                                                                                                       |
| [⏮ 倒退] [▶ 连续模拟] [⏭ 单步步进] [⏹ 终止]   | 时间游标: [====●=================] 步 4 / 7 (耗时: 120ms)|
+-------------------------------------------------------------------------------------------------------+
```

### 2.2 核心视窗交互规范与状态流转

#### 1. 双视窗联动机制 (Dual-Viewport Synchronization)
* **3D 全局视窗 (Window A)**：
  * 基于 WebGPU / Three.js 渲染由体素场提取的三角网格。
  * 提供一个半透明的“**切片控制手柄（Slice Gizmo Plane）**”。用户在 3D 场景中拖动切片平面，平面的空间截距即时传递给 2.5D 视窗。
* **2.5D 剖面尺规视窗 (Window B)**：
  * 毫秒级刷新对应截面上的材质轮廓线，并自动绘制纳米标尺（Tick marks）与厚度尺寸标注。
  * **手绘/DIY切片功能**：默认根据光刻掩膜的关键线段（如栅线横向剖面）自动定位。若用户启用画笔工具，在 3D 俯视图上绘制任意折线/直线，视窗 B 立即展开对应的剖面展开图。

#### 2. 节点图交互设计 (Node Canvas)
* 每个节点具备三个逻辑状态区：
  * **输入端点（Input Ports）**：接收上一道工序传递的几何体素状态及表面物理化学条件。
  * **节点核心体（Body）**：展示当前步骤的工艺缩略图、工艺类型、关键耗时与状态指示灯（绿色表示校验通过，黄色表示接近工艺裕度，红色表示几何断裂）。
  * **输出端点（Output Ports）**：输出本步演化后的新几何实体。
* **A/B 平行方案测试（Branching）**：允许从同一前驱节点引出多根连线接入不同的刻蚀节点（如方案 A：刻蚀 30 秒；方案 B：刻蚀 45 秒）。此时视窗支持“分屏比对（Split Screen Compare）”，直接对比两种工艺对台阶和掏空的不同影响。

#### 3. 诊断反向索引高亮 (DRC-to-3D Focus)
* 当右下角 DRC 面板爆出致命结构错误（如“金属断阶”或“底层被意外侵蚀穿通”）时，用户单击该警告卡片：
  * 3D 相机在 400ms 内平滑补间动画飞向该缺陷点的空间坐标；
  * 其余正常结构半透明化，缺陷区域以红色脉冲线框高亮闪烁，并在局部弹出尺寸测量气泡，显示“当前厚度: $3.2\,\text{nm} <$ 阈值 $20.0\,\text{nm}$”。

---

## 3. 核心数学模型与形貌演化算法 (Morphology Engine)

本引擎拒绝普通 CAD 机械式的几何贴层，基于**有符号距离场（SDF）与水平集（Level-Set）**求解偏微分方程，实现微观形貌的真实物理推演。

### 3.1 水平集演化控制方程
整个三维空间定义为连续标量场 $\phi(\vec{x}, t)$，其中：
* $\phi(\vec{x}, t) < 0$：表示材料实体内部；
* $\phi(\vec{x}, t) = 0$：表示材料与外界环境的物理接触界面；
* $\phi(\vec{x}, t) > 0$：表示环境空间（真空/气体/反应液）。

界面随工艺推进的动力学方程由 Hamilton-Jacobi 偏微分方程控制：

$$\frac{\partial \phi(\vec{x}, t)}{\partial t} + v(\vec{x}, \vec{n}, \text{Params}) |\nabla \phi(\vec{x}, t)| = 0$$

其中，局部法向量 $\vec{n} = \frac{\nabla \phi}{|\nabla \phi|}$，推进速度 $v$ 由具体的工艺算子决定。

### 3.2 典型微观工艺算子细化

#### 1. 湿法化学刻蚀算子（以盐酸刻蚀为例，包含掏空与选择比）
腐蚀推进不仅包含垂直向下分量，还包含横向钻刻。局部演化速度定义为：

$$v_{\text{etch}}(\vec{x}, \vec{n}) = - \left( R_v (\vec{n} \cdot \vec{e}_z)^2 + R_h [1 - (\vec{n} \cdot \vec{e}_z)^2] \right) \cdot S(\text{MatID}(\vec{x}))$$

* $R_v, R_h$：垂直与横向刻蚀速率（$\text{nm/s}$）；
* $\vec{e}_z$：衬底法向；
* $S(\text{MatID})$：刻蚀液对不同材料的选择比矩阵。当遇到阻挡层时，$S \to 0$，演化波前自动“刹车”，形成自然的圆弧形 Undercut。

#### 2. PVD / 蒸镀定向阴影沉积算子（复现台阶覆盖与断阶）
生长速度由入射微观立体角的视线可见度积分决定：

$$v_{\text{pvd}}(\vec{x}) = R_0 \int_{\Omega} \Theta(\vec{x}, \vec{\omega}) (\vec{\omega} \cdot \vec{n}) f(\vec{\omega}) \, d\Omega$$

* $\Theta(\vec{x}, \vec{\omega}) \in \{0, 1\}$：视线遮挡函数。通过对 SDF 场沿方向 $\vec{\omega}$ 执行 Ray-marching 确定；
* $f(\vec{\omega})$：通量角分布函数（通常为 $\cos^n\theta$）。在悬空结构后方或深宽比过高的凹槽侧壁，$\Theta = 0$，产生微观阴影区，导致侧壁变薄或金属断阶。

#### 3. 理想保形 ALD 沉积算子
ALD 具备自限性吸附能力，在所有外露表面严格沿法向均匀生长：

$$v_{\text{ald}}(\vec{x}) = \text{GPC} \times f_{\text{cycle}}$$

无论几何结构多么复杂，均可保持 100% 的台阶覆盖率，并自然实现拐角圆化。

---

## 4. 实时工艺知识中枢与联网检索机制 (Knowledge & Search Engine)

为防止用户输入新工艺时大模型产生“参数幻觉”，系统设计了严谨的**检索-拟合-标定流水线**。

```
[ 用户新增工艺节点: "45°C 15% 盐酸刻蚀 ITO" ]
                        │
                        ▼
[ 1. 结构化检索 Agent 发起定向检索 ]
     - 检索半导体微纳工艺数据库 (BYU Cleanroom, Stanford SNF, Nanofab Guide)
     - 检索学术期刊工艺文献 (IEEE ED, ACS, ScienceDirect)
                        │
                        ▼
[ 2. 文本实体抽取与参数提取 ]
     - 抽取参数: 反应物、衬底材料、温度 T、浓度 C、垂直速率 Rv、横向速率 Rh
                        │
                        ▼
[ 3. 物理规律校正: 阿伦尼乌斯拟合 ]
     - 依据公式拟合活化能 Ea:  R(T) = R_0 * exp( -Ea / (kB * T) )
     - 过滤偏离拟合曲线的离群异常值 (Outliers)
                        │
                        ▼
[ 4. 结构化存入本地库并输出工艺窗口 ]
     - 返回推荐参考值、上下安全边界 (Min/Max Window)、文献来源 DOI
     - 自动映射到节点右侧属性面板，提供交互滑块
```

---

## 5. 结构矛盾与设计规则检查 (DRC Engine)

工艺每推进单步，DRC 引擎即时对当前体素场做几何拓扑与物理有效性扫描：

| 故障类型 | 检测算法与几何判据 | 关联的电池/器件性能致命失效 |
| :--- | :--- | :--- |
| **断阶 / 侧壁漏镀 (Step Coverage Breakage)** | 沿导电薄膜表面扫描法向厚度 $T(\vec{x})$。若在陡峭侧壁（法向与水平夹角 $> 70^\circ$）处，$T(\vec{x}) < 20\% \times T_{\text{nominal}}$，触发告警。 | **电极断路（Open Circuit）**：电流无法引出，串联电阻极大。 |
| **严重侧向掏空 (Excessive Undercut)** | 计算湿法刻蚀向掩膜下方的钻蚀距离 $L_{\text{undercut}} = R_h \cdot t$。若 $L_{\text{undercut}} > L_{\text{safe}}$ 导致上层支撑面积归零，判定悬空倒塌。 | **结构机械崩塌 / 电极脱落**：器件失效。 |
| **意外化学侵蚀 (Chemical Attack)** | 扫描所有直接接触刻蚀液的外表面体素。若底层未做保护的材料在当前化学品下的腐蚀速率 $> 0$，判定发生非预期腐蚀。 | **短路 / 钝化层破坏**：器件漏电、严重非辐射复合。 |
| **套刻失准干涉 (Overlay Misalignment)** | 引入套刻偏移量 $(\Delta x, \Delta y)$。检测接触通孔在底层平面的垂直投影是否溢出预设电极 Pad 边缘。 | **层间击穿短路 (Short Circuit)**。 |

---

## 6. 数据协议与接口规范 (Data Schema & Interfaces)

### 6.1 工艺卡片数据结构 (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ProcessNodeCard",
  "type": "object",
  "properties": {
    "nodeId": { "type": "string" },
    "nodeType": { 
      "type": "string", 
      "enum": ["SUBSTRATE", "PVD", "ALD", "CVD", "SPIN_COATING", "LITHO_EXPOSE", "WET_ETCH", "DRY_ETCH", "LIFT_OFF", "ANNEAL"] 
    },
    "params": {
      "type": "object",
      "properties": {
        "chemicalReagent": { "type": "string" },
        "temperature_C": { "type": "number" },
        "duration_s": { "type": "number" },
        "stepCoverageRatio": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
        "rates": {
          "type": "object",
          "properties": {
            "verticalRate_nm_s": { "type": "number" },
            "horizontalRate_nm_s": { "type": "number" }
          },
          "required": ["verticalRate_nm_s", "horizontalRate_nm_s"]
        },
        "selectivity": {
          "type": "object",
          "additionalProperties": { "type": "number" }
        }
      }
    }
  },
  "required": ["nodeId", "nodeType", "params"]
}
```

### 6.2 外部 TCAD 适配器抽象规范 (Python/C++ Interface)

```python
from abc import ABC, abstractmethod
from typing import Dict, Any

class TCADExportAdapter(ABC):
    """用于将虚拟制造的几何形貌与边界条件转译给外部 TCAD 求解器"""

    @abstractmethod
    def remesh_surface(self, raw_mesh_stl: str, feature_angle: float) -> str:
        """执行带特征保留的拉普拉斯平滑，消除阶梯噪点，防止网格发散"""
        pass

    @abstractmethod
    def generate_input_deck(self, mesh_file: str, recipe_history: list, output_script_path: str) -> bool:
        """自动生成 Sentaurus (.cmd) 或 Silvaco Atlas (.in) 执行脚本"""
        pass

    @abstractmethod
    def run_headless_simulation(self, script_path: str) -> Dict[str, Any]:
        """无头批处理调用外部 TCAD，并解析 IV 曲线、电极欧姆损耗及光电转化效率"""
        pass
```

---

## 7. 研发实施路线图 (Milestones)

* **阶段 1：几何算子与双视窗原型 (Month 1 - 2)**
  * 构建基于 OpenVDB / 稀疏体素场的底层核心；
  * 实现 3D 全局视窗与 2.5D 切片尺规联动；
  * 跑通“衬底 $\to$ 胶曝光 $\to$ 湿法刻蚀（圆弧掏空） $\to$ PVD（侧壁断阶）”验证链。
* **阶段 2：节点画布交互与工艺知识库 (Month 3 - 4)**
  * 实现拖拽式 Node Canvas，支持单步时间轴与 A/B 分支比对；
  * 搭建常用工艺材料出厂库与联网检索 Agent（阿伦尼乌斯拟合）。
* **阶段 3：实时 DRC 诊断与外部 TCAD 管道 (Month 5 - 6)**
  * 上线断阶、掏空、意外腐蚀等四大 DRC 实时检查器与反向高亮；
  * 完善表面网格修整，提供导出 Sentaurus/Silvaco 脚本接口。