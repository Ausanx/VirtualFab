import { materials } from '../src/materials.js';
import { step } from '../src/recipes.js';
import { simulate } from '../src/engine.js';
import { analyze, bandAlignment,alignmentFromEdges } from '../src/physics.js';

export const references = {
  radisavljevic2011: {
    title: 'Single-layer MoS2 transistors', authors: 'Radisavljevic et al.',
    journal: 'Nature Nanotechnology 6, 147-150 (2011)', doi: '10.1038/nnano.2010.279',
    fullText: 'https://infoscience.epfl.ch/server/api/core/bitstreams/90209eb7-1613-4ac8-8816-92372214c904/content',
    supplement: 'https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fnnano.2010.279/MediaObjects/41565_2011_BFnnano2010279_MOESM302_ESM.pdf',
    locator: 'Main text pp. 147-149, Figs. 2-3; SI Device fabrication, ALD growth, Local gates.',
    dimensions: { oxideNm: 270, channelNm: .65, contactNm: 50, dielectricNm: 30, gateLengthUm: .5, widthUm: 4, channelLengthUm: 1.5 },
    assumptions: [
      'One of the two series-connected transistors is represented by a rectangular flake and contacts.',
      'MMA/MAA + 2% PMMA bilayer EBL is represented by one 300 nm PMMA950A4 mask. Grade/thickness and undercut are NOT reproduced.',
      'Cr/Au gate identity is reported; gate thickness is not specified in the consulted sections. Cr 5 nm / Au 50 nm are geometry assumptions.',
      'Wafer thickness and substrate doping polarity are assumptions; the paper reports degenerately doped Si, not a numerical doping profile.',
      'Evaporation is represented as electron-beam evaporation; the consulted paper does not specify the metal heating source.',
    ],
  },
  lee2014: {
    title: 'Atomically thin p-n junctions with van der Waals heterointerfaces', authors: 'Lee et al.',
    journal: 'Nature Nanotechnology 9, 676-681 (2014)', doi: '10.1038/nnano.2014.150',
    fullText: 'https://arxiv.org/pdf/1403.3062',
    locator: 'Author manuscript Methods Summary; SI S1 (pp. 17-18), S2 (p. 19).',
    dimensions: { oxideNm: 280, pContactNm: [20, 30], nContactNm: [40, 1, 50], junctionLengthUm: 3, junctionAreaUm2: 8.8, terminalGapUm: 9 },
    assumptions: [
      'Laterally contacted device only; graphene-sandwiched device, polymer stamps and edge contacts are not reproduced.',
      'Rectangles use the SI S2 model dimensions: overlap length 3 um, width 8.8/3 um, terminal gap 9 um. Experimental flake outlines are not digitized.',
      'Monolayer thicknesses MoS2 0.65 nm / WSe2 0.70 nm, 300 nm PMMA950A4 and its bake/development settings are geometry assumptions.',
      'SI S1 experimental electrode stacks are used; SI S2 numerical electrode thickness 200 nm is not substituted for these measured fabrication inputs.',
      'The approximately 0.7 nm vdW separation in SI S2 is collapsed to geometric contact, not a resolved tunnelling barrier.',
      'n/p are selected for the reported operating condition, not inferred from material names or a gate-voltage calculation.',
    ],
  },
  chiu2015: {
    title: 'Determination of band alignment in the single-layer MoS2/WSe2 heterojunction', authors: 'Chiu et al.',
    journal: 'Nature Communications 6, 7666 (2015)', doi: '10.1038/ncomms8666',
    fullText: 'https://hub.hku.hk/bitstream/10722/297973/1/content.pdf',
    authorManuscript: 'https://arxiv.org/pdf/1406.5137',
    locator: 'Published article Results pp. 3-4, Eq. (2), Fig. 3 and Methods pp. 5-6.',
    measurements: {
      type: 'II', deltaEc: .76, deltaEcError: .12, deltaEv: .83, deltaEvError: .07,
      mos2Gap: 2.15, wse2Gap: 2.08, gapError: .10,
      mos2Ec: .31, mos2Ev: -1.84, wse2Ec: 1.03, wse2Ev: -1.05,
    },
    assumptions: [
      'STS band edges reference HOPG Fermi energy, not vacuum. No absolute electron affinity is extracted or stored as measured.',
      'The published CBO is inferred from VBO and STS gaps; it is not an independent second measurement.',
      'XPS/STS and STS-only estimates share data; agreement is a cross-method consistency check, not independent replication.',
      'Reported error bars are comparison intervals; their statistical confidence and covariance are not assumed.',
      'The project is a simplified transferred stack on Si with approximately 2 nm native oxide, not a reconstruction of STM or XPS instrumentation.',
    ],
  },
};

const missing = () => ({ value: null, unit: 'eV', evidence: 'missing', source: '', note: 'No applicable measured value supplied.' });

