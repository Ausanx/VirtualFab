# 文献基准运行结果

由 `npm run validate:literature` 生成。判定标准及工艺简化见 [验证方法](literature-calibration.md)。本文件记录模型输出，不代表实验已全面复现。

## 工艺与结构

| 基准 | 工艺中断位置 | 检测到的结构 | 模型诊断 |
| --- | --- | --- | --- |
| radisavljevic2011 | 无 | MS, MIS, FET, DUAL_GATE | RESIST_CALIBRATION, ANNEAL_NOT_CALIBRATED, TOP_SURFACE_APPROX |
| lee2014 | 无 | MS, PN, HETERO, MIS | RESIST_CALIBRATION |
| chiu2015 | 无 | HETERO | 无 |

厚度、开口面积、端子隔离及负对照由 `tests/literature.test.mjs` 检查；报告命令本身不替代运行测试。

## 默认材料库的外部数据检验

方向为 MoS2 → WSe2，带阶定义为后者带边减前者带边。误差区间取 Chiu 2015 的原文报告值，不解释为特定统计置信区间。

| 量 | 默认计算 / eV | 文献 / eV | 原文误差 / eV | 残差 / eV | 结果 |
| --- | --- | --- | --- | --- | --- |
| deltaEc | 0.300 | 0.760 | ±0.120 | -0.460 | 未通过 |
| deltaEv | 0.500 | 0.830 | ±0.070 | -0.330 | 未通过 |

2 项定量比较未通过。默认类型为 Type-II；类型标签一致不能替代带阶数值标定。默认带隙/亲和能仍为估算，也不保证适用于该单层样品。软件按实际叠层顺序显示 WSe2 / MoS2 时带阶符号相反，不是数值错误。

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

- 接触后的自洽能带弯曲、偏压或栅压引起的载流子分布
- FET 转移/输出曲线，ALD 或退火引起的迁移率变化
- 层间复合、光电流与 EQE
- 双层胶下切轮廓、曝光剂量响应、ALD 侧壁覆盖与生长动力学

## 来源

- Radisavljevic et al.: *Single-layer MoS2 transistors*. Nature Nanotechnology 6, 147-150 (2011). [DOI](https://doi.org/10.1038/nnano.2010.279)；[核对的全文](https://infoscience.epfl.ch/server/api/core/bitstreams/90209eb7-1613-4ac8-8816-92372214c904/content)。定位：Main text pp. 147-149, Figs. 2-3; SI Device fabrication, ALD growth, Local gates.
- Lee et al.: *Atomically thin p-n junctions with van der Waals heterointerfaces*. Nature Nanotechnology 9, 676-681 (2014). [DOI](https://doi.org/10.1038/nnano.2014.150)；[核对的全文](https://arxiv.org/pdf/1403.3062)。定位：Author manuscript Methods Summary; SI S1 (pp. 17-18), S2 (p. 19).
- Chiu et al.: *Determination of band alignment in the single-layer MoS2/WSe2 heterojunction*. Nature Communications 6, 7666 (2015). [DOI](https://doi.org/10.1038/ncomms8666)；[核对的全文](https://hub.hku.hk/bitstream/10722/297973/1/content.pdf)。定位：Published article Results pp. 3-4, Eq. (2), Fig. 3 and Methods pp. 5-6.
