import type {
  ConstructionMetrics,
  ConstructionOptimizationConfig,
  DomainOntologyPreset,
  InferredAxiom,
  OntologyClass,
  OntologyDataProperty,
  QueryBenchmarkResult,
  QueryOptimizationConfig,
  QueryPlanStep,
  ReasonerIssue,
  ReasonerReport,
} from '../types/ontology';

/**
 * Returns ordered ancestor class IDs (from immediate parent up to root),
 * safely terminating if a cycle exists in parentId references.
 */
export function getAncestorIds(
  classId: string,
  classes: OntologyClass[],
): { ancestors: string[]; hasCycle: boolean } {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const ancestors: string[] = [];
  const visited = new Set<string>([classId]);

  let current = byId.get(classId);
  while (current && current.parentId) {
    if (visited.has(current.parentId)) {
      return { ancestors, hasCycle: true };
    }
    visited.add(current.parentId);
    ancestors.push(current.parentId);
    current = byId.get(current.parentId);
  }

  return { ancestors, hasCycle: false };
}

/**
 * Computes inherited data properties from ancestor classes along rdfs:subClassOf.
 */
export function getInheritedDataProperties(
  classId: string,
  classes: OntologyClass[],
): Array<OntologyDataProperty & { inheritedFrom: string }> {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const { ancestors } = getAncestorIds(classId, classes);
  const inherited: Array<OntologyDataProperty & { inheritedFrom: string }> = [];

  for (const ancId of ancestors) {
    const anc = byId.get(ancId);
    if (!anc) continue;
    for (const prop of anc.dataProperties) {
      inherited.push({ ...prop, inheritedFrom: anc.label });
    }
  }

  return inherited;
}

/**
 * Runs deterministic OWL 2 EL/RL style consistency & subsumption checks on the ontology graph.
 */