function project(key, sizeUm) {
  const p = { version: 1, name: key, template: 'blank', sizeUm, resolution: 64, materials: structuredClone(materials), steps: [], benchmark: { key, reference: references[key] } };
  p.materials.push({ id: 'Cr', name: 'Cr', category: 'conductor', color: '#8496A6', polarity: 'unknown', bandGap: missing(), affinity: missing(), workFunction: missing(), reference: '', note: 'Electrode identity only; no assumed work function.' });
  return p;
}

function add(p, id, type, params = {}, name) {
  const s = step(type, params, name);
  s.id = id;
  p.steps.push(s);
}

function electrode(p, id, mask, layers, role = 'electrode', developS = 60) {
  const label = { sd: '源漏电极', tg: '顶栅', 'p-contact': 'WSe2 电极', 'n-contact': 'MoS2 电极' }[id];
  add(p, `${id}-coat`, 'coat', { material: 'PMMA950A4', thicknessNm: 300 }, `${label} · 等效单层胶`);
  add(p, `${id}-bake`, 'bake', { temperatureC: 180, durationS: 300 }, `${label} · 软烘`);
  add(p, `${id}-expose`, 'expose', mask, `${label} · EBL 曝光`);
  add(p, `${id}-develop`, 'develop', { durationS: developS }, `${label} · 显影`);
  layers.forEach(([material, thicknessNm], i) => add(p, `${id}-${i}`, 'deposit', { material, thicknessNm, role, method: '电子束蒸镀' }, `${label} · ${material} 蒸镀`));
  add(p, `${id}-liftoff`, 'liftoff', {}, `${label} · 剥离`);
}

export function createLiteratureProject(key) {
  const p = project(key, key === 'radisavljevic2011' ? 8 : 16);
  if (key === 'radisavljevic2011') {
    p.name = '文献基准 / MoS2 双栅晶体管';
    add(p, 'wafer', 'substrate', { oxideNm: 270, backgate: true });
    add(p, 'channel', 'transfer', { material: 'MoS2', thicknessNm: .65, widthUm: 3.5, lengthUm: 4 });
    electrode(p, 'sd', { pattern: 'contacts', widthUm: 4, lengthUm: 3.5, gapUm: 1.5 }, [['Au', 50]], 'contacts', 180);
    add(p, 'contact-anneal', 'anneal', { temperatureC: 200, durationS: 7200, atmosphere: 'Ar 100 sccm / H2 10 sccm' });
    add(p, 'dielectric', 'deposit', { material: 'HfO2', thicknessNm: 30, role: 'none', method: 'ALD', temperatureC: 200 });
    electrode(p, 'tg', { pattern: 'rect', widthUm: .5, lengthUm: 4 }, [['Cr', 5], ['Au', 50]], 'gate', 180);
  } else if (key === 'lee2014') {
    p.name = '文献基准 / MoS2-WSe2 异质结';
    add(p, 'wafer', 'substrate', { oxideNm: 280, backgate: true });
    add(p, 'p-flake', 'transfer', { material: 'WSe2', doping: 'p', role: 'active', thicknessNm: .7, widthUm: 7.5, lengthUm: 8.8 / 3, offsetXUm: -2.25 });
    add(p, 'n-flake', 'transfer', { material: 'MoS2', doping: 'n', role: 'active', thicknessNm: .65, widthUm: 7.5, lengthUm: 8.8 / 3, offsetXUm: 2.25 });
    electrode(p, 'p-contact', { pattern: 'rect', widthUm: 1.5, lengthUm: 8.8 / 3, offsetXUm: -5.25 }, [['Pd', 20], ['Au', 30]], 'source');
    electrode(p, 'n-contact', { pattern: 'rect', widthUm: 1.5, lengthUm: 8.8 / 3, offsetXUm: 5.25 }, [['Al', 40], ['Cr', 1], ['Au', 50]], 'drain');
  } else if (key === 'chiu2015') {
    p.name = '文献基准 / 实测带隙与未知亲和能';
    add(p, 'wafer', 'substrate', { oxideNm: 2, doping: 'unknown' });
    add(p, 'p-flake', 'transfer', { material: 'WSe2', doping: 'unknown', role: 'active', thicknessNm: .7, widthUm: 8, lengthUm: 6, offsetXUm: -1 });
    add(p, 'n-flake', 'transfer', { material: 'MoS2', doping: 'unknown', role: 'active', thicknessNm: .65, widthUm: 8, lengthUm: 6, offsetXUm: 1 });
    const measured = references.chiu2015.measurements;
    for (const [id, value] of [['MoS2', measured.mos2Gap], ['WSe2', measured.wse2Gap]]) {
      const m = p.materials.find(m => m.id === id);
      m.bandGap = { value, unit: 'eV', kind:'quasiparticle', evidence: 'measured', source: 'https://doi.org/10.1038/ncomms8666', note: 'Monolayer on HOPG; STS at 77 K, quasiparticle gap, reported error +/-0.10 eV. Not an optical gap.' };
      m.affinity = missing();
      m.polarity = 'unknown';
    }
    p.interfaceSelections=[{a:'MoS2',b:'WSe2',profileId:'chiu2015-mos2-wse2',conditionsConfirmed:true}];
  } else throw Error(`Unknown literature case: ${key}`);
  return p;
}

