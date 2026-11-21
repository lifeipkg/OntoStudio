import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMAIN_PRESETS } from '../data/ontologyPresets';
import {
  generateExampleInstanceTriples,
  generateTurtleSerialization,
  getAncestorIds,
  getInheritedDataProperties,
  runOntologyReasoner,
  simulateConstructionMetrics,
  simulateQueryPlan,
} from './ontologyEngine';
import {
  buildForceEdges,
  seedForceNodes,
  splitSphereLabel,
  stepForceSimulation,
} from './forceGraph';
import {
  mergeOntologyModels,
  parseTurtleBatchToOntology,
  parseTurtleToOntology,
} from './turtleParser';
import {
  BEGINNER_TEMPLATES,
  buildPresetFromDraft,
  layoutBuilderClasses,
  sanitizeSlugIdentifier,
  validateBuilderStep,
} from './ontologyBuilder';
import type { DomainOntologyPreset } from '../types/ontology';

test('parseTurtleToOntology round-trips exported school Turtle and parses custom OWL/SHACL files', () => {
  const exported = generateTurtleSerialization(DOMAIN_PRESETS.school);
  const roundTrip = parseTurtleToOntology(exported, { fileName: 'school.ttl' });
  assert.equal(roundTrip.ok, true);
  if (!roundTrip.ok) return;

  assert.equal(roundTrip.ontology.prefix, 'edu');
  assert.equal(roundTrip.ontology.namespace, 'https://onto.edukg.org/school#');
  assert.equal(roundTrip.ontology.classes.length, DOMAIN_PRESETS.school.classes.length);
  assert.equal(roundTrip.ontology.objectProperties.length, DOMAIN_PRESETS.school.objectProperties.length);
  assert.equal(roundTrip.ontology.shaclRules.length, DOMAIN_PRESETS.school.shaclRules.length);

  const broom = roundTrip.ontology.classes.find((c) => c.name === 'Broom');
  assert.ok(broom);
  assert.equal(broom.label, '班级扫帚');

  // External custom .ttl with DatatypeProperty, ObjectProperty, Transitive, SHACL, and comments
  const customTtl = `
# Sample Campus Lab Equipment Ontology
@prefix lab: <https://onto.campus.org/lab#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

<https://onto.campus.org/lab> a owl:Ontology ;
    rdfs:label "实验室设备与危化品本体"@zh .

lab:Device a owl:Class ;
    rdfs:label "实验设备"@zh .

lab:Microscope a owl:Class ;
    rdfs:label "光学显微镜"@zh ;
    rdfs:subClassOf lab:Device .

lab:Laboratory a owl:Class ;
    rdfs:label "物理实验室"@zh ;
    owl:disjointWith lab:Device .

lab:serialCode a owl:DatatypeProperty ;
    rdfs:label "设备序列号"@zh ;
    rdfs:domain lab:Device ;
    rdfs:range xsd:string .

lab:locatedInLab a owl:ObjectProperty, owl:FunctionalProperty ;
    rdfs:label "存放于实验室"@zh ;
    rdfs:domain lab:Device ;
    rdfs:range lab:Laboratory .

lab:DeviceShape a sh:NodeShape ;
    sh:targetClass lab:Device ;
    sh:property [
        sh:path lab:serialCode ;
        sh:minCount 1 ;
        sh:pattern "^DEV-[0-9]{4}$" ;
        sh:severity sh:Violation
    ] .
`;
  const parsed = parseTurtleToOntology(customTtl, { fileName: 'lab.ttl' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.ontology.source, 'imported');
  assert.equal(parsed.ontology.prefix, 'lab');
  assert.equal(parsed.ontology.name, '实验室设备与危化品本体');
  assert.equal(parsed.ontology.classes.length, 3);
  assert.equal(parsed.ontology.objectProperties.length, 1);
  assert.equal(parsed.ontology.shaclRules.length, 2);

  const deviceCls = parsed.ontology.classes.find((c) => c.name === 'Device');
  assert.ok(deviceCls);
  assert.equal(deviceCls.dataProperties.length, 1);
  assert.equal(deviceCls.dataProperties[0].name, 'serialCode');
  assert.equal(deviceCls.dataProperties[0].required, true);

  const reasoner = runOntologyReasoner(parsed.ontology);
  assert.equal(reasoner.consistent, true);

  // Reject empty or class-less Turtle cleanly
  const emptyRes = parseTurtleToOntology('   ');
  assert.equal(emptyRes.ok, false);
  const noClassRes = parseTurtleToOntology('@prefix ex: <http://example.org/> . ex:a ex:b ex:c .');
  assert.equal(noClassRes.ok, false);
});

test('parseTurtleBatchToOntology combines split files with per-file prefixes and deduplicates triples', () => {
  const part1 = `
@prefix lab: <https://onto.campus.org/lab#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://onto.campus.org/lab> a owl:Ontology ;
    rdfs:label "实验室分段本体"@zh .

lab:Equipment a owl:Class ;
    rdfs:label "实验器材"@zh .

lab:assetTag a owl:DatatypeProperty ;
    rdfs:label "资产标签"@zh ;
    rdfs:domain lab:Equipment ;
    rdfs:range xsd:string .
`;

  // File 2 uses default ':' prefix for same namespace and duplicates Equipment + assetTag while adding Centrifuge & Room
  const part2 = `
@prefix : <https://onto.campus.org/lab#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:Equipment a owl:Class ;
    rdfs:label "实验器材"@zh .

:Centrifuge a owl:Class ;
    rdfs:label "高速离心机"@zh ;
    rdfs:subClassOf :Equipment .

:LabRoom a owl:Class ;
    rdfs:label "实验房间"@zh .

:storedIn a owl:ObjectProperty ;
    rdfs:label "存放于"@zh ;
    rdfs:domain :Equipment ;
    rdfs:range :LabRoom .
`;

  // File 3 contains ONLY SHACL NodeShape (no owl:Class declarations)
  const part3 = `
@prefix lab: <https://onto.campus.org/lab#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

lab:EquipmentShape a sh:NodeShape ;
    sh:targetClass lab:Equipment ;
    sh:property [
        sh:path lab:assetTag ;
        sh:minCount 1 ;
        sh:severity sh:Violation
    ] .
`;

  const batch = parseTurtleBatchToOntology([
    { fileName: 'part1.ttl', content: part1 },
    { fileName: 'part2.ttl', content: part2 },
    { fileName: 'part3-shacl.ttl', content: part3 },
  ]);

  assert.equal(batch.ok, true);
  if (!batch.ok) return;

  assert.equal(batch.fileCount, 3);
  assert.ok(batch.dedupedTriples >= 2);
  assert.equal(batch.ontology.fileName, 'part1.ttl + part2.ttl + part3-shacl.ttl');
  assert.equal(batch.ontology.classes.length, 3);
  assert.equal(batch.ontology.objectProperties.length, 1);
  assert.equal(batch.ontology.shaclRules.length, 1);

  const centrifuge = batch.ontology.classes.find((c) => c.name === 'Centrifuge');
  const equipment = batch.ontology.classes.find((c) => c.name === 'Equipment');
  assert.ok(centrifuge && equipment);
  assert.equal(centrifuge.parentId, equipment.id);
  assert.equal(equipment.dataProperties[0].required, true);
});

test('mergeOntologyModels deduplicates classes, dataProperties, objectProperties, and SHACL rules on continue-import', () => {
  const initialRes = parseTurtleToOntology(
    `
@prefix lab: <https://onto.campus.org/lab#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

lab:Device a owl:Class ; rdfs:label "实验设备"@zh .
lab:LabRoom a owl:Class ; rdfs:label "实验室"@zh .
lab:serialCode a owl:DatatypeProperty ; rdfs:label "设备编号"@zh ; rdfs:domain lab:Device ; rdfs:range xsd:string .
lab:locatedIn a owl:ObjectProperty ; rdfs:label "位于"@zh ; rdfs:domain lab:Device ; rdfs:range lab:LabRoom .
lab:DeviceShape a sh:NodeShape ;
    sh:targetClass lab:Device ;
    sh:property [ sh:path lab:serialCode ; sh:minCount 1 ; sh:severity sh:Violation ] .
`,
    { fileName: 'base.ttl' },
  );
  assert.equal(initialRes.ok, true);
  if (!initialRes.ok) return;

  // Follow-up partial file repeats Device, LabRoom, serialCode, locatedIn, DeviceShape AND adds Microscope, powerWatt, usesRoom, maxCount
  const followUpRes = parseTurtleToOntology(
    `
@prefix lab: <https://onto.campus.org/lab#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .

lab:Device a owl:Class ; rdfs:label "实验设备"@zh .
lab:LabRoom a owl:Class ; rdfs:label "实验室"@zh .
lab:Microscope a owl:Class ; rdfs:label "电子显微镜"@zh ; rdfs:subClassOf lab:Device .
lab:serialCode a owl:DatatypeProperty ; rdfs:domain lab:Device ; rdfs:range xsd:string .
lab:powerWatt a owl:DatatypeProperty ; rdfs:label "功率"@zh ; rdfs:domain lab:Microscope ; rdfs:range xsd:integer .
lab:locatedIn a owl:ObjectProperty ; rdfs:label "位于"@zh ; rdfs:domain lab:Device ; rdfs:range lab:LabRoom .
lab:managedBy a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:label "保管室"@zh ; rdfs:domain lab:Microscope ; rdfs:range lab:LabRoom .
lab:DeviceShape a sh:NodeShape ;
    sh:targetClass lab:Device ;
    sh:property [ sh:path lab:serialCode ; sh:minCount 1 ; sh:severity sh:Violation ] ;
    sh:property [ sh:path lab:serialCode ; sh:maxCount 1 ; sh:severity sh:Warning ] .
`,
    { fileName: 'extra.ttl' },
  );
  assert.equal(followUpRes.ok, true);
  if (!followUpRes.ok) return;

  const { merged, stats } = mergeOntologyModels(initialRes.ontology, followUpRes.ontology);

  assert.equal(stats.addedClasses, 1);
  assert.equal(stats.skippedDuplicateClasses, 2);
  assert.equal(stats.addedDataProps, 1);
  assert.equal(stats.skippedDuplicateDataProps, 1);
  assert.equal(stats.addedObjectProps, 1);
  assert.equal(stats.skippedDuplicateObjectProps, 1);
  assert.equal(stats.addedShacl, 1);
  assert.equal(stats.skippedDuplicateShacl, 1);

  assert.equal(merged.classes.length, 3);
  assert.equal(merged.objectProperties.length, 2);
  assert.equal(merged.shaclRules.length, 2);
  assert.equal(merged.fileName, 'base.ttl + extra.ttl');

  const device = merged.classes.find((c) => c.name === 'Device')!;
  const microscope = merged.classes.find((c) => c.name === 'Microscope')!;
  assert.equal(microscope.parentId, device.id);

  const report = runOntologyReasoner(merged);
  assert.equal(report.consistent, true);
});

test('parseTurtleToOntology parses pure ABox instance Turtle and merges cleanly into existing TBox', () => {
  const aboxTtl = `
@prefix edu: <https://onto.edukg.org/school#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

edu:Class_101 a owl:NamedIndividual, edu:Classroom ;
    edu:className "高一(1)班" ;
    edu:studentCount 45 ;
    edu:isActive true .

edu:Broom_101_01 a edu:Broom ;
    edu:assetCode "BRM-101-01" ;
    edu:broomOwnedByClass edu:Class_101 .

edu:Broom_101_02 a edu:Broom ;
    edu:assetCode "BRM-101-02" ;
    edu:broomOwnedByClass edu:Class_101 .
`;

  const parsedAbox = parseTurtleToOntology(aboxTtl, { fileName: 'school-abox.ttl' });
  assert.equal(parsedAbox.ok, true);
  if (!parsedAbox.ok) return;

  assert.equal(parsedAbox.aboxInstanceCount, 3);
  assert.equal(parsedAbox.ontology.classes.length, 2);
  assert.equal(parsedAbox.ontology.objectProperties.length, 1);

  const broomCls = parsedAbox.ontology.classes.find((c) => c.name === 'Broom');
  const classroomCls = parsedAbox.ontology.classes.find((c) => c.name === 'Classroom');
  assert.ok(broomCls && classroomCls);
  assert.equal(broomCls.estimatedInstances, 2);
  assert.equal(classroomCls.estimatedInstances, 1);
  assert.equal(classroomCls.dataProperties.find((d) => d.name === 'studentCount')?.datatype, 'xsd:integer');
  assert.equal(classroomCls.dataProperties.find((d) => d.name === 'isActive')?.datatype, 'xsd:boolean');

  // Merging ABox into existing school TBox deduplicates Classroom, Broom, assetCode, broomOwnedByClass
  const { merged, stats } = mergeOntologyModels(DOMAIN_PRESETS.school, parsedAbox.ontology);
  assert.equal(stats.addedClasses, 0);
  assert.equal(stats.skippedDuplicateClasses, 2);
  assert.ok(stats.skippedDuplicateObjectProps >= 1);
  assert.equal(merged.classes.length, DOMAIN_PRESETS.school.classes.length);
});

test('parseTurtleBatchToOntology reports missing owl:Class definitions with repair snippet and supports supplementary instances', () => {
  const missingClassTtl = `
@prefix lab: <https://onto.campus.org/lab#> .
lab:Device_01 a lab:Device ;
    lab:serialNo "SN-9001" .
`;

  const res = parseTurtleBatchToOntology([{ fileName: 'abox-only.ttl', content: missingClassTtl }]);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.diagnostics.missingClassDefs.length, 1);
  assert.equal(res.diagnostics.missingClassDefs[0].prefixedRef, 'lab:Device');
  assert.ok(res.diagnostics.repairTurtleSnippet.includes('lab:Device a owl:Class'));

  // Applying repair snippet resolves missingClassDefs to 0
  const repaired = parseTurtleBatchToOntology([
    { fileName: 'abox-only.ttl', content: `${missingClassTtl}\n${res.diagnostics.repairTurtleSnippet}` },
  ]);
  assert.equal(repaired.ok, true);
  if (!repaired.ok) return;
  assert.equal(repaired.diagnostics.missingClassDefs.length, 0);

  // Bare untyped triples provide diagnostics and succeed with allowSupplementaryInstances: true
  const bareTriples = `
@prefix lab: <https://onto.campus.org/lab#> .
lab:Device_01 lab:remark "备用设备" .
`;
  const strictRejected = parseTurtleBatchToOntology([{ fileName: 'bare.ttl', content: bareTriples }]);
  assert.equal(strictRejected.ok, false);
  if (strictRejected.ok) return;
  assert.equal(strictRejected.diagnostics?.untypedSubjectCount, 1);
  assert.ok(strictRejected.diagnostics?.repairTurtleSnippet.includes('SupplementaryInstance'));

  const supplementaryOk = parseTurtleBatchToOntology(
    [{ fileName: 'bare.ttl', content: bareTriples }],
    { allowSupplementaryInstances: true },
  );
  assert.equal(supplementaryOk.ok, true);
  if (!supplementaryOk.ok) return;
  assert.equal(supplementaryOk.ontology.classes[0].name, 'SupplementaryInstance');
  assert.equal(supplementaryOk.aboxInstanceCount, 1);
});