export function runOntologyReasoner(preset: DomainOntologyPreset): ReasonerReport {
  const issues: ReasonerIssue[] = [];
  const inferredAxioms: InferredAxiom[] = [];
  const byId = new Map(preset.classes.map((c) => [c.id, c]));

  // 1. Check subClassOf cycles & infer inherited transitive subclass chains
  for (const cls of preset.classes) {
    const { ancestors, hasCycle } = getAncestorIds(cls.id, preset.classes);
    if (hasCycle) {
      issues.push({
        id: `cycle-${cls.id}`,
        severity: 'error',
        code: 'CYCLE_DETECTED',
        message: `类「${cls.label} (${cls.name})」存在循环继承 (rdfs:subClassOf Cycle)，违反有向无环分类公理。`,
        targetId: cls.id,
      });
    } else if (ancestors.length >= 2) {
      const rootAnc = byId.get(ancestors[ancestors.length - 1]);
      if (rootAnc) {
        inferredAxioms.push({
          id: `inf-sub-${cls.id}`,
          subjectId: cls.id,
          subjectLabel: cls.label,
          rule: 'rdfs11 (传递继承推理)',
          detail: `${cls.name} rdfs:subClassOf ${rootAnc.name}（通过 ${ancestors.length} 层父类传递推导）`,
        });
      }
    }

    // Check disjointWith vs inheritance conflicts
    if (cls.disjointWith && cls.disjointWith.length > 0) {
      for (const disjId of cls.disjointWith) {
        if (ancestors.includes(disjId) || disjId === cls.id) {
          const disjCls = byId.get(disjId);
          issues.push({
            id: `disj-${cls.id}-${disjId}`,
            severity: 'error',
            code: 'DISJOINT_CONFLICT',
            message: `不可满足类 (Unsatisfiable Class)：「${cls.label}」声明与「${disjCls?.label ?? disjId}」互斥 (owl:disjointWith)，同时又继承自该类。`,
            targetId: cls.id,
          });
        }
      }
    }

    // Check high-cardinality instance classes without indexed identifier property
    const hasIndexedProp = cls.dataProperties.some((p) => p.indexed);
    if (cls.estimatedInstances >= 1_000_000 && !hasIndexedProp && cls.parentId !== null) {
      issues.push({
        id: `idx-${cls.id}`,
        severity: 'warning',
        code: 'MISSING_INDEX',
        message: `性能提示：「${cls.label}」预计实例规模达 ${(cls.estimatedInstances / 10000).toFixed(0)} 万，建议为至少一个核心数据属性开启索引 (indexed)。`,
        targetId: cls.id,
      });
    }
  }

  // 2. Check Object Properties for dangling references and inverse / transitive axioms
  for (const prop of preset.objectProperties) {
    if (!byId.has(prop.domainId) || !byId.has(prop.rangeId)) {
      issues.push({
        id: `orphan-${prop.id}`,
        severity: 'error',
        code: 'ORPHAN_RANGE',
        message: `对象属性「${prop.label} (${prop.name})」的 Domain 或 Range 指向了不存在的类节点。`,
        targetId: prop.id,
      });
      continue;
    }

    const domainCls = byId.get(prop.domainId)!;
    const rangeCls = byId.get(prop.rangeId)!;

    if (prop.transitive) {
      inferredAxioms.push({
        id: `inf-trans-${prop.id}`,
        subjectId: prop.domainId,
        subjectLabel: domainCls.label,
        rule: 'OWL TransitiveProperty',
        detail: `${prop.name} 具备传递性：若 A→B 且 B→C，查询引擎可自动展开多跳闭包或构建传递索引。`,
      });
    }

    if (prop.inverseOf) {
      inferredAxioms.push({
        id: `inf-inv-${prop.id}`,
        subjectId: prop.rangeId,
        subjectLabel: rangeCls.label,
        rule: 'owl:inverseOf 双向推演',
        detail: `由 ${domainCls.name} -[${prop.name}]-> ${rangeCls.name} 自动推导反向关系 ${prop.inverseOf}，查询无需冗余存储反向边。`,
      });
    }
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return {
    consistent: !hasError,
    profile: preset.classes.length > 8 ? 'OWL 2 EL' : 'OWL 2 RL',
    checkedClasses: preset.classes.length,
    checkedProperties: preset.objectProperties.length,
    issues,
    inferredAxioms,
    executionTimeMs: Number((1.4 + preset.classes.length * 0.25 + preset.objectProperties.length * 0.18).toFixed(1)),
  };
}

/**
 * Generates standards-compliant Turtle (.ttl) OWL + SHACL serialization from the current ontology model.
 */
export function generateTurtleSerialization(preset: DomainOntologyPreset): string {
  const byId = new Map(preset.classes.map((c) => [c.id, c]));
  const lines: string[] = [
    `@prefix ${preset.prefix}: <${preset.namespace}> .`,
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .`,
    `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
    `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix sh: <http://www.w3.org/ns/shacl#> .`,
    '',
    `<${preset.namespace.replace(/#$/, '')}> a owl:Ontology ;`,
    `    rdfs:label "${preset.name}"@zh ;`,
    `    owl:imports <${preset.upperStandard}> .`,
    '',
    '# === 1. 类与层次公理 (Classes & Taxonomy) ===',
  ];

  for (const cls of preset.classes) {
    const parentName = cls.parentId && byId.has(cls.parentId) ? `${preset.prefix}:${byId.get(cls.parentId)!.name}` : 'owl:Thing';
    lines.push(`${preset.prefix}:${cls.name} a owl:Class ;`);
    lines.push(`    rdfs:label "${cls.label}"@zh ;`);
    lines.push(`    rdfs:subClassOf ${parentName} ;`);
    if (cls.disjointWith && cls.disjointWith.length > 0) {
      const disjRefs = cls.disjointWith
        .map((id) => byId.get(id))
        .filter((c): c is OntologyClass => Boolean(c))
        .map((c) => `${preset.prefix}:${c.name}`);
      if (disjRefs.length > 0) {
        lines.push(`    owl:disjointWith ${disjRefs.join(', ')} ;`);
      }
    }
    lines.push(`    rdfs:comment "${cls.description}"@zh .`);
    lines.push('');
  }

  lines.push('# === 2. 对象属性公理 (Object Properties) ===');
  for (const prop of preset.objectProperties) {
    const domain = byId.get(prop.domainId);
    const range = byId.get(prop.rangeId);
    if (!domain || !range) continue;

    const types = ['owl:ObjectProperty'];
    if (prop.transitive) types.push('owl:TransitiveProperty');
    if (prop.symmetric) types.push('owl:SymmetricProperty');
    if (prop.functional) types.push('owl:FunctionalProperty');

    lines.push(`${preset.prefix}:${prop.name} a ${types.join(', ')} ;`);
    lines.push(`    rdfs:label "${prop.label}"@zh ;`);
    lines.push(`    rdfs:domain ${preset.prefix}:${domain.name} ;`);
    lines.push(`    rdfs:range ${preset.prefix}:${range.name} .`);
    lines.push('');
  }

  if (preset.shaclRules.length > 0) {
    lines.push('# === 3. SHACL 数据质量与基数约束 (Shapes) ===');
    for (const rule of preset.shaclRules) {
      const target = byId.get(rule.targetClassId);
      if (!target) continue;
      lines.push(`${preset.prefix}:${target.name}Shape a sh:NodeShape ;`);
      lines.push(`    sh:targetClass ${preset.prefix}:${target.name} ;`);
      lines.push(`    sh:property [`);
      lines.push(`        sh:path ${preset.prefix}:${rule.propertyName} ;`);
      if (rule.constraintType === 'minCount') {
        lines.push(`        sh:minCount ${rule.value} ;`);
      } else if (rule.constraintType === 'maxCount') {
        lines.push(`        sh:maxCount ${rule.value} ;`);
      } else if (rule.constraintType === 'pattern') {
        lines.push(`        sh:pattern "${rule.value}" ;`);
      } else {
        lines.push(`        sh:message "${rule.description}"@zh ;`);
      }
      lines.push(`        sh:severity sh:${rule.severity}`);
      lines.push(`    ] .`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generates concrete, human-readable ABox example triples for any selected ontology class
 * so modelers can immediately verify how TBox axioms map to real instance data.
 */
export function generateExampleInstanceTriples(
  classId: string,
  preset: DomainOntologyPreset,
): { instanceUri: string; triples: Array<{ predicate: string; object: string; note: string }> } {
  const cls = preset.classes.find((c) => c.id === classId) ?? preset.classes[0];
  const byId = new Map(preset.classes.map((c) => [c.id, c]));
  const prefix = preset.prefix;

  const sampleLookup: Record<string, { idSuffix: string; values: Record<string, string> }> = {
    'edu-class': {
      idSuffix: 'Class_2026_03',
      values: { classCode: '"CLS-G1-03"', className: '"高一(3)班"', homeroomLocation: '"笃行楼302室"', unitCode: '"ORG-G103"' },
    },
    'edu-student': {
      idSuffix: 'Student_LiMing',
      values: { studentNo: '"STU-20260312"', classRole: '"卫生组长(周三)"', fullName: '"李明"' },
    },
    'edu-teacher': {
      idSuffix: 'Teacher_WangFang',
      values: { teacherNo: '"TCH-1042"', subjectSpecialty: '"高中物理"', fullName: '"王芳"' },
    },
    'edu-homeroom': {
      idSuffix: 'Teacher_ZhangWei',
      values: { tenureStart: '"2026-09-01T08:00:00Z"', officePhone: '"0512-8801302"', fullName: '"张伟"' },
    },
    'edu-grade': {
      idSuffix: 'Grade_10',
      values: { gradeLevel: '10', academicYear: '"2026-2027"', unitCode: '"ORG-G10"' },
    },
    'edu-course': {
      idSuffix: 'Course_Physics_Lab',
      values: { courseCode: '"PHY-102"', weeklyPeriods: '4' },
    },
    'edu-broom': {
      idSuffix: 'Broom_G103_01',
      values: { broomType: '"软毛教室扫帚"', storageCorner: '"高一(3)班后排东侧卫生角"', assetCode: '"CLEAN-1031"', quantity: '4' },
    },
    'edu-mop': {
      idSuffix: 'Mop_G103_01',
      values: { mopType: '"旋转脱水拖把+水桶"', sanitizeCycleDays: '3', assetCode: '"CLEAN-2031"', quantity: '3' },
    },
    'edu-textbook': {
      idSuffix: 'Textbook_PHY_G1',
      values: { isbnCode: '"978-7-107-33612-6"', editionLabel: '"人教版必修一(2026秋)"', quantity: '45' },
    },
    'edu-playground': {
      idSuffix: 'Playground_Track_East',
      values: { zoneCode: '"PG-TRACK-E"', maxClassQuota: '3' },
    },
    'edu-pg-alloc': {
      idSuffix: 'Alloc_Tue_P3_G103',
      values: { allocationId: '"PGA-2026-041"', timeSlot: '"周二第3节(10:10-10:55)"', usagePurpose: '"体育课田径测试"' },
    },
    'edu-course-sch': {
      idSuffix: 'Schedule_Mon_P2_G103',
      values: { scheduleId: '"SCH-G103-0102"', weekdaySlot: '"周一第2节(08:55-09:40)"' },
    },
    'edu-teacher-arr': {
      idSuffix: 'Assign_WangFang_G103',
      values: { assignmentId: '"TA-2026-088"', dutyRoleType: '"主讲物理 + 周三午休走廊护导"' },
    },
    'edu-affairs': {
      idSuffix: 'AcademicAffairsOffice',
      values: { officeCode: '"DEPT-EDU-01"', directorName: '"陈明远主任"' },
    },
    'edu-union': {
      idSuffix: 'StudentUnion_DisciplineDept',
      values: { termYear: '"2026-2027届"', dutyDepartment: '"纪检部 & 卫生部"' },
    },
    'edu-disc-rule': {
      idSuffix: 'Rule_Hygiene_Tool_04',
      values: { ruleCode: '"RULE-HYG-04"', maxDeductionPoints: '2.0' },
    },
    'edu-disc-roster': {
      idSuffix: 'Roster_Morning_Check_W12',
      values: { rosterId: '"DR-2026-W12-01"', checkWindow: '"每日 07:20-07:50 早读及卫生角检查"' },
    },
  };

  const presetSample = sampleLookup[cls.id];
  const instanceUri = `${prefix}:${presetSample?.idSuffix ?? `${cls.name}_Sample_01`}`;
  const triples: Array<{ predicate: string; object: string; note: string }> = [
    {
      predicate: 'rdf:type',
      object: `${prefix}:${cls.name}`,
      note: `声明该实例属于「${cls.label}」类`,
    },
  ];

  // Own data properties
  for (const dp of cls.dataProperties.slice(0, 3)) {
    const val =
      presetSample?.values[dp.name] ??
      (dp.datatype === 'xsd:integer'
        ? '10'
        : dp.datatype === 'xsd:decimal'
          ? '1.0'
          : dp.datatype === 'xsd:boolean'
            ? 'true'
            : dp.datatype === 'xsd:dateTime'
              ? '"2026-11-20T09:00:00Z"'
              : `"示例_${dp.label}"`);
    triples.push({
      predicate: `${prefix}:${dp.name}`,
      object: val,
      note: `${dp.label} (${dp.datatype})`,
    });
  }

  // Outgoing object properties
  const outgoingProps = preset.objectProperties.filter((op) => op.domainId === cls.id);
  for (const op of outgoingProps.slice(0, 3)) {
    const targetCls = byId.get(op.rangeId);
    const targetSample = targetCls ? sampleLookup[targetCls.id]?.idSuffix ?? `${targetCls.name}_01` : 'Target_01';
    triples.push({
      predicate: `${prefix}:${op.name}`,
      object: `${prefix}:${targetSample}`,
      note: `${op.label} → ${targetCls?.label ?? op.rangeId} (${op.cardinality})`,
    });
  }

  return { instanceUri, triples };
}

/**
 * Deterministic model for Large-Scale Knowledge Graph Construction Optimization.
 */
export function simulateConstructionMetrics(
  config: ConstructionOptimizationConfig,
): ConstructionMetrics {
  const scaleFactor = config.tripleScaleMillions / 10; // 1x at 10M, 100x at 1B
  const baseEntitiesMillions = config.tripleScaleMillions * 0.14; // ~14% entities vs triples

  // Base ingestion rate (k triples / sec)
  let ingestRate = 48;
  if (config.incrementalDelta) ingestRate *= 1.85;
  if (config.owlProfile === 'OWL2_EL') ingestRate *= 2.1;
  else if (config.owlProfile === 'OWL2_RL') ingestRate *= 1.55;
  if (config.parallelShacl) ingestRate *= 1.45;
  if (config.typePartitionBlocking) ingestRate *= 1.25;

  const totalTriplesK = config.tripleScaleMillions * 1000;
  const fullBuildMinutes = Number((totalTriplesK / ingestRate / 60).toFixed(1));

  // Incremental update for a 10,000-triple business batch
  const incrementalUpdateMs = config.incrementalDelta
    ? Math.round((config.parallelShacl ? 42 : 115) + Math.log10(config.tripleScaleMillions) * 18)
    : Math.round(fullBuildMinutes * 60 * 1000);

  // Entity resolution pairwise comparisons (in billions): naive O(N^2) vs Ontology Type Blocking O(N * k)
  const naiveComparisonsBillions = (baseEntitiesMillions * baseEntitiesMillions) / 2;
  const entityResolutionComparisonsBillions = config.typePartitionBlocking
    ? Number(((baseEntitiesMillions * 0.018)).toFixed(3))
    : Number(naiveComparisonsBillions.toFixed(1));

  // Memory footprint (GB)
  let memoryFootprintGB = 1.6 * scaleFactor;
  if (config.owlProfile === 'OWL2_DL') memoryFootprintGB *= 2.4;
  else if (config.owlProfile === 'OWL2_RL') memoryFootprintGB *= 1.35;
  if (config.incrementalDelta) memoryFootprintGB *= 0.72;

  const reasoningComplexity =
    config.owlProfile === 'OWL2_EL'
      ? 'PTime 多项式复杂度 (ELK 并发分类)'
      : config.owlProfile === 'OWL2_RL'
        ? '规则物化前向推理 (Datalog / RDFox)'
        : 'N2ExpTime 完备描述逻辑 (易引发内存爆炸)';

  return {
    ingestRateKTriplesPerSec: Math.round(ingestRate),
    fullBuildMinutes,
    incrementalUpdateMs,
    entityResolutionComparisonsBillions,
    memoryFootprintGB: Number(Math.max(0.8, memoryFootprintGB).toFixed(1)),
    reasoningComplexity,
  };
}

/**
 * Deterministic model for Large-Scale Knowledge Graph Query Optimization.
 */
export function simulateQueryPlan(config: QueryOptimizationConfig): QueryBenchmarkResult {
  const scaleMultiplier = Math.pow(config.tripleScaleMillions / 10, 0.78);
  const hopMultiplier = Math.pow(3.6, config.hopDepth - 1);

  const baselineScannedEdges = Math.round(18_000 * scaleMultiplier * hopMultiplier);
  const baselineLatencyMs = Math.round(42 * scaleMultiplier * hopMultiplier);

  let edgeReductionFactor = 1;
  let latencyFactor = 1;

  if (config.dictionaryBitmapEncoding) {
    edgeReductionFactor *= 0.85;
    latencyFactor *= 0.42; // Integer IDs + compressed CSR/HDT cache hit
  }
  if (config.ontologyClassPruning) {
    // Domain/Range & subClassOf bitmask pruning skips irrelevant edge labels & partitions
    edgeReductionFactor *= config.hopDepth >= 3 ? 0.14 : 0.28;
    latencyFactor *= config.hopDepth >= 3 ? 0.18 : 0.34;
  }
  if (config.cardinalityJoinReorder) {
    // Functional/1..1 edges evaluated first shrink intermediate join width exponentially
    edgeReductionFactor *= config.hopDepth >= 3 ? 0.25 : 0.55;
    latencyFactor *= config.hopDepth >= 3 ? 0.22 : 0.52;
  }
  if (config.materializedHotViews) {
    edgeReductionFactor *= 0.35;
    latencyFactor *= 0.32;
  }

  const optimizedScannedEdges = Math.max(120, Math.round(baselineScannedEdges * edgeReductionFactor));
  const optimizedLatencyMs = Math.max(4, Math.round(baselineLatencyMs * latencyFactor));
  const speedupFactor = Number((baselineLatencyMs / optimizedLatencyMs).toFixed(1));
  const pruningRatioPct = Number(
    (((baselineScannedEdges - optimizedScannedEdges) / baselineScannedEdges) * 100).toFixed(1),
  );

  const planSteps: QueryPlanStep[] = [
    {
      operator: config.ontologyClassPruning ? 'SchemaBitmaskPrune (本体类剪枝)' : 'FullLabelScan (全标签扫描)',
      detail: config.ontologyClassPruning
        ? '利用 rdfs:domain/range 与位掩码直接排除 80%+ 无关谓词分区'
        : '未启用本体语义剪枝，遍历全部关系边类型',
      estimatedRows: Math.round(optimizedScannedEdges * 0.45),
      costSharePct: config.ontologyClassPruning ? 14 : 42,
    },
    {
      operator: config.cardinalityJoinReorder ? 'CardinalityAwareJoin (基数重排序)' : 'LeftDeepHashJoin (默认顺序连接)',
      detail: config.cardinalityJoinReorder
        ? '优先执行 1..1 Functional 属性过滤，大幅压缩中间态笛卡尔积'
        : '按书写顺序执行多跳 Join，中间结果集膨胀显著',
      estimatedRows: Math.round(optimizedScannedEdges * 0.22),
      costSharePct: config.cardinalityJoinReorder ? 28 : 44,
    },
    {
      operator: config.dictionaryBitmapEncoding ? 'HDT/CSR BitmapSeek (压缩位图寻址)' : 'StringURILookup (字符串字典回表)',
      detail: config.dictionaryBitmapEncoding
        ? '64位整数字典编码 + RoaringBitmap 交集运算驻留 L3 缓存'
        : '逐条解码长 URI 字符串，CPU 缓存命中率低',
      estimatedRows: Math.max(24, Math.round(optimizedScannedEdges * 0.04)),
      costSharePct: config.dictionaryBitmapEncoding ? 18 : 14,
    },
  ];

  if (config.materializedHotViews) {
    planSteps.unshift({
      operator: 'MaterializedPathHit (物化路径缓存)',
      detail: '命中高频 2-Hop 推理物化视图，跳过底层实时闭包展开',
      estimatedRows: Math.max(18, Math.round(optimizedScannedEdges * 0.08)),
      costSharePct: 9,
    });
    // Rebalance percentages to sum near 100 cleanly
    const sum = planSteps.reduce((acc, s) => acc + s.costSharePct, 0);
    for (const s of planSteps) {
      s.costSharePct = Math.round((s.costSharePct / sum) * 100);
    }
  } else {
    const sum = planSteps.reduce((acc, s) => acc + s.costSharePct, 0);
    for (const s of planSteps) {
      s.costSharePct = Math.round((s.costSharePct / sum) * 100);
    }
  }

  const rewrittenQuery = [
    `# 查询深度: ${config.hopDepth}-Hop | 规模: ${config.tripleScaleMillions}M Triples`,
    `PREFIX kg: <https://onto.example.org/core#>`,
    `SELECT ?source ?target WHERE {`,
    config.ontologyClassPruning
      ? `  # [优化1] 本体子类位掩码直达物理分区，免去 UNION 全扫\n  ?source a kg:CoreEntity_Bitmask_0x1F ;`
      : `  ?source a ?anyType . ?anyType rdfs:subClassOf* kg:CoreEntity .`,
    config.cardinalityJoinReorder
      ? `  # [优化2] 基数估算器将高选择性 Functional 属性置顶\n  ?source kg:hasRiskTier "HIGH"^^xsd:string ;`
      : `  ?source kg:connectedTo{1,${config.hopDepth}} ?target .`,
    config.materializedHotViews
      ? `  # [优化3] 命中预物化多跳捷径视图 (Materialized View)\n  ?source kg:mat_2hop_link ?target .`
      : `  ?source kg:relatedTo ?mid . ?mid kg:suppliedBy ?target .`,
    config.cardinalityJoinReorder ? `  ?source kg:connectedTo{1,${config.hopDepth}} ?target .` : `  ?source kg:hasRiskTier "HIGH" .`,
    `}`,
  ].join('\n');

  return {
    baselineLatencyMs,
    optimizedLatencyMs,
    speedupFactor,
    baselineScannedEdges,
    optimizedScannedEdges,
    pruningRatioPct,
    planSteps,
    rewrittenQuery,
  };
}
