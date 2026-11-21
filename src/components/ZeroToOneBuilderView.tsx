import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Code2,
  Database,
  GitBranch,
  Plus,
  Rocket,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  DomainOntologyPreset,
  OntologyClass,
  OntologyDataProperty,
  OntologyObjectProperty,
  ShaclRule,
} from '../types/ontology';
import {
  BEGINNER_TEMPLATES,
  buildPresetFromDraft,
  sanitizeSlugIdentifier,
  validateBuilderStep,
  type BuilderDraft,
} from '../utils/ontologyBuilder';
import {
  generateExampleInstanceTriples,
  generateTurtleSerialization,
  getInheritedDataProperties,
  runOntologyReasoner,
} from '../utils/ontologyEngine';
import { DynamicSphereGraph } from './DynamicSphereGraph';

interface ZeroToOneBuilderViewProps {
  onBackToList: () => void;
  onCompleteBuild: (ontology: DomainOntologyPreset) => void;
}

const STEPS = [
  {
    id: 0,
    num: '01',
    title: '定义领域范围',
    owlTag: 'owl:Ontology',
    analogy: '先确定知识图谱的名称、缩写前缀（如 lib:）以及要回答的业务问题。',
  },
  {
    id: 1,
    num: '02',
    title: '枚举核心类与层级',
    owlTag: 'owl:Class / subClassOf',
    analogy: '列出业务里的“名词分类”；子类（如 纸质图书）会自动继承父类（馆藏资源）的特征。',
  },
  {
    id: 2,
    num: '03',
    title: '定义实体自身属性',
    owlTag: 'owl:DatatypeProperty',
    analogy: '给每个类添加描述自身特征的字段（文字、数字、日期等基础值），类似数据表字段。',
  },
  {
    id: 3,
    num: '04',
    title: '连接概念语义关系',
    owlTag: 'owl:ObjectProperty',
    analogy: '用“动词”把两个类连接起来（主语类 → 关系 → 宾语类），构成知识图谱的边。',
  },
  {
    id: 4,
    num: '05',
    title: '门禁规则与推理验证',
    owlTag: 'SHACL + Reasoner',
    analogy: '配置入库必填/格式规则，并用推理机检测父类互斥或环路冲突，验证无误即可使用。',
  },
] as const;