test('only school ontology preset exists and passes consistency checks with fine-grained classes', () => {
  assert.deepEqual(Object.keys(DOMAIN_PRESETS), ['school']);

  const school = DOMAIN_PRESETS.school;
  const classNames = new Set(school.classes.map((c) => c.name));
  for (const required of [
    'Broom',
    'Mop',
    'Textbook',
    'PlaygroundZone',
    'PlaygroundAllocation',
    'CourseSchedule',
    'TeacherAssignment',
    'AcademicAffairsOffice',
    'StudentUnion',
    'DisciplineRule',
    'DisciplineRoster',
  ]) {
    assert.ok(classNames.has(required), `Missing required class ${required}`);
  }

  const report = runOntologyReasoner(school);
  assert.equal(report.consistent, true);
  assert.equal(report.issues.length, 0);
  assert.ok(report.inferredAxioms.some((a) => a.subjectId === 'edu-homeroom'));
  assert.ok(report.inferredAxioms.some((a) => a.detail.includes('hasStudent')));
});

test('generateExampleInstanceTriples produces concrete triples for Classroom and Broom', () => {
  const clsSample = generateExampleInstanceTriples('edu-class', DOMAIN_PRESETS.school);
  assert.equal(clsSample.instanceUri, 'edu:Class_2026_03');
  assert.ok(clsSample.triples.some((t) => t.predicate === 'rdf:type' && t.object === 'edu:Classroom'));
  assert.ok(clsSample.triples.some((t) => t.predicate === 'edu:belongsToGrade' && t.object === 'edu:Grade_10'));

  const broomSample = generateExampleInstanceTriples('edu-broom', DOMAIN_PRESETS.school);
  assert.equal(broomSample.instanceUri, 'edu:Broom_G103_01');
  assert.ok(broomSample.triples.some((t) => t.predicate === 'edu:broomOwnedByClass' && t.object === 'edu:Class_2026_03'));
});

