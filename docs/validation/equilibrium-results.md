# PN/PIN 平衡求解验证

由 `npm run validate:physics` 生成。DEVSIM 2.11.0 有限体积 Poisson/Boltzmann 解；独立 1D 体硅、300 K、完全电离、零偏压、理想欧姆端部。不是原子层异质结或当前三维工艺的性能预测。

| 算例 | Vbi 数值 / V | Vbi 解析 / V | 峰值场数值 / V cm⁻¹ | 耗尽近似 / V cm⁻¹ | 连续 P–B 一阶积分 / V cm⁻¹ | 网格减半 Δψ / mV | 归一化 Poisson 残差 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pn-symmetric | 0.735210 | 0.735210 | 32127.27 | 33720.46 | 32513.15 | 0.0249 | 3.65e-12 |
| pn-low-doping | 0.616157 | 0.616157 | 9304.70 | 9761.88 | 9343.34 | 0.0023 | 1.07e-11 |
| pn-asymmetric | 0.735210 | 0.735210 | 20651.85 | 15005.41 | 20874.61 | 0.0130 | 5.63e-12 |
| pin | 0.735210 | 0.735210 | 7618.79 | 7032.34 | 不适用 | 0.0319 | 9.93e-13 |
| pn-short-contacts | 0.735210 | 0.735210 | 44004.14 | 33720.46 | 32513.15 | 0.0617 | 4.25e-13 |
| pn-underresolved | 0.735210 | 0.735210 | 15545.84 | 15005.41 | 20874.61 | 8.1176 | 2.37e-15 |

通过检查：平直 EF；带隙恒定；n p = ni²；能带与态密度给出的载流子一致；离散 Poisson 残差小于 10⁻⁶（以 q max(NA,ND) 归一化）；数值与解析 Vbi 差小于 10⁻⁸ V。三个正常 PN 算例峰值场与连续 Poisson–Boltzmann 一阶积分的差小于 3%。PIN 的耗尽近似方法比较阈值为 15%。这些是数学模型比较阈值，不是实验拟合误差。

三个正常 PN 与 PIN 的网格减半 Δψ ≤ 2 mV、峰值场变化 ≤ 2%。短接触与粗网格为负对照，不能计作精度通过；短接触须出现远端中性条件警告，粗网格须出现精度警告。小离散残差本身不能证明网格足够精细。

模型选用 Eg = 1.12 eV、Nc = 2.8×10¹⁹、Nv = 1.04×10¹⁹ cm⁻³、εr = 11.7；ni = sqrt(Nc Nv) exp(−Eg/2kT) = 6.676×10⁹ cm⁻³。它们是该算例的模型参数，不是对用户制备的样品测量。温度暂限于 300 K，不外推参数。

不对称 PN 的耗尽近似忽略接面附近移动电荷，峰值场偏差约 38%，不能强行使用 15% 阈值作精确标定。保留这项差异，并用同一 Poisson/Boltzmann 方程的连续一阶积分独立核对。定义 F(ψ,D) = 2 ni VT cosh(ψ/VT) − Dψ，两侧中性电势 ψp = −VT asinh(NA/2ni)、ψn = VT asinh(ND/2ni)；连续场条件给出 ψj = [F(ψp,−NA) − F(ψn,ND)]/(NA+ND)，峰值场为 sqrt(2q/ε × [F(ψj,−NA) − F(ψp,−NA)])。该无限体比较仅在端部远离空间电荷区时使用。

PIN 的 i 区是本征硅，耗尽近似假定 i 区无移动电荷；数值解保留移动电荷。其解析式为 Vbi = q/(2ε) × S²(1/NA+1/ND) + q/ε × S Li，其中 S = NA xp = ND xn。

源数据与各算例参数：`artifacts/equilibrium/*.json`，节点及电场 CSV 同目录。

来源：[DEVSIM 官方模型](https://github.com/devsim/devsim/blob/main/python_packages/simple_physics.py)、[MIT 6.012 Lecture 5](https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-spring-2009/ac6a8e55da0ad6e1f7dedc37d86b6a75_MIT6_012S09_lec05.pdf)、[TU Wien TCAD 模型参数](https://www.iue.tuwien.ac.at/pdf/ib_2018/BC2018_Sverdlov_1.pdf)、[热平衡载流子关系](https://www.iue.tuwien.ac.at/phd/rzepa/)。这是解析交叉验证和守恒检查，尚不是独立实验标定。
