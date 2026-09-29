# 文献基准运行结果

由 `npm run validate:literature` 生成。判定标准及工艺简化见 [验证方法](literature-calibration.md)。本文件记录模型输出，不代表实验已全面复现。

## 工艺与结构

| 基准 | 工艺中断位置 | 检测到的结构 | 模型诊断 |
| --- | --- | --- | --- |
| radisavljevic2011 | 无 | MS, MIS, FET, DUAL_GATE | RESIST_CALIBRATION, ANNEAL_NOT_CALIBRATED, TOP_SURFACE_APPROX |
| lee2014 | 无 | MS, PN, HETERO, MIS | RESIST_CALIBRATION |
| chiu2015 | 无 | HETERO | 无 |

厚度、开口面积、端子隔离及负对照由 `tests/literature.test.mjs` 检查；报告命令本身不替代运行测试。

## 带隙类型保护与原始估算残差

方向为 MoS2 → WSe2，带阶定义为后者带边减前者带边。误差区间取 Chiu 2015 的原文报告值，不解释为特定统计置信区间。当前默认 MoS2/WSe2 的带隙为光学示例值，软件已阻止其进入电子带阶及理想接触势垒运算。旧项目未分类的带隙同样不进入定量计算。下表保留修复前混用光学带隙的估算结果，不能作为当前模型预测。

| 量 | 默认计算 / eV | 文献 / eV | 原文误差 / eV | 残差 / eV | 结果 |
| --- | --- | --- | --- | --- | --- |
| deltaEc | 0.300 | 0.760 | ±0.120 | -0.460 | 未通过 |
| deltaEv | 0.500 | 0.830 | ±0.070 | -0.330 | 未通过 |

2 项原始估算比较未通过；残差仍保留。当前默认不输出定量带阶（光学带隙不能直接作为电子带隙，未计算定量带阶。）。`--strict` 继续返回失败，表示无条件默认库尚未得到独立实验标定；不能通过植入参考答案把它改成全通过。

## 有条件界面档案应用

| 量 | 档案输出 / eV | 文献 / eV | 残差 / eV |
| --- | --- | --- | --- |
| deltaEc | 0.760 | 0.760 | 0.000 |
| deltaEv | 0.830 | 0.830 | 0.000 |

本项检查文献数据应用、方向符号和相对参考，不是独立预测或实验复现。VBO 是 XPS/STS 校正值，CBO 用 VBO 和准粒子带隙推导；相关误差不当作独立观测。用户必须选择档案并确认样品/测量条件，实际膜厚需在单层范围 0.5–0.9 nm。界面图用第一种材料价带顶为零，绝对亲和能保持缺失。Chiu 项目显式选择本档案，未知载流子类型仍不自动变成 PN。

## STS 相对带边算例

| 量 | STS 相对带边计算 / eV | XPS/STS 参考 / eV | 残差 / eV | 结果 |
| --- | --- | --- | --- | --- |
| deltaEc | 0.720 | 0.760 | -0.040 | 方法一致性检查通过 |
| deltaEv | 0.790 | 0.830 | -0.040 | 方法一致性检查通过 |

这里只核对同一参考下的带阶运算。STS 与 XPS/STS 结果共享数据，且 CBO 用到了带隙；不是独立实验复现。任意公共能量平移不会改变带阶，绝对电子亲和能未获得，也未写入材料库。

## 网格扫描

矩形目标面积 8.8 μm²。所有掩膜/薄膜横移 0.137 μm，以检查非网格对齐误差。解析上界为 `(长 + 宽) × Δx + Δx²`，只适用于本矩形中心采样算例。

| 列数 | Δx / μm | 计算面积 / μm² | 绝对误差 / μm² | 解析上界 / μm² |
| --- | --- | --- | --- | --- |
| 32 | 0.500 | 9.000 | 0.200 | 3.217 |
| 40 | 0.400 | 8.960 | 0.160 | 2.533 |
| 64 | 0.250 | 9.000 | 0.200 | 1.546 |
| 80 | 0.200 | 8.400 | 0.400 | 1.227 |

误差界随采样间距缩小，实际误差不要求单调。本扫描不能证明已达到任意指定精度；最大 80 列仍需核对目标特征与窗口尺寸。

## 尚不能复现的量

- 原子层异质结的接触后自洽能带、偏压或栅压引起的载流子分布（新增 1D 平衡求解仅适用 300 K 体硅 PN/PIN）
- FET 转移/输出曲线，ALD 或退火引起的迁移率变化
- 层间复合、光电流与 EQE
- 双层胶下切轮廓、曝光剂量响应、ALD 侧壁覆盖与生长动力学

## 来源

- Radisavljevic et al.: *Single-layer MoS2 transistors*. Nature Nanotechnology 6, 147-150 (2011). [DOI](https://doi.org/10.1038/nnano.2010.279)；[核对的全文](https://infoscience.epfl.ch/server/api/core/bitstreams/90209eb7-1613-4ac8-8816-92372214c904/content)。定位：Main text pp. 147-149, Figs. 2-3; SI Device fabrication, ALD growth, Local gates.
- Lee et al.: *Atomically thin p-n junctions with van der Waals heterointerfaces*. Nature Nanotechnology 9, 676-681 (2014). [DOI](https://doi.org/10.1038/nnano.2014.150)；[核对的全文](https://arxiv.org/pdf/1403.3062)。定位：Author manuscript Methods Summary; SI S1 (pp. 17-18), S2 (p. 19).
- Chiu et al.: *Determination of band alignment in the single-layer MoS2/WSe2 heterojunction*. Nature Communications 6, 7666 (2015). [DOI](https://doi.org/10.1038/ncomms8666)；[核对的全文](https://hub.hku.hk/bitstream/10722/297973/1/content.pdf)。定位：Published article Results pp. 3-4, Eq. (2), Fig. 3 and Methods pp. 5-6.