test('getAncestorIds resolves multi-level school taxonomy without cycles', () => {
  const school = DOMAIN_PRESETS.school;
  const { ancestors, hasCycle } = getAncestorIds('edu-homeroom', school.classes);
  assert.equal(hasCycle, false);
  assert.deepEqual(ancestors, ['edu-teacher', 'edu-person', 'edu-entity']);
});

test('getInheritedDataProperties inherits properties from parent school classes', () => {
  const school = DOMAIN_PRESETS.school;
  const inherited = getInheritedDataProperties('edu-broom', school.classes);
  const propNames = inherited.map((p) => p.name);
  assert.ok(propNames.includes('assetCode'));
  assert.ok(propNames.includes('quantity'));
  assert.ok(propNames.includes('globalId'));
});

test('runOntologyReasoner infers transitive axioms and catches cycles and disjoint conflicts', () => {
  const transitivePreset: DomainOntologyPreset = {
    ...DOMAIN_PRESETS.school,
    objectProperties: [
      ...DOMAIN_PRESETS.school.objectProperties,
      {
        id: 'op-trans-test',
        name: 'supervisesPart',
        label: '层级管理',
        domainId: 'edu-affairs',
        rangeId: 'edu-union',
        cardinality: '1..*',
        transitive: true,
      },
    ],
  };
  const validReport = runOntologyReasoner(transitivePreset);
  assert.equal(validReport.consistent, true);
  assert.ok(validReport.inferredAxioms.some((a) => a.rule.includes('TransitiveProperty')));
  assert.ok(validReport.inferredAxioms.some((a) => a.rule.includes('inverseOf')));

  const broken: DomainOntologyPreset = {
    ...DOMAIN_PRESETS.school,
    classes: [
      {
        id: 'c1',
        name: 'ClassA',
        label: '甲类',
        parentId: 'c2',
        layer: 'domain',
        description: 'test',
        disjointWith: ['c2'],
        x: 0,
        y: 0,
        estimatedInstances: 100,
        dataProperties: [],
      },
      {
        id: 'c2',
        name: 'ClassB',
        label: '乙类',
        parentId: 'c1',
        layer: 'domain',
        description: 'test',
        x: 0,
        y: 0,
        estimatedInstances: 100,
        dataProperties: [],
      },
    ],
    objectProperties: [],
    shaclRules: [],
  };

  const report = runOntologyReasoner(broken);
  assert.equal(report.consistent, false);
  assert.ok(report.issues.some((i) => i.code === 'CYCLE_DETECTED'));
  assert.ok(report.issues.some((i) => i.code === 'DISJOINT_CONFLICT'));
});