export function ZeroToOneBuilderView({
  onBackToList,
  onCompleteBuild,
}: ZeroToOneBuilderViewProps) {
  const [activeTemplateId, setActiveTemplateId] = useState<'library' | 'enterprise' | 'blank'>('library');
  const [draft, setDraft] = useState<BuilderDraft>(() => BEGINNER_TEMPLATES[0].createDraft());
  const [step, setStep] = useState<number>(0);
  const [previewTab, setPreviewTab] = useState<'graph' | 'instance' | 'turtle'>('graph');
  const [stepError, setStepError] = useState<string>('');

  // Step 2: Add Class form
  const [clsLabel, setClsLabel] = useState('');
  const [clsName, setClsName] = useState('');
  const [clsParentId, setClsParentId] = useState<string>('');
  const [clsDisjointId, setClsDisjointId] = useState<string>('');

  // Step 3: Add DataProperty form
  const [dpTargetClassId, setDpTargetClassId] = useState<string>(() => draft.classes[1]?.id ?? draft.classes[0]?.id ?? '');
  const [dpLabel, setDpLabel] = useState('');
  const [dpName, setDpName] = useState('');
  const [dpDatatype, setDpDatatype] = useState<OntologyDataProperty['datatype']>('xsd:string');
  const [dpIndexed, setDpIndexed] = useState(true);

  // Step 4: Add ObjectProperty form
  const [opDomainId, setOpDomainId] = useState<string>(() => draft.classes[1]?.id ?? draft.classes[0]?.id ?? '');
  const [opRangeId, setOpRangeId] = useState<string>(() => draft.classes[3]?.id ?? draft.classes[0]?.id ?? '');
  const [opLabel, setOpLabel] = useState('');
  const [opName, setOpName] = useState('');
  const [opCard, setOpCard] = useState<OntologyObjectProperty['cardinality']>('1..*');
  const [opFunctional, setOpFunctional] = useState(false);
  const [opTransitive, setOpTransitive] = useState(false);

  // Step 5: Add SHACL form
  const [shTargetClassId, setShTargetClassId] = useState<string>(() => draft.classes[1]?.id ?? draft.classes[0]?.id ?? '');
  const [shPropName, setShPropName] = useState('');
  const [shType, setShType] = useState<ShaclRule['constraintType']>('minCount');
  const [shValue, setShValue] = useState('1');
  const [shSeverity, setShSeverity] = useState<'Violation' | 'Warning'>('Violation');

  const [selectedPreviewClassId, setSelectedPreviewClassId] = useState<string>(
    () => draft.classes[1]?.id ?? draft.classes[0]?.id ?? '',
  );

  const livePreset = useMemo(() => buildPresetFromDraft(draft), [draft]);
  const liveReasoner = useMemo(() => {
    if (livePreset.classes.length === 0) return null;
    return runOntologyReasoner(livePreset);
  }, [livePreset]);

  const liveTurtle = useMemo(() => {
    if (livePreset.classes.length === 0) {
      return `@prefix ${livePreset.prefix}: <${livePreset.namespace}> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n\n<${livePreset.namespace.replace(/#$/, '')}> a owl:Ontology ;\n    rdfs:label "${livePreset.name || '未命名本体'}"@zh .`;
    }
    return generateTurtleSerialization(livePreset);
  }, [livePreset]);

  const classMap = useMemo(
    () => new Map(draft.classes.map((c) => [c.id, c])),
    [draft.classes],
  );

  const resolvedPreviewClassId =
    classMap.has(selectedPreviewClassId)
      ? selectedPreviewClassId
      : (livePreset.classes[0]?.id ?? '');

  const liveExampleInstance = useMemo(() => {
    if (!resolvedPreviewClassId || livePreset.classes.length === 0) return null;
    return generateExampleInstanceTriples(resolvedPreviewClassId, livePreset);
  }, [resolvedPreviewClassId, livePreset]);

  const resolvedDpClassId = classMap.has(dpTargetClassId)
    ? dpTargetClassId
    : (draft.classes[0]?.id ?? '');
  const dpTargetClass = classMap.get(resolvedDpClassId);
  const dpInherited = useMemo(() => {
    if (!resolvedDpClassId) return [];
    return getInheritedDataProperties(resolvedDpClassId, draft.classes);
  }, [resolvedDpClassId, draft.classes]);

  const resolvedShClassId = classMap.has(shTargetClassId)
    ? shTargetClassId
    : (draft.classes[0]?.id ?? '');
  const shAvailableProps = useMemo(() => {
    const own = classMap.get(resolvedShClassId)?.dataProperties ?? [];
    const inh = resolvedShClassId ? getInheritedDataProperties(resolvedShClassId, draft.classes) : [];
    const seen = new Set<string>();
    const combined: Array<{ name: string; label: string }> = [];
    for (const p of [...own, ...inh]) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        combined.push({ name: p.name, label: p.label });
      }
    }
    return combined;
  }, [resolvedShClassId, classMap, draft.classes]);

  const applyTemplate = (tplId: 'library' | 'enterprise' | 'blank') => {
    const tpl = BEGINNER_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    const next = tpl.createDraft();
    setActiveTemplateId(tplId);
    setDraft(next);
    setStepError('');
    const firstId = next.classes[0]?.id ?? '';
    const secondId = next.classes[1]?.id ?? firstId;
    const fourthId = next.classes[3]?.id ?? firstId;
    setDpTargetClassId(secondId);
    setOpDomainId(secondId);
    setOpRangeId(fourthId);
    setShTargetClassId(secondId);
    setSelectedPreviewClassId(secondId);
  };

  const handleGoStep = (targetStep: number) => {
    if (targetStep > step) {
      const check = validateBuilderStep(step, draft);
      if (!check.valid) {
        setStepError(check.hint ?? '');
        return;
      }
    }
    setStepError('');
    setStep(targetStep);
  };

  const handleAddClass = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = clsLabel.trim();
    const cleanName = sanitizeSlugIdentifier(clsName, '');
    if (!cleanLabel || !cleanName) {
      setStepError('请填写类的中文名称与英文标识符（如 PaperBook）。');
      return;
    }
    if (draft.classes.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())) {
      setStepError(`类名 ${cleanName} 已存在，请更换标识。`);
      return;
    }
    const newId = `wiz-c-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const newClass: OntologyClass = {
      id: newId,
      name: cleanName,
      label: cleanLabel,
      parentId: clsParentId || null,
      layer: clsParentId ? 'domain' : 'upper',
      description: `${cleanLabel} (${cleanName})`,
      ...(clsDisjointId ? { disjointWith: [clsDisjointId] } : {}),
      x: 200,
      y: 160,
      dataProperties: [],
      estimatedInstances: 500,
    };

    setDraft((prev) => ({
      ...prev,
      classes: [...prev.classes, newClass],
    }));
    setClsLabel('');
    setClsName('');
    setClsDisjointId('');
    setStepError('');
    if (!dpTargetClassId) setDpTargetClassId(newId);
    if (!opDomainId) setOpDomainId(newId);
    if (!opRangeId) setOpRangeId(newId);
    if (!shTargetClassId) setShTargetClassId(newId);
    setSelectedPreviewClassId(newId);
  };

  const handleDeleteClass = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      classes: prev.classes
        .filter((c) => c.id !== id)
        .map((c) => ({
          ...c,
          parentId: c.parentId === id ? null : c.parentId,
          disjointWith: c.disjointWith?.filter((d) => d !== id),
        })),
      objectProperties: prev.objectProperties.filter(
        (op) => op.domainId !== id && op.rangeId !== id,
      ),
      shaclRules: prev.shaclRules.filter((r) => r.targetClassId !== id),
    }));
  };

  const handleAddDataProp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedDpClassId) return;
    const cleanLabel = dpLabel.trim();
    const cleanName = sanitizeSlugIdentifier(dpName, '');
    if (!cleanLabel || !cleanName) {
      setStepError('请填写属性的中文标签与英文属性名（如 isbn）。');
      return;
    }
    if (
      dpTargetClass?.dataProperties.some(
        (dp) => dp.name.toLowerCase() === cleanName.toLowerCase(),
      )
    ) {
      setStepError(`属性 ${cleanName} 已存在于该类中。`);
      return;
    }
    const newDp: OntologyDataProperty = {
      id: `wiz-dp-${Date.now()}`,
      name: cleanName,
      label: cleanLabel,
      datatype: dpDatatype,
      indexed: dpIndexed,
    };
    setDraft((prev) => ({
      ...prev,
      classes: prev.classes.map((c) =>
        c.id === resolvedDpClassId
          ? { ...c, dataProperties: [...c.dataProperties, newDp] }
          : c,
      ),
    }));
    setDpLabel('');
    setDpName('');
    setStepError('');
  };

  const handleRemoveDataProp = (classId: string, propId: string) => {
    setDraft((prev) => ({
      ...prev,
      classes: prev.classes.map((c) =>
        c.id === classId
          ? { ...c, dataProperties: c.dataProperties.filter((p) => p.id !== propId) }
          : c,
      ),
    }));
  };

  const handleAddObjectProp = (e: React.FormEvent) => {
    e.preventDefault();
    const domainId = classMap.has(opDomainId) ? opDomainId : (draft.classes[0]?.id ?? '');
    const rangeId = classMap.has(opRangeId) ? opRangeId : (draft.classes[0]?.id ?? '');
    const cleanLabel = opLabel.trim();
    const cleanName = sanitizeSlugIdentifier(opName, '');
    if (!domainId || !rangeId || !cleanLabel || !cleanName) {
      setStepError('请选择主语/宾语类并填写关系名称（如 borrowedBy / 借阅人）。');
      return;
    }
    const newOp: OntologyObjectProperty = {
      id: `wiz-op-${Date.now()}`,
      name: cleanName,
      label: cleanLabel,
      domainId,
      rangeId,
      cardinality: opFunctional ? '1..1' : opCard,
      ...(opFunctional ? { functional: true } : {}),
      ...(opTransitive ? { transitive: true } : {}),
    };
    setDraft((prev) => ({
      ...prev,
      objectProperties: [...prev.objectProperties, newOp],
    }));
    setOpLabel('');
    setOpName('');
    setOpFunctional(false);
    setOpTransitive(false);
    setStepError('');
  };

  const handleRemoveObjectProp = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      objectProperties: prev.objectProperties.filter((op) => op.id !== id),
    }));
  };

  const handleAddShacl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedShClassId) return;
    const prop = shPropName.trim() || shAvailableProps[0]?.name || '';
    const val = shValue.trim();
    if (!prop || !val) {
      setStepError('请选择或填写约束属性名及约束值。');
      return;
    }
    const newRule: ShaclRule = {
      id: `wiz-sh-${Date.now()}`,
      targetClassId: resolvedShClassId,
      propertyName: prop,
      constraintType: shType,
      value: val,
      severity: shSeverity,
      description: `${prop} sh:${shType} ${val}`,
    };
    setDraft((prev) => ({
      ...prev,
      shaclRules: [...prev.shaclRules, newRule],
      classes:
        shType === 'minCount' && Number(val) >= 1
          ? prev.classes.map((c) =>
              c.id === resolvedShClassId
                ? {
                    ...c,
                    dataProperties: c.dataProperties.map((dp) =>
                      dp.name === prop ? { ...dp, required: true } : dp,
                    ),
                  }
                : c,
            )
          : prev.classes,
    }));
    setShPropName('');
    setStepError('');
  };

  const handleRemoveShacl = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      shaclRules: prev.shaclRules.filter((r) => r.id !== id),
    }));
  };

  const handleFinish = () => {
    const check0 = validateBuilderStep(0, draft);
    if (!check0.valid) {
      setStep(0);
      setStepError(check0.hint ?? '');
      return;
    }
    if (draft.classes.length === 0) {
      setStep(1);
      setStepError('请至少创建 1 个类后再完成构建。');
      return;
    }
    onCompleteBuild(buildPresetFromDraft(draft));
  };

  const currentStepMeta = STEPS[step];

  return (
    <div className="space-y-5" data-testid="zero-to-one-builder">
      {/* Top Header */}
      <section className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>返回列表</span>
          </button>
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-blue-600 font-semibold">
              Ontology 101 · 交互式从零搭建向导
            </div>
            <h1 className="text-xl font-bold text-slate-900 truncate">
              {draft.name.trim() || '新建自定义本体模型'}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {draft.classes.length} 类 · {draft.objectProperties.length} 关系 · {draft.shaclRules.length} SHACL
          </span>
          <button
            type="button"
            onClick={handleFinish}
            data-testid="builder-finish-btn"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
            <span>完成构建并进入编辑器</span>
          </button>
        </div>
      </section>

      {/* 5-Step Progress Navigation */}
      <nav
        aria-label="从零搭建五步流程"
        className="grid grid-cols-2 sm:grid-cols-5 gap-2"
      >
        {STEPS.map((s) => {
          const isCurrent = step === s.id;
          const isDone = step > s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleGoStep(s.id)}
              data-testid={`builder-step-${s.id}`}
              className={`text-left p-3 rounded-xl border transition-colors ${
                isCurrent
                  ? 'bg-white border-blue-600 ring-2 ring-blue-600/15'
                  : isDone
                    ? 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className={isCurrent ? 'text-blue-600 font-bold' : isDone ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                  STEP {s.num}
                </span>
                <span className="text-slate-400 truncate">{s.owlTag}</span>
              </div>
              <div className={`text-xs font-semibold mt-1 truncate ${isCurrent ? 'text-slate-900' : 'text-slate-700'}`}>
                {s.title}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Main Split: Left Step Form + Right Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Interactive Step Panel */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          {/* Step Concept Header */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-900">
                第 {currentStepMeta.id + 1} 步：{currentStepMeta.title}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">{currentStepMeta.analogy}</div>
            </div>
            <span className="font-mono text-[11px] font-semibold text-blue-700 whitespace-nowrap shrink-0">
              {currentStepMeta.owlTag}
            </span>
          </div>

          {/* STEP 0: Scope & Starter Scenarios */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-800 mb-2">
                  选择起步方式（可一键载入入门模板体验每一步，或从空白自建）
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {BEGINNER_TEMPLATES.map((tpl) => {
                    const active = activeTemplateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl.id)}
                        data-testid={`template-card-${tpl.id}`}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                          active
                            ? 'border-blue-600 bg-blue-50/70'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="text-xs font-semibold text-slate-900">{tpl.title}</div>
                        <div className="text-[11px] font-mono text-slate-500 mt-1">{tpl.badge}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wiz-onto-name" className="block text-xs font-medium text-slate-700 mb-1">
                    本体中文名称
                  </label>
                  <input
                    id="wiz-onto-name"
                    type="text"
                    value={draft.name}
                    onChange={(e) => {
                      setDraft((p) => ({ ...p, name: e.target.value }));
                      setStepError('');
                    }}
                    placeholder="例如：图书馆借阅本体"
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="wiz-onto-prefix" className="block text-xs font-medium text-slate-700 mb-1">
                    英文前缀 (Prefix)
                  </label>
                  <input
                    id="wiz-onto-prefix"
                    type="text"
                    value={draft.prefix}
                    onChange={(e) => {
                      const nextPrefix = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                      setDraft((p) => ({
                        ...p,
                        prefix: nextPrefix,
                        namespace: `https://onto.studio/${(nextPrefix || 'onto').toLowerCase()}#`,
                      }));
                      setStepError('');
                    }}
                    placeholder="如 lib"
                    className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="wiz-onto-ns" className="block text-xs font-medium text-slate-700 mb-1">
                  唯一命名空间 (Namespace URI)
                </label>
                <input
                  id="wiz-onto-ns"
                  type="text"
                  value={draft.namespace}
                  onChange={(e) => setDraft((p) => ({ ...p, namespace: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="wiz-onto-cq" className="block text-xs font-medium text-slate-700 mb-1">
                  核心业务问题 (Competency Question · 用来决定需要建哪些类与关系)
                </label>
                <input
                  id="wiz-onto-cq"
                  type="text"
                  value={draft.competencyQuestion}
                  onChange={(e) => setDraft((p) => ({ ...p, competencyQuestion: e.target.value }))}
                  placeholder="例如：某本图书当前被哪位读者借走？"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          )}

          {/* STEP 1: Classes & Hierarchy */}
          {step === 1 && (
            <div className="space-y-4">
              <form onSubmit={handleAddClass} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="wiz-cls-label" className="block text-[11px] text-slate-600 mb-1">
                      概念中文名
                    </label>
                    <input
                      id="wiz-cls-label"
                      type="text"
                      value={clsLabel}
                      onChange={(e) => setClsLabel(e.target.value)}
                      placeholder="如 电子图书"
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label htmlFor="wiz-cls-name" className="block text-[11px] text-slate-600 mb-1">
                      英文类标识符 (PascalCase)
                    </label>
                    <input
                      id="wiz-cls-name"
                      type="text"
                      value={clsName}
                      onChange={(e) => setClsName(e.target.value)}
                      placeholder="如 EBook"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                  <div>
                    <label htmlFor="wiz-cls-parent" className="block text-[11px] text-slate-600 mb-1">
                      父类 (rdfs:subClassOf，选填)
                    </label>
                    <select
                      id="wiz-cls-parent"
                      value={clsParentId}
                      onChange={(e) => setClsParentId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      <option value="">owl:Thing (顶层独立类)</option>
                      {draft.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          继承自: {c.label} ({c.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor="wiz-cls-disj" className="block text-[11px] text-slate-600 mb-1">
                        互斥类 (owl:disjointWith)
                      </label>
                      <select
                        id="wiz-cls-disj"
                        value={clsDisjointId}
                        onChange={(e) => setClsDisjointId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      >
                        <option value="">无互斥声明</option>
                        {draft.classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            互斥: {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="submit"
                      data-testid="wiz-add-class-btn"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>添加类</span>
                    </button>
                  </div>
                </div>
              </form>

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {draft.classes.length === 0 ? (
                  <div className="p-4 text-xs text-slate-500 text-center">
                    暂无类，请在上方添加第 1 个核心概念类
                  </div>
                ) : (
                  draft.classes.map((c) => {
                    const parent = c.parentId ? classMap.get(c.parentId) : null;
                    return (
                      <div key={c.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {c.label}{' '}
                            <span className="font-mono font-normal text-blue-700">
                              {draft.prefix || 'onto'}:{c.name}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {parent ? `subClassOf ${parent.label} (${parent.name})` : 'subClassOf owl:Thing'}
                            {c.disjointWith && c.disjointWith.length > 0
                              ? ` · disjointWith ${c.disjointWith.map((id) => classMap.get(id)?.name ?? id).join(', ')}`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteClass(c.id)}
                          aria-label={`删除类 ${c.label}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Data Properties & Inheritance Demo */}
          {step === 2 && (
            <div className="space-y-4">
              {draft.classes.length === 0 ? (
                <div className="p-4 rounded-lg border border-slate-200 text-xs text-slate-500">
                  请先返回第 2 步添加类。
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="wiz-dp-target" className="block text-xs font-medium text-slate-700 mb-1">
                      选择要编辑属性的目标类
                    </label>
                    <select
                      id="wiz-dp-target"
                      value={resolvedDpClassId}
                      onChange={(e) => {
                        setDpTargetClassId(e.target.value);
                        setSelectedPreviewClassId(e.target.value);
                      }}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      {draft.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} ({c.name}) — 已有 {c.dataProperties.length} 个自身属性
                        </option>
                      ))}
                    </select>
                  </div>

                  <form onSubmit={handleAddDataProp} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        aria-label="属性中文标签"
                        value={dpLabel}
                        onChange={(e) => setDpLabel(e.target.value)}
                        placeholder="中文标签，如 页数"
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      />
                      <input
                        type="text"
                        aria-label="属性英文名"
                        value={dpName}
                        onChange={(e) => setDpName(e.target.value)}
                        placeholder="英文名，如 pageCount"
                        className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      />
                      <select
                        aria-label="XSD数据类型"
                        value={dpDatatype}
                        onChange={(e) => setDpDatatype(e.target.value as OntologyDataProperty['datatype'])}
                        className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      >
                        <option value="xsd:string">xsd:string (文本)</option>
                        <option value="xsd:integer">xsd:integer (整数)</option>
                        <option value="xsd:decimal">xsd:decimal (小数)</option>
                        <option value="xsd:dateTime">xsd:dateTime (日期时间)</option>
                        <option value="xsd:boolean">xsd:boolean (布尔)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={dpIndexed}
                          onChange={(e) => setDpIndexed(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span>建立属性索引（加速精确查询）</span>
                      </label>
                      <button
                        type="submit"
                        data-testid="wiz-add-dp-btn"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>添加属性</span>
                      </button>
                    </div>
                  </form>

                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {(dpTargetClass?.dataProperties.length ?? 0) === 0 && dpInherited.length === 0 ? (
                      <div className="p-4 text-xs text-slate-500 text-center">该类暂无属性</div>
                    ) : (
                      <>
                        {dpTargetClass?.dataProperties.map((p) => (
                          <div key={p.id} className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
                            <div>
                              <span className="font-semibold text-slate-900">{p.label}</span>{' '}
                              <span className="font-mono text-slate-500">({p.name})</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[11px] text-blue-700">{p.datatype}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveDataProp(resolvedDpClassId, p.id)}
                                aria-label={`移除属性 ${p.label}`}
                                className="p-1 text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        {dpInherited.map((inh) => (
                          <div key={`wiz-inh-${inh.id}`} className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs bg-slate-50/70">
                            <div>
                              <span className="font-medium text-slate-700">{inh.label}</span>{' '}
                              <span className="text-[11px] text-slate-500">
                                继承自 {inh.inheritedFrom} · <span className="font-mono">{inh.name}</span>
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">{inh.datatype}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: Object Properties */}
          {step === 3 && (
            <div className="space-y-4">
              {draft.classes.length === 0 ? (
                <div className="p-4 rounded-lg border border-slate-200 text-xs text-slate-500">
                  请先返回第 2 步添加类。
                </div>
              ) : (
                <>
                  <form onSubmit={handleAddObjectProp} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label htmlFor="wiz-op-domain" className="block text-[11px] text-slate-600 mb-1">
                          主语类 (Domain)
                        </label>
                        <select
                          id="wiz-op-domain"
                          value={classMap.has(opDomainId) ? opDomainId : draft.classes[0].id}
                          onChange={(e) => setOpDomainId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                        >
                          {draft.classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label} ({c.name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="wiz-op-label" className="block text-[11px] text-slate-600 mb-1">
                          关系动词中文名
                        </label>
                        <input
                          id="wiz-op-label"
                          type="text"
                          value={opLabel}
                          onChange={(e) => setOpLabel(e.target.value)}
                          placeholder="如 推荐给"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label htmlFor="wiz-op-range" className="block text-[11px] text-slate-600 mb-1">
                          宾语类 (Range)
                        </label>
                        <select
                          id="wiz-op-range"
                          value={classMap.has(opRangeId) ? opRangeId : draft.classes[0].id}
                          onChange={(e) => setOpRangeId(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                        >
                          {draft.classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label} ({c.name})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        aria-label="关系英文名"
                        value={opName}
                        onChange={(e) => setOpName(e.target.value)}
                        placeholder="英文关系标识，如 recommendedTo"
                        className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      />
                      <select
                        aria-label="关系基数"
                        value={opCard}
                        onChange={(e) => setOpCard(e.target.value as OntologyObjectProperty['cardinality'])}
                        className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      >
                        <option value="1..1">1..1 (一对一)</option>
                        <option value="0..1">0..1 (可选唯一)</option>
                        <option value="1..*">1..* (一对多)</option>
                        <option value="0..*">0..* (多对多)</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-4 text-xs text-slate-700">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={opFunctional}
                            onChange={(e) => setOpFunctional(e.target.checked)}
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span>Functional (唯一目标)</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={opTransitive}
                            onChange={(e) => setOpTransitive(e.target.checked)}
                            className="rounded border-slate-300 text-blue-600"
                          />
                          <span>Transitive (可传递)</span>
                        </label>
                      </div>
                      <button
                        type="submit"
                        data-testid="wiz-add-op-btn"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>添加关系</span>
                      </button>
                    </div>
                  </form>

                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-52 overflow-y-auto">
                    {draft.objectProperties.length === 0 ? (
                      <div className="p-4 text-xs text-slate-500 text-center">暂无对象关系</div>
                    ) : (
                      draft.objectProperties.map((op) => {
                        const d = classMap.get(op.domainId);
                        const r = classMap.get(op.rangeId);
                        return (
                          <div key={op.id} className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">
                                {d?.label ?? '?'} ——[{op.label} ({op.name})]→ {r?.label ?? '?'}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500">
                                基数 {op.cardinality}
                                {op.functional ? ' · Functional' : ''}
                                {op.transitive ? ' · Transitive' : ''}
                                {op.inverseOf ? ` · inverseOf ${op.inverseOf}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveObjectProp(op.id)}
                              aria-label={`移除关系 ${op.label}`}
                              className="p-1 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 4: SHACL Constraints & Live Reasoner */}
          {step === 4 && (
            <div className="space-y-4">
              {draft.classes.length > 0 && (
                <form onSubmit={handleAddShacl} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      aria-label="SHACL目标类"
                      value={resolvedShClassId}
                      onChange={(e) => setShTargetClassId(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      {draft.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          目标类: {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      list="wiz-shacl-props"
                      aria-label="约束属性名"
                      value={shPropName}
                      onChange={(e) => setShPropName(e.target.value)}
                      placeholder={shAvailableProps[0]?.name ? `如 ${shAvailableProps[0].name}` : '属性名'}
                      className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                    />
                    <datalist id="wiz-shacl-props">
                      {shAvailableProps.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.label}
                        </option>
                      ))}
                    </datalist>
                    <select
                      aria-label="约束类型"
                      value={shType}
                      onChange={(e) => setShType(e.target.value as ShaclRule['constraintType'])}
                      className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                    >
                      <option value="minCount">sh:minCount (最少/必填)</option>
                      <option value="maxCount">sh:maxCount (最多数量)</option>
                      <option value="pattern">sh:pattern (格式正则)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        aria-label="约束阈值"
                        value={shValue}
                        onChange={(e) => setShValue(e.target.value)}
                        placeholder="值，如 1 或 ^[A-Z]+-[0-9]+$"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                      />
                      <select
                        aria-label="严重级别"
                        value={shSeverity}
                        onChange={(e) => setShSeverity(e.target.value as 'Violation' | 'Warning')}
                        className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                      >
                        <option value="Violation">Violation (拦截)</option>
                        <option value="Warning">Warning (告警)</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      data-testid="wiz-add-shacl-btn"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>添加规则</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {draft.shaclRules.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500 text-center">暂无 SHACL 校验规则</div>
                ) : (
                  draft.shaclRules.map((r) => {
                    const cls = classMap.get(r.targetClassId);
                    return (
                      <div key={r.id} className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-slate-800">
                          {cls?.label ?? r.targetClassId} · sh:{r.constraintType} ({r.propertyName}) = {r.value}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[11px] font-medium ${r.severity === 'Violation' ? 'text-red-700' : 'text-amber-700'}`}>
                            {r.severity}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveShacl(r.id)}
                            aria-label={`移除 SHACL ${r.propertyName}`}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Live Reasoner Summary inside Step 5 */}
              {liveReasoner && (
                <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2" data-testid="wiz-reasoner-check">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-slate-900">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                      <span>实时推理机一致性检查</span>
                    </span>
                    <span className="font-mono text-slate-500">{liveReasoner.profile}</span>
                  </div>
                  {liveReasoner.consistent ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>
                        逻辑一致 (Consistent) · 推导 {liveReasoner.inferredAxioms.length} 条隐含公理
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-red-700 font-medium">
                        <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>发现 {liveReasoner.issues.length} 个逻辑冲突</span>
                      </div>
                      {liveReasoner.issues.map((issue) => (
                        <div key={issue.id} className="text-[11px] text-red-800 pl-6">
                          {issue.message}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {stepError && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 flex items-center gap-2" role="alert">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
              <span>{stepError}</span>
            </div>
          )}

          {/* Step Footer Controls */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => handleGoStep(Math.max(0, step - 1))}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一步
            </button>
            <div className="flex items-center gap-2">
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => handleGoStep(step + 1)}
                  data-testid="wiz-next-btn"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  <span>下一步：{STEPS[step + 1].title}</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinish}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>完成构建并进入编辑器</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right Live Preview Column */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">实时成果预览</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg" role="group" aria-label="预览模式">
              <button
                type="button"
                onClick={() => setPreviewTab('graph')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  previewTab === 'graph' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'
                }`}
              >
                <GitBranch className="w-3 h-3" aria-hidden="true" />
                <span>图谱</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('instance')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  previewTab === 'instance' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'
                }`}
              >
                <Database className="w-3 h-3" aria-hidden="true" />
                <span>实例示例</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('turtle')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  previewTab === 'turtle' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600'
                }`}
              >
                <Code2 className="w-3 h-3" aria-hidden="true" />
                <span>Turtle</span>
              </button>
            </div>
          </div>

          {previewTab === 'graph' && (
            <div className="p-2">
              {livePreset.classes.length === 0 ? (
                <div className="h-[440px] flex items-center justify-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                  在第 2 步添加类后，将在此实时渲染动态球体语义图谱
                </div>
              ) : (
                <DynamicSphereGraph
                  classes={livePreset.classes}
                  totalClassCount={livePreset.classes.length}
                  objectProperties={livePreset.objectProperties}
                  prefix={livePreset.prefix}
                  selectedClassId={resolvedPreviewClassId}
                  selectedPropertyId={null}
                  schoolFocus="all"
                  showSchoolFocusTabs={false}
                  onChangeFocus={() => {}}
                  onSelectClass={setSelectedPreviewClassId}
                  onSelectProperty={() => {}}
                />
              )}
            </div>
          )}

          {previewTab === 'instance' && (
            <div className="p-4 space-y-3">
              {livePreset.classes.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  添加类与属性后，可在此查看自动生成的 ABox 实例数据示例
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="wiz-preview-cls" className="text-xs font-medium text-slate-700">
                      查看类实例：
                    </label>
                    <select
                      id="wiz-preview-cls"
                      value={resolvedPreviewClassId}
                      onChange={(e) => setSelectedPreviewClassId(e.target.value)}
                      className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md"
                    >
                      {livePreset.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} ({c.name})
                        </option>
                      ))}
                    </select>
                  </div>
                  {liveExampleInstance && (
                    <div className="bg-slate-950 text-slate-100 rounded-lg p-3.5 space-y-1.5 text-xs font-mono overflow-x-auto">
                      <div className="text-slate-400 text-[11px] pb-1 border-b border-slate-800">
                        {liveExampleInstance.instanceUri}
                      </div>
                      {liveExampleInstance.triples.map((t, idx) => (
                        <div key={`${t.predicate}-${idx}`} className="whitespace-nowrap">
                          <span className="text-blue-300">{t.predicate}</span>{' '}
                          <span className="text-emerald-300">{t.object}</span>{' '}
                          <span className="text-slate-500">
                            {idx === liveExampleInstance.triples.length - 1 ? '.' : ';'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {previewTab === 'turtle' && (
            <div className="p-4">
              <pre className="p-3.5 rounded-lg bg-slate-950 text-slate-100 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[460px] overflow-y-auto">
                {liveTurtle}
              </pre>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