export function footprint(state, predicate) {
  const dx = state.sizeUm / state.resolution;
  let count = 0, volumeUm3 = 0;
  for (const cell of state.cells) {
    const layers = cell.filter(predicate);
    if (layers.length) count++;
    volumeUm3 += layers.reduce((sum, l) => sum + l.z1 - l.z0, 0) * dx * dx / 1000;
  }
  return { count, areaUm2: count * dx * dx, volumeUm3 };
}

export function overlapArea(state, a, b) {
  return state.cells.filter(c => c.some(l => l.stepId === a) && c.some(l => l.stepId === b)).length * (state.sizeUm / state.resolution) ** 2;
}

export function bandChecks(prediction, kind) {
  const m = references.chiu2015.measurements;
  return [['deltaEc', m.deltaEc, m.deltaEcError], ['deltaEv', m.deltaEv, m.deltaEvError]].map(([quantity, referenceEv, intervalEv]) => {
    const predictedEv = prediction[quantity] ?? null;
    const residualEv = predictedEv === null ? null : predictedEv - referenceEv;
    return { kind, quantity, predictedEv, referenceEv, intervalEv, residualEv, status: residualEv === null ? 'unavailable' : Math.abs(residualEv) <= intervalEv ? 'within-reported-interval' : 'outside-reported-interval' };
  });
}

// A common shift of the HOPG reference cancels; no artificial affinities are created.
export function stsReferenceAlignment(referenceEv = 4) {
  const m = references.chiu2015.measurements;
  const relative = (ec, ev) => ({ec:ec-referenceEv,ev:ev-referenceEv});
  return alignmentFromEdges(relative(m.mos2Ec,m.mos2Ev),relative(m.wse2Ec,m.wse2Ev));
}

export function evaluateLiterature() {
  const cases = Object.keys(references).map(key => {
    const p = createLiteratureProject(key), state = simulate(p), result = analyze(state, p.materials,p.interfaceSelections);
    return { key, stoppedAt: state.stoppedAt, codes: [...new Set(result.structures.map(s => s.code))], diagnostics: [...new Set(state.diagnostics.map(d => d.code))] };
  });
  const mos2 = materials.find(m => m.id === 'MoS2'), wse2 = materials.find(m => m.id === 'WSe2');
  const legacy=alignmentFromEdges({ec:-4.2,ev:-6},{ec:-3.9,ev:-5.5});
  const profile=bandAlignment(mos2,wse2,[{a:'MoS2',b:'WSe2',profileId:'chiu2015-mos2-wse2',conditionsConfirmed:true}],[.65,.7]);
  const grid = [32, 40, 64, 80].map(resolution => {
    const p = createLiteratureProject('lee2014');
    p.resolution = resolution;
    // Include a non-grid-aligned translation to expose sampling error.
    for (const s of p.steps) if ('offsetXUm' in s.params) s.params.offsetXUm += .137;
    const state = simulate(p), dx = p.sizeUm / resolution, target = references.lee2014.dimensions.junctionAreaUm2;
    const areaUm2 = overlapArea(state, 'p-flake', 'n-flake');
    const boundUm2 = (3 + 8.8 / 3) * dx + dx * dx;
    return { resolution, dxUm: dx, areaUm2, targetUm2: target, absoluteErrorUm2: Math.abs(areaUm2 - target), rasterBoundUm2: boundUm2, withinRasterBound: Math.abs(areaUm2 - target) <= boundUm2 };
  });
  return {
    schemaVersion: 1, references, cases, grid,
    bands: { direction: 'MoS2 -> WSe2; E_b - E_a', defaultAlignment: bandAlignment(mos2, wse2), default: bandChecks(bandAlignment(mos2, wse2), 'default-library-withheld'), legacy:bandChecks(legacy,'archived-optical-gap-mixed-estimate'), profile:bandChecks(profile,'interface-profile-data-application'), stsConsistency: bandChecks(stsReferenceAlignment(), 'shared-data-method-consistency'), independentReplication: false },
    unsupported: ['原子层异质结的接触后自洽能带、偏压或栅压引起的载流子分布（新增 1D 平衡求解仅适用 300 K 体硅 PN/PIN）', 'FET 转移/输出曲线，ALD 或退火引起的迁移率变化', '层间复合、光电流与 EQE', '双层胶下切轮廓、曝光剂量响应、ALD 侧壁覆盖与生长动力学'],
  };
}