test('generateTurtleSerialization outputs valid OWL classes, object properties, and SHACL shapes for school ontology', () => {
  const ttl = generateTurtleSerialization(DOMAIN_PRESETS.school);
  assert.ok(ttl.includes('@prefix edu: <https://onto.edukg.org/school#> .'));
  assert.ok(ttl.includes('edu:Classroom a owl:Class ;'));
  assert.ok(ttl.includes('edu:Broom a owl:Class ;'));
  assert.ok(ttl.includes('edu:enrolledInClass a owl:ObjectProperty, owl:FunctionalProperty ;'));
  assert.ok(ttl.includes('a sh:NodeShape ;'));
});

test('forceGraph helpers split labels cleanly, seed inside bounds, and step physics while respecting pinned nodes', () => {
  assert.deepEqual(splitSphereLabel('教导处'), ['教导处']);
  assert.deepEqual(splitSphereLabel('班级扫帚'), ['班级扫帚']);
  assert.deepEqual(splitSphereLabel('操场分配使用计划'), ['操场分配', '使用计划']);
  assert.deepEqual(splitSphereLabel('校园实体 (顶层)'), ['校园实体']);

  const school = DOMAIN_PRESETS.school;
  const bounds = { width: 660, height: 520 };
  const seeded = seedForceNodes(school.classes, bounds);
  assert.equal(seeded.length, school.classes.length);
  for (const node of seeded) {
    assert.ok(node.x >= node.radius && node.x <= bounds.width - node.radius);
    assert.ok(node.y >= node.radius && node.y <= bounds.height - node.radius);
  }

  const edges = buildForceEdges(school.classes, school.objectProperties);
  assert.ok(edges.some((e) => e.kind === 'subClassOf'));
  assert.ok(edges.some((e) => e.kind === 'objectProperty'));

  // Pin one sphere and verify it stays stationary while unpinned spheres step and stay bounded
  const withPinned = seeded.map((n) =>
    n.id === 'edu-broom' ? { ...n, x: 240, y: 210, pinned: true } : n,
  );
  let sim = withPinned;
  for (let frame = 0; frame < 30; frame++) {
    sim = stepForceSimulation(sim, edges, bounds, frame * 16, { ambientFloat: false });
  }
  const pinnedAfter = sim.find((n) => n.id === 'edu-broom')!;
  assert.equal(pinnedAfter.x, 240);
  assert.equal(pinnedAfter.y, 210);

  for (const node of sim) {
    assert.ok(node.x >= node.radius + 14 - 0.01);
    assert.ok(node.x <= bounds.width - node.radius - 14 + 0.01);
    assert.ok(node.y >= node.radius + 14 - 0.01);
    assert.ok(node.y <= bounds.height - node.radius - 14 + 0.01);
  }
});

