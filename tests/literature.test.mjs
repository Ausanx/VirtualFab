import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validateProject } from '../src/engine.js';
import { analyze, bandAlignment } from '../src/physics.js';
import { step } from '../src/recipes.js';
import { createLiteratureProject, evaluateLiterature, footprint, overlapArea, stsReferenceAlignment, bandChecks, references } from '../benchmarks/literature.mjs';

const codes = p => analyze(simulate(p), p.materials).structures.map(s => s.code);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by more than ${tolerance}`);
const thickness = (state, id, expected) => {
  const layers = state.cells.flat().filter(l => l.stepId === id);
  assert.ok(layers.length, `${id} is absent`);
  layers.forEach(l => close(l.z1 - l.z0, expected));
};

test('literature projects are deterministic v1 documents with explicit assumptions', () => {
  for (const key of Object.keys(references)) {
    const p = createLiteratureProject(key);
    validateProject(p);
    assert.deepEqual(p, createLiteratureProject(key));
    assert.deepEqual(simulate(p), simulate(JSON.parse(JSON.stringify(p))));
    assert.equal(simulate(p).stoppedAt, null);
    assert.ok(p.benchmark.reference.assumptions.length);
  }
});

test('2011 MoS2 FET matches reported layer thicknesses and dual-gate topology', () => {
  for (const resolution of [32, 64]) {
    const p = createLiteratureProject('radisavljevic2011');
    p.resolution = resolution;
    const state = simulate(p), result = analyze(state, p.materials);
    thickness(state, 'wafer-oxide', 270);
    thickness(state, 'channel', .65);
    thickness(state, 'sd-0', 50);
    thickness(state, 'dielectric', 30);
    const gate = footprint(state, l => l.stepId === 'tg-0');
    close(gate.areaUm2, .5 * 4);
    close(gate.volumeUm3, .5 * 4 * 5 / 1000);
    const contacts = footprint(state, l => l.stepId === 'sd-0');
    close(contacts.areaUm2, 2 * 1 * 4);
    close(contacts.volumeUm3, 2 * 1 * 4 * 50 / 1000);
    assert.ok(result.structures.some(s => s.code === 'FET' && s.title.startsWith('顶')));
    assert.ok(result.structures.some(s => s.code === 'FET' && s.title.startsWith('底')));
    assert.ok(result.structures.some(s => s.code === 'DUAL_GATE'));
    assert.ok(!result.structures.some(s => s.code === 'SHORT'));
    assert.ok(!state.cells.flat().some(l => l.role === 'resist'));
  }
});

test('subgrid 500 nm gate cannot silently validate the 2011 device', () => {
  const p = createLiteratureProject('radisavljevic2011');
  p.resolution = 16;
  const state = simulate(p);
  assert.ok(state.diagnostics.some(d => d.stepId === 'tg-expose' && d.code === 'SUBGRID'));
  assert.equal(footprint(state, l => l.stepId === 'tg-0').areaUm2, 0);
  assert.ok(!analyze(state, p.materials).structures.some(s => s.code === 'DUAL_GATE'));
});

test('omitting EBL or bridging source and drain invalidates the literature FET', () => {
  const noExposure = createLiteratureProject('radisavljevic2011');
  noExposure.steps.find(s => s.id === 'sd-expose').enabled = false;
  assert.equal(simulate(noExposure).stoppedAt, noExposure.steps.findIndex(s => s.id === 'sd-develop'));
  const bridge = createLiteratureProject('radisavljevic2011');
  Object.assign(bridge.steps.find(s => s.id === 'sd-expose').params, { pattern: 'rect', widthUm: 3.5 });
  assert.ok(!codes(bridge).includes('FET'));
  assert.ok(codes(bridge).includes('SHORT'));
});

test('2014 heterojunction preserves the reported multilayer electrode stacks', () => {
  const p = createLiteratureProject('lee2014'), state = simulate(p), result = analyze(state, p.materials);
  thickness(state, 'wafer-oxide', 280);
  for (const [id, nm] of [['p-contact-0', 20], ['p-contact-1', 30], ['n-contact-0', 40], ['n-contact-1', 1], ['n-contact-2', 50]]) thickness(state, id, nm);
  close(overlapArea(state, 'p-flake', 'n-flake'), 9);
  const pOnly = state.cells.find(c => c.some(l => l.stepId === 'p-contact-0'));
  const nOnly = state.cells.find(c => c.some(l => l.stepId === 'n-contact-0'));
  assert.deepEqual(pOnly.slice(-3).map(l => l.material), ['WSe2', 'Pd', 'Au']);
  assert.deepEqual(nOnly.slice(-4).map(l => l.material), ['MoS2', 'Al', 'Cr', 'Au']);
  assert.ok(result.structures.some(s => s.code === 'PN'));
  assert.ok(result.structures.some(s => s.code === 'HETERO'));
  assert.ok(!result.structures.some(s => s.code === 'SHORT'));
});

test('nonaligned junction area stays within a shrinking analytic raster error bound', () => {
  const grid = evaluateLiterature().grid;
  grid.forEach(row => assert.ok(row.withinRasterBound, JSON.stringify(row)));
  assert.ok(grid.at(-1).rasterBoundUm2 < grid[0].rasterBoundUm2);
});

test('separation, unknown polarity and a dielectric spacer reject direct PN claims', () => {
  const separated = createLiteratureProject('lee2014');
  separated.steps.find(s => s.id === 'n-flake').params.offsetXUm = 8;
  assert.ok(!codes(separated).includes('PN'));
  const unknown = createLiteratureProject('lee2014');
  unknown.steps.find(s => s.id === 'n-flake').params.doping = 'unknown';
  assert.ok(!codes(unknown).includes('PN'));
  const spacer = createLiteratureProject('lee2014');
  spacer.steps.splice(2, 0, step('deposit', { material: 'Al2O3', thicknessNm: 2, role: 'none', method: 'ALD' }));
  const classified = codes(spacer);
  assert.ok(classified.includes('SIS'));
  assert.ok(!classified.includes('PN') && !classified.includes('PIN'));
});

test('dielectric etch obeys independent depth/time arithmetic and overlayer blocking', () => {
  const p = createLiteratureProject('radisavljevic2011');
  p.steps = p.steps.slice(0, p.steps.findIndex(s => s.id === 'tg-coat'));
  const etch = step('etch', { material: 'HfO2', rateNmS: .5, durationS: 20, rateEvidence: 'estimated' });
  p.steps.push(etch);
  thickness(simulate(p), 'dielectric', 30 - .5 * 20);
  etch.params.durationS = 60;
  assert.equal(footprint(simulate(p), l => l.stepId === 'dielectric').areaUm2, 0);
  p.steps.splice(-1, 0, step('deposit', { material: 'Al2O3', thicknessNm: 2, role: 'none' }));
  const blocked = simulate(p);
  thickness(blocked, 'dielectric', 30);
  assert.ok(blocked.diagnostics.some(d => d.code === 'NO_TARGET'));
});

test('a developed etch mask opens only the FET source/drain dielectric windows', () => {
  const p = createLiteratureProject('radisavljevic2011');
  p.steps = p.steps.slice(0, p.steps.findIndex(s => s.id === 'tg-coat'));
  p.steps.push(
    step('coat', { material: 'PMMA950A4', thicknessNm: 300 }), step('bake'),
    step('expose', { pattern: 'contacts', widthUm: 4, lengthUm: 3.5, gapUm: 1.5 }), step('develop'),
    step('etch', { material: 'HfO2', rateNmS: .5, durationS: 60, rateEvidence: 'estimated' }), step('strip'),
  );
  const state = simulate(p);
  assert.equal(state.stoppedAt, null);
  close(footprint(state, l => l.stepId === 'dielectric').areaUm2, 8 * 8 - 2 * 1 * 4);
  for (const cell of state.cells) {
    const isContact = cell.some(l => l.stepId === 'sd-0');
    assert.equal(cell.some(l => l.stepId === 'dielectric'), !isContact);
  }
  thickness(state, 'sd-0', 50);
  assert.ok(!state.cells.flat().some(l => l.role === 'resist'));
});

test('default-band challenge reports residuals rather than treating Type-II as calibration', () => {
  const rows = evaluateLiterature().bands.legacy;
  for (const row of rows) {
    close(row.residualEv, row.predictedEv - row.referenceEv);
    assert.equal(row.status, Math.abs(row.residualEv) <= row.intervalEv ? 'within-reported-interval' : 'outside-reported-interval');
  }
  const syntheticWrong = bandChecks({ type: 'II', deltaEc: .30, deltaEv: .50 }, 'negative-control');
  assert.ok(syntheticWrong.every(r => r.status === 'outside-reported-interval'));
  assert.ok(bandChecks({ type: 'unknown' }, 'missing').every(r => r.status === 'unavailable'));
  const p = createLiteratureProject('lee2014'), m = id => p.materials.find(m => m.id === id);
  const selections=[{a:'MoS2',b:'WSe2',profileId:'chiu2015-mos2-wse2',conditionsConfirmed:true}];
  const forward = bandAlignment(m('MoS2'), m('WSe2'),selections,[.65,.7]), reverse = bandAlignment(m('WSe2'), m('MoS2'),selections,[.7,.65]);
  close(reverse.deltaEc, -forward.deltaEc);
  close(reverse.deltaEv, -forward.deltaEv);
  assert.equal(reverse.type, forward.type);
});

test('STS relative band reference has correct signed offsets and reference invariance', () => {
  const result = stsReferenceAlignment();
  close(result.deltaEc, 1.03 - .31);
  close(result.deltaEv, -1.05 - (-1.84));
  assert.equal(result.type, 'II');
  const shifted = stsReferenceAlignment(8);
  close(shifted.deltaEc, result.deltaEc);
  close(shifted.deltaEv, result.deltaEv);
  assert.ok(bandChecks(result, 'consistency').every(r => r.status === 'within-reported-interval'));
  assert.equal(evaluateLiterature().bands.independentReplication, false);
});

test('measured STS gaps do not supply missing vacuum affinities or fabricated PN polarity', () => {
  const p = createLiteratureProject('chiu2015'), state = simulate(p);
  const m = id => p.materials.find(m => m.id === id);
  assert.equal(m('MoS2').bandGap.evidence, 'measured');
  assert.equal(m('MoS2').bandGap.value, 2.15);
  assert.equal(m('WSe2').bandGap.value, 2.08);
  assert.equal(m('MoS2').affinity.value, null);
  assert.equal(bandAlignment(m('MoS2'), m('WSe2')).type, 'unknown');
  const result = analyze(state, p.materials,p.interfaceSelections);
  assert.ok(result.structures.some(s => s.code === 'HETERO'));
  assert.ok(!result.structures.some(s => s.code === 'PN'));
  assert.ok(result.interfaces.some(i=>i.type==='II'&&i.reference==='relative-interface'));
  assert.equal(analyze(state,p.materials).interfaces[0].type,'unknown');
});
