import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLiteratureProject, evaluateLiterature } from './literature.mjs';

const root = new URL('../', import.meta.url);
const report = evaluateLiterature();
await mkdir(new URL('examples/literature/', root), { recursive: true });
await mkdir(new URL('artifacts/literature/', root), { recursive: true });
await mkdir(new URL('docs/validation/', root), { recursive: true });
for (const key of Object.keys(report.references)) {
  await writeFile(new URL(`examples/literature/${key}.json`, root), JSON.stringify(createLiteratureProject(key), null, 2) + '\n');
}
await writeFile(new URL('artifacts/literature/results.json', root), JSON.stringify(report, null, 2) + '\n');

const rows = [...report.bands.default, ...report.bands.stsConsistency];
const columns = ['kind', 'quantity', 'predictedEv', 'referenceEv', 'intervalEv', 'residualEv', 'status'];
await writeFile(new URL('artifacts/literature/band-offsets.csv', root), [columns.join(','), ...rows.map(row => columns.map(key => row[key]).join(','))].join('\n') + '\n');
const gridColumns = ['resolution', 'dxUm', 'areaUm2', 'targetUm2', 'absoluteErrorUm2', 'rasterBoundUm2', 'withinRasterBound'];
await writeFile(new URL('artifacts/literature/grid-sweep.csv', root), [gridColumns.join(','), ...report.grid.map(row => gridColumns.map(key => row[key]).join(','))].join('\n') + '\n');

const f = n => n === null ? '缺失' : n.toFixed(3);
const scientificFailures = report.bands.default.filter(r => r.status !== 'within-reported-interval');
const markdown = `# 文献基准运行结果

由 \`npm run validate:literature\` 生成。判定标准及工艺简化见 [验证方法](literature-calibration.md)。本文件记录模型输出，不代表实验已全面复现。

## 工艺与结构

| 基准 | 工艺中断位置 | 检测到的结构 | 模型诊断 |
| --- | --- | --- | --- |
${report.cases.map(c => `| ${c.key} | ${c.stoppedAt ?? '无'} | ${c.codes.join(', ')} | ${c.diagnostics.join(', ') || '无'} |`).join('\n')}

厚度、开口面积、端子隔离及负对照由 \`tests/literature.test.mjs\` 检查；报告命令本身不替代运行测试。

## 默认材料库的外部数据检验

方向为 MoS2 → WSe2，带阶定义为后者带边减前者带边。误差区间取 Chiu 2015 的原文报告值，不解释为特定统计置信区间。

| 量 | 默认计算 / eV | 文献 / eV | 原文误差 / eV | 残差 / eV | 结果 |
| --- | --- | --- | --- | --- | --- |
${report.bands.default.map(r => `| ${r.quantity} | ${f(r.predictedEv)} | ${f(r.referenceEv)} | ±${f(r.intervalEv)} | ${f(r.residualEv)} | ${r.status === 'within-reported-interval' ? '位于原文区间内' : '未通过'} |`).join('\n')}

${scientificFailures.length} 项定量比较未通过。默认类型为 Type-${report.bands.defaultAlignment.type}；类型标签一致不能替代带阶数值标定。默认带隙/亲和能仍为估算，也不保证适用于该单层样品。软件按实际叠层顺序显示 WSe2 / MoS2 时带阶符号相反，不是数值错误。

## STS 相对带边算例

| 量 | STS 相对带边计算 / eV | XPS/STS 参考 / eV | 残差 / eV | 结果 |
| --- | --- | --- | --- | --- |
${report.bands.stsConsistency.map(r => `| ${r.quantity} | ${f(r.predictedEv)} | ${f(r.referenceEv)} | ${f(r.residualEv)} | ${r.status === 'within-reported-interval' ? '方法一致性检查通过' : '未通过'} |`).join('\n')}

这里只核对同一参考下的带阶运算。STS 与 XPS/STS 结果共享数据，且 CBO 用到了带隙；不是独立实验复现。任意公共能量平移不会改变带阶，绝对电子亲和能未获得，也未写入材料库。

## 网格扫描

矩形目标面积 8.8 μm²。所有掩膜/薄膜横移 0.137 μm，以检查非网格对齐误差。解析上界为 \`(长 + 宽) × Δx + Δx²\`，只适用于本矩形中心采样算例。

| 列数 | Δx / μm | 计算面积 / μm² | 绝对误差 / μm² | 解析上界 / μm² |
| --- | --- | --- | --- | --- |
${report.grid.map(r => `| ${r.resolution} | ${f(r.dxUm)} | ${f(r.areaUm2)} | ${f(r.absoluteErrorUm2)} | ${f(r.rasterBoundUm2)} |`).join('\n')}

误差界随采样间距缩小，实际误差不要求单调。本扫描不能证明已达到任意指定精度；最大 80 列仍需核对目标特征与窗口尺寸。

## 尚不能复现的量

${report.unsupported.map(s => `- ${s}`).join('\n')}

## 来源

${Object.values(report.references).map(r => `- ${r.authors}: *${r.title}*. ${r.journal}. [DOI](https://doi.org/${r.doi})；[核对的全文](${r.fullText})。定位：${r.locator}`).join('\n')}
`;
await writeFile(new URL('docs/validation/literature-results.md', root), markdown);
console.log(`Generated 3 project files: ${fileURLToPath(new URL('examples/literature/', root))}`);
console.log(`Report: ${fileURLToPath(new URL('docs/validation/literature-results.md', root))}`);
console.log(`Default band challenge: ${scientificFailures.length} outside reported intervals. STS reference check is shared-data consistency only.`);
if (process.argv.includes('--strict') && (scientificFailures.length || report.bands.defaultAlignment.type !== report.references.chiu2015.measurements.type || report.cases.some(c => c.stoppedAt !== null) || report.grid.some(r => !r.withinRasterBound))) process.exitCode = 1;