test('simulateConstructionMetrics improves throughput and reduces comparisons when optimizations enabled', () => {
  const naive = simulateConstructionMetrics({
    tripleScaleMillions: 500,
    incrementalDelta: false,
    typePartitionBlocking: false,
    owlProfile: 'OWL2_DL',
    parallelShacl: false,
  });
  const optimized = simulateConstructionMetrics({
    tripleScaleMillions: 500,
    incrementalDelta: true,
    typePartitionBlocking: true,
    owlProfile: 'OWL2_EL',
    parallelShacl: true,
  });

  assert.ok(optimized.ingestRateKTriplesPerSec > naive.ingestRateKTriplesPerSec * 3);
  assert.ok(optimized.entityResolutionComparisonsBillions < naive.entityResolutionComparisonsBillions);
  assert.ok(optimized.memoryFootprintGB < naive.memoryFootprintGB);
});

test('simulateQueryPlan sharply reduces latency and scanned edges with ontology pruning and join reordering', () => {
  const unoptimized = simulateQueryPlan({
    tripleScaleMillions: 500,
    hopDepth: 4,
    dictionaryBitmapEncoding: false,
    ontologyClassPruning: false,
    cardinalityJoinReorder: false,
    materializedHotViews: false,
  });
  const optimized = simulateQueryPlan({
    tripleScaleMillions: 500,
    hopDepth: 4,
    dictionaryBitmapEncoding: true,
    ontologyClassPruning: true,
    cardinalityJoinReorder: true,
    materializedHotViews: true,
  });

  assert.ok(optimized.speedupFactor > 10);
  assert.ok(optimized.optimizedScannedEdges < unoptimized.optimizedScannedEdges * 0.1);
  assert.ok(optimized.pruningRatioPct > 90);
});

test('ontologyBuilder validates steps, lays out hierarchies, and compiles beginner templates into consistent ontologies', () => {
  const blank = BEGINNER_TEMPLATES.find((t) => t.id === 'blank')!.createDraft();
  assert.equal(validateBuilderStep(0, blank).valid, false);
  assert.equal(validateBuilderStep(1, blank).valid, false);
  assert.equal(validateBuilderStep(4, blank).valid, false);

  assert.equal(sanitizeSlugIdentifier('  123 Book! '), 'C_123Book');
  assert.equal(sanitizeSlugIdentifier('EBook'), 'EBook');

  const libDraft = BEGINNER_TEMPLATES.find((t) => t.id === 'library')!.createDraft();
  assert.equal(validateBuilderStep(0, libDraft).valid, true);
  assert.equal(validateBuilderStep(1, libDraft).valid, true);
  assert.equal(validateBuilderStep(4, libDraft).valid, true);

  const built = buildPresetFromDraft(libDraft);
  assert.equal(built.source, 'wizard');
  assert.equal(built.prefix, 'lib');
  assert.equal(built.classes.length, libDraft.classes.length);

  // Verify layoutBuilderClasses computes distinct coordinates for siblings at the same depth
  const laidOut = layoutBuilderClasses(libDraft.classes);
  const depth1 = laidOut.filter((c) => c.parentId === 'wiz-item');
  assert.equal(depth1.length, 2);
  assert.notEqual(depth1[0].x, depth1[1].x);

  const report = runOntologyReasoner(built);
  assert.equal(report.consistent, true);
  assert.equal(report.issues.length, 0);

  // Enterprise template also builds cleanly and passes reasoner consistency
  const entDraft = BEGINNER_TEMPLATES.find((t) => t.id === 'enterprise')!.createDraft();
  const entBuilt = buildPresetFromDraft(entDraft);
  assert.equal(entBuilt.source, 'wizard');
  assert.equal(runOntologyReasoner(entBuilt).consistent, true);
});

