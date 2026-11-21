import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FilePlus2,
  GitBranch,
  Layers,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  DomainOntologyPreset,
  OntologyClass,
  OntologyDataProperty,
  OntologyLayerId,
  OntologyObjectProperty,
  ReasonerReport,
} from '../types/ontology';
import {
  generateExampleInstanceTriples,
  generateTurtleSerialization,
  getAncestorIds,
  getInheritedDataProperties,
} from '../utils/ontologyEngine';
import { DynamicSphereGraph, type SchoolFocusTab } from './DynamicSphereGraph';

interface OntologyEditorViewProps {
  preset: DomainOntologyPreset;
  onBackToList: () => void;
  onContinueImport?: () => void;
  importFeedback?: string | null;
  onDismissFeedback?: () => void;
  onAddSubclass: (parentId: string, name: string, label: string, description: string, layer: OntologyLayerId) => void;
  onAddDataProperty: (classId: string, prop: Omit<OntologyDataProperty, 'id'>) => void;
  onAddObjectProperty: (prop: Omit<OntologyObjectProperty, 'id'>) => void;
  reasonerReport: ReasonerReport | null;
  onRunReasoner: () => void;
}

type EditorSubMode = 'workbench' | 'architecture' | 'turtle';

const LAYER_META: Record<OntologyLayerId, { title: string; short: string; desc: string }> = {
  upper: {
    title: 'L1 顶层与基础本体层 (Upper Ontology)',
    short: '顶层抽象',
    desc: '对齐 BFO / FIBO / Schema.org 等通用世界观，统一时间、空间、主体与事件语义，避免跨部门鸡同鸭讲。',
  },
  domain: {
    title: 'L2 领域核心概念层 (Domain TBox)',
    short: '领域核心',
    desc: '刻画行业核心类继承体系 (rdfs:subClassOf)、互斥公理 (owl:disjointWith) 与对象属性域值约束。',
  },
  constraint: {
    title: 'L3 推理与 SHACL 约束层 (Axioms & Shapes)',
    short: '推理约束',
    desc: '分离「开放世界逻辑推理 (OWL 2 EL/RL)」与「闭世界入库质检 (SHACL)」，支撑衍生分类与基数校验。',
  },
  instance: {
    title: 'L4 亿级实例与事件层 (ABox & Streams)',
    short: '实例事件',
    desc: '承载千万至十亿级高频业务流水节点，依靠整数字典编码与属性索引实现低延迟图遍历。',
  },
};

const SCHOOL_SUBGRAPH_COORDS: Record<
  'assets' | 'schedule' | 'governance',
  Record<string, { x: number; y: number }>
> = {
  assets: {
    'edu-entity': { x: 260, y: 18 },
    'edu-asset': { x: 500, y: 18 },
    'edu-course': { x: 260, y: 138 },
    'edu-textbook': { x: 500, y: 128 },
    'edu-class': { x: 20, y: 232 },
    'edu-broom': { x: 500, y: 232 },
    'edu-mop': { x: 500, y: 342 },
  },
  schedule: {
    'edu-grade': { x: 16, y: 16 },
    'edu-homeroom': { x: 176, y: 16 },
    'edu-entity': { x: 420, y: 16 },
    'edu-class': { x: 16, y: 146 },
    'edu-teacher': { x: 176, y: 146 },
    'edu-course': { x: 340, y: 146 },
    'edu-playground': { x: 504, y: 146 },
    'edu-teacher-arr': { x: 80, y: 326 },
    'edu-course-sch': { x: 264, y: 326 },
    'edu-pg-alloc': { x: 456, y: 326 },
  },
  governance: {
    'edu-org': { x: 16, y: 14 },
    'edu-entity': { x: 260, y: 14 },
    'edu-person': { x: 496, y: 14 },
    'edu-affairs': { x: 16, y: 108 },
    'edu-student': { x: 340, y: 108 },
    'edu-homeroom': { x: 504, y: 108 },
    'edu-disc-rule': { x: 16, y: 222 },
    'edu-union': { x: 176, y: 222 },
    'edu-class': { x: 340, y: 222 },
    'edu-teacher': { x: 504, y: 222 },
    'edu-disc-roster': { x: 260, y: 354 },
  },
};

export function OntologyEditorView({
  preset,
  onBackToList,
  onContinueImport,
  importFeedback,
  onDismissFeedback,
  onAddSubclass,
  onAddDataProperty,
  onAddObjectProperty,
  reasonerReport,
  onRunReasoner,
}: OntologyEditorViewProps) {
  const [subMode, setSubMode] = useState<EditorSubMode>('workbench');
  const [selectedClassId, setSelectedClassId] = useState<string>(
    () =>
      preset.classes.find((c) => c.id === 'edu-class')?.id ??
      preset.classes[2]?.id ??
      preset.classes[0].id,
  );
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [schoolFocus, setSchoolFocus] = useState<SchoolFocusTab>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [activeLayerFocus, setActiveLayerFocus] = useState<OntologyLayerId>('domain');

  // Add subclass form state
  const [showAddClassForm, setShowAddClassForm] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassLabel, setNewClassLabel] = useState('');
  const [newClassDesc, setNewClassDesc] = useState('');
  const [newClassLayer, setNewClassLayer] = useState<OntologyLayerId>('domain');
  const [formError, setFormError] = useState('');

  // Add data property form state
  const [showAddPropForm, setShowAddPropForm] = useState(false);
  const [newPropName, setNewPropName] = useState('');
  const [newPropLabel, setNewPropLabel] = useState('');
  const [newPropType, setNewPropType] = useState<OntologyDataProperty['datatype']>('xsd:string');
  const [newPropIndexed, setNewPropIndexed] = useState(true);

  // Add object property form state
  const [showAddRelForm, setShowAddRelForm] = useState(false);
  const [newRelName, setNewRelName] = useState('');
  const [newRelLabel, setNewRelLabel] = useState('');
  const [newRelRangeId, setNewRelRangeId] = useState<string>(preset.classes[1]?.id ?? preset.classes[0].id);
  const [newRelCard, setNewRelCard] = useState<OntologyObjectProperty['cardinality']>('1..*');
  const [newRelFunctional, setNewRelFunctional] = useState(false);

  const selectedClass = useMemo(() => {
    return preset.classes.find((c) => c.id === selectedClassId) ?? preset.classes[0];
  }, [preset.classes, selectedClassId]);

  const exampleInstance = useMemo(
    () => generateExampleInstanceTriples(selectedClass.id, preset),
    [selectedClass.id, preset],
  );

  const inheritedProps = useMemo(
    () => getInheritedDataProperties(selectedClass.id, preset.classes),
    [selectedClass.id, preset.classes],
  );

  const relatedObjectProps = useMemo(
    () =>
      preset.objectProperties.filter(
        (op) => op.domainId === selectedClass.id || op.rangeId === selectedClass.id,
      ),
    [preset.objectProperties, selectedClass.id],
  );

  const classShaclRules = useMemo(
    () => preset.shaclRules.filter((r) => r.targetClassId === selectedClass.id),
    [preset.shaclRules, selectedClass.id],
  );

  const turtleText = useMemo(() => generateTurtleSerialization(preset), [preset]);

  const classMap = useMemo(() => new Map(preset.classes.map((c) => [c.id, c])), [preset.classes]);

  // Build hierarchical tree children lookup
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, OntologyClass[]>();
    for (const cls of preset.classes) {
      const list = map.get(cls.parentId) ?? [];
      list.push(cls);
      map.set(cls.parentId, list);
    }
    return map;
  }, [preset.classes]);

  const filteredClassIds = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return null;
    const matched = new Set<string>();
    for (const c of preset.classes) {
      if (c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)) {
        matched.add(c.id);
        const { ancestors } = getAncestorIds(c.id, preset.classes);
        ancestors.forEach((id) => matched.add(id));
      }
    }
    return matched;
  }, [preset.classes, searchTerm]);

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateSubclass = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newClassName.trim().replace(/\s+/g, '');
    const cleanLabel = newClassLabel.trim();
    if (!cleanName || !/^[A-Za-z][A-Za-z0-9_]*$/.test(cleanName)) {
      setFormError('请输入合法的英文类名（如 HighRiskPatient，仅限字母数字）。');
      return;
    }
    if (!cleanLabel) {
      setFormError('请输入中文概念名称。');
      return;
    }
    if (preset.classes.some((c) => c.name.toLowerCase() === cleanName.toLowerCase())) {
      setFormError(`类名 ${cleanName} 已存在于当前本体中。`);
      return;
    }

    onAddSubclass(
      selectedClass.id,
      cleanName,
      cleanLabel,
      newClassDesc.trim() || `${selectedClass.label}的业务细分扩展子类。`,
      newClassLayer,
    );
    setNewClassName('');
    setNewClassLabel('');
    setNewClassDesc('');
    setFormError('');
    setShowAddClassForm(false);
  };

  const handleCreateProp = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newPropName.trim().replace(/\s+/g, '');
    const cleanLabel = newPropLabel.trim();
    if (!cleanName || !cleanLabel) return;
    onAddDataProperty(selectedClass.id, {
      name: cleanName,
      label: cleanLabel,
      datatype: newPropType,
      indexed: newPropIndexed,
      required: false,
    });
    setNewPropName('');
    setNewPropLabel('');
    setShowAddPropForm(false);
  };

  const handleCreateRel = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newRelName.trim().replace(/\s+/g, '');
    const cleanLabel = newRelLabel.trim();
    if (!cleanName || !cleanLabel || !newRelRangeId) return;
    onAddObjectProperty({
      name: cleanName,
      label: cleanLabel,
      domainId: selectedClass.id,
      rangeId: newRelRangeId,
      cardinality: newRelCard,
      functional: newRelFunctional,
    });
    setNewRelName('');
    setNewRelLabel('');
    setNewRelFunctional(false);
    setShowAddRelForm(false);
  };

  const renderTree = (parentId: string | null, depth = 0) => {
    const nodes = childrenByParent.get(parentId) ?? [];
    return nodes.map((node) => {
      if (filteredClassIds && !filteredClassIds.has(node.id)) {
        return null;
      }
      const children = childrenByParent.get(node.id) ?? [];
      const hasChildren = children.length > 0;
      const isCollapsed = Boolean(collapsedNodes[node.id]);
      const isSelected = selectedClass.id === node.id;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-xs transition-colors ${
              isSelected
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapse(node.id)}
                aria-label={`${isCollapsed ? '展开' : '折叠'} ${node.label}`}
                className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4 inline-block shrink-0" />
            )}

            <button
              type="button"
              onClick={() => setSelectedClassId(node.id)}
              className="flex-1 text-left truncate flex items-center justify-between gap-2 py-0.5"
            >
              <span className="truncate">{node.label}</span>
              <span className="font-mono text-[11px] text-slate-400 shrink-0">{node.name}</span>
            </button>
          </div>
          {hasChildren && !isCollapsed && <div>{renderTree(node.id, depth + 1)}</div>}
        </div>
      );
    });
  };

  const visibleClasses = useMemo(() => {
    if (schoolFocus === 'all') {
      return preset.classes;
    }
    const focusSets: Record<'assets' | 'schedule' | 'governance', Set<string>> = {
      assets: new Set([
        'edu-entity',
        'edu-asset',
        'edu-class',
        'edu-course',
        'edu-textbook',
        'edu-broom',
        'edu-mop',
      ]),
      schedule: new Set([
        'edu-entity',
        'edu-grade',
        'edu-class',
        'edu-teacher',
        'edu-homeroom',
        'edu-course',
        'edu-playground',
        'edu-teacher-arr',
        'edu-course-sch',
        'edu-pg-alloc',
      ]),
      governance: new Set([
        'edu-entity',
        'edu-org',
        'edu-affairs',
        'edu-union',
        'edu-person',
        'edu-student',
        'edu-teacher',
        'edu-homeroom',
        'edu-class',
        'edu-disc-rule',
        'edu-disc-roster',
      ]),
    };
    const allowed = focusSets[schoolFocus];
    const subgraphCoords = SCHOOL_SUBGRAPH_COORDS[schoolFocus];
    return preset.classes
      .filter((c) => allowed.has(c.id) || c.id.startsWith('custom-'))
      .map((c) => {
        const override = subgraphCoords[c.id];
        return override ? { ...c, x: override.x, y: override.y } : c;
      });
  }, [preset.classes, schoolFocus]);

  return (
    <div className="space-y-5">
      {/* Workspace Header & Controls (below global TopBar) */}
      <section className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start sm:items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>本体列表</span>
          </button>
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">{preset.prefix}:{preset.namespace}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{preset.classes.length} 个类 / {preset.objectProperties.length} 条关系</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 text-balance truncate">
              {preset.name}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Editor Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="视图模式">
            <button
              type="button"
              onClick={() => setSubMode('workbench')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                subMode === 'workbench'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
              <span>可视化编辑器</span>
            </button>
            <button
              type="button"
              onClick={() => setSubMode('architecture')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                subMode === 'architecture'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>四层本体架构</span>
            </button>
            <button
              type="button"
              onClick={() => setSubMode('turtle')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                subMode === 'turtle'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>OWL / Turtle</span>
            </button>
          </div>

          {onContinueImport && (
            <button
              type="button"
              onClick={onContinueImport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>继续导入 .ttl</span>
            </button>
          )}

          {/* Reasoner Action */}
          <button
            type="button"
            onClick={onRunReasoner}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>运行推理机</span>
          </button>
        </div>
      </section>

      {importFeedback && (
        <div
          className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 text-xs text-emerald-900 flex items-center justify-between gap-3"
          data-testid="detail-import-feedback-banner"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span className="font-mono truncate">{importFeedback}</span>
          </div>
          {onDismissFeedback && (
            <button
              type="button"
              onClick={onDismissFeedback}
              aria-label="关闭导入提示"
              className="p-1 text-emerald-700 hover:text-emerald-950 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Sub-mode 1: Live Interactive Ontology Workbench */}
      {subMode === 'workbench' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Pane: Class Hierarchy Tree + Object Properties */}
          <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">类层次结构 (Taxonomy)</h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddClassForm((v) => !v);
                  setFormError('');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>新增子类</span>
              </button>
            </div>

            <div className="p-3 border-b border-slate-100">
              <label htmlFor="class-search" className="sr-only">
                搜索类或 URI
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  id="class-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="筛选类名称或英文标识符..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>
            </div>

            {showAddClassForm && (
              <form onSubmit={handleCreateSubclass} className="p-3.5 bg-slate-50 border-b border-slate-200 space-y-2.5">
                <div className="text-xs font-semibold text-slate-800">
                  在「{selectedClass.label}」下新建子类
                </div>
                <div>
                  <label htmlFor="new-class-name" className="block text-[11px] text-slate-600 mb-1">
                    英文标识符 (URI Name)
                  </label>
                  <input
                    id="new-class-name"
                    type="text"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    placeholder="如 ChronicPatient"
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="new-class-label" className="block text-[11px] text-slate-600 mb-1">
                    中文业务标签
                  </label>
                  <input
                    id="new-class-label"
                    type="text"
                    value={newClassLabel}
                    onChange={(e) => setNewClassLabel(e.target.value)}
                    placeholder="如 慢病随访患者"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="new-class-layer" className="block text-[11px] text-slate-600 mb-1">
                    所属架构层
                  </label>
                  <select
                    id="new-class-layer"
                    value={newClassLayer}
                    onChange={(e) => setNewClassLayer(e.target.value as OntologyLayerId)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="domain">L2 领域核心层</option>
                    <option value="constraint">L3 推理约束层</option>
                    <option value="instance">L4 实例事件层</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="new-class-desc" className="block text-[11px] text-slate-600 mb-1">
                    语义定义 (选填)
                  </label>
                  <input
                    id="new-class-desc"
                    type="text"
                    value={newClassDesc}
                    onChange={(e) => setNewClassDesc(e.target.value)}
                    placeholder="简述语义边界..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                {formError && <p className="text-[11px] text-red-600">{formError}</p>}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddClassForm(false);
                      setFormError('');
                    }}
                    className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                  >
                    确认添加
                  </button>
                </div>
              </form>
            )}

            <div className="p-2.5 max-h-[340px] overflow-y-auto space-y-0.5">
              <div className="px-2 py-1 text-[11px] font-mono text-slate-400">owl:Thing</div>
              {renderTree(null, 0)}
            </div>

            <div className="border-t border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">
                  对象属性公理 ({preset.objectProperties.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddRelForm((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>新增关系</span>
                </button>
              </div>

              {showAddRelForm && (
                <form onSubmit={handleCreateRel} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="text-[11px] font-semibold text-slate-800">
                    从「{selectedClass.label}」出发新建关系
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      aria-label="关系英文名"
                      value={newRelName}
                      onChange={(e) => setNewRelName(e.target.value)}
                      placeholder="如 classMonitor"
                      className="px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                    />
                    <input
                      type="text"
                      required
                      aria-label="关系中文名称"
                      value={newRelLabel}
                      onChange={(e) => setNewRelLabel(e.target.value)}
                      placeholder="如 班长"
                      className="px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="目标值域类"
                      value={newRelRangeId}
                      onChange={(e) => setNewRelRangeId(e.target.value)}
                      className="px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                    >
                      {preset.classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          → {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="基数约束"
                      value={newRelCard}
                      onChange={(e) => setNewRelCard(e.target.value as OntologyObjectProperty['cardinality'])}
                      className="px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                    >
                      <option value="1..1">1..1 (唯一)</option>
                      <option value="0..1">0..1 (可选唯一)</option>
                      <option value="1..*">1..* (一对多)</option>
                      <option value="0..*">0..* (多对多)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between pt-0.5">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={newRelFunctional}
                        onChange={(e) => setNewRelFunctional(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>Functional (单值唯一)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddRelForm(false)}
                        className="text-xs text-slate-600"
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 rounded"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </form>
              )}

              <ul className="space-y-1 max-h-[210px] overflow-y-auto">
                {preset.objectProperties.map((op) => {
                  const from = classMap.get(op.domainId);
                  const to = classMap.get(op.rangeId);
                  const isPropActive = selectedPropertyId === op.id;
                  return (
                    <li key={op.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPropertyId(isPropActive ? null : op.id);
                          setSelectedClassId(op.domainId);
                        }}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors flex flex-col gap-0.5 ${
                          isPropActive ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-800">{op.label}</span>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {op.cardinality}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          {from?.name} → {to?.name}
                          {op.transitive ? ' · Transitive' : ''}
                          {op.functional ? ' · Functional' : ''}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          {/* Center Stage: Dynamic Spherical Graph Canvas + Reasoner Status */}
          <div className="lg:col-span-6 space-y-4">
            <DynamicSphereGraph
              classes={visibleClasses}
              totalClassCount={preset.classes.length}
              objectProperties={preset.objectProperties}
              prefix={preset.prefix}
              selectedClassId={selectedClass.id}
              selectedPropertyId={selectedPropertyId}
              schoolFocus={schoolFocus}
              showSchoolFocusTabs={preset.key === 'school'}
              onChangeFocus={(tab, defaultClass) => {
                setSchoolFocus(tab);
                setSelectedPropertyId(null);
                if (defaultClass) {
                  setSelectedClassId(defaultClass);
                }
              }}
              onSelectClass={setSelectedClassId}
              onSelectProperty={setSelectedPropertyId}
            />

            {/* Live Reasoner Output Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    实时推理与一致性校验 (Reasoner)
                  </h3>
                </div>
                {reasonerReport && (
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {reasonerReport.profile} · {reasonerReport.executionTimeMs} ms
                  </span>
                )}
              </div>

              {!reasonerReport ? (
                <div className="text-xs text-slate-600 flex items-center justify-between gap-4 py-1">
                  <span>未运行校验</span>
                  <button
                    type="button"
                    onClick={onRunReasoner}
                    className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0"
                  >
                    立即校验
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5" data-testid="reasoner-report">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    {reasonerReport.consistent ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                        <span className="text-emerald-700">
                          逻辑一致 (Consistent) · 已验证 {reasonerReport.checkedClasses} 个类与 {reasonerReport.checkedProperties} 条对象属性
                        </span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                        <span className="text-red-700">
                          发现逻辑冲突 (Inconsistent) · 请修正以下公理错误
                        </span>
                      </>
                    )}
                  </div>

                  {reasonerReport.issues.length > 0 && (
                    <ul className="space-y-1.5">
                      {reasonerReport.issues.map((issue) => (
                        <li
                          key={issue.id}
                          className={`text-xs px-3 py-2 rounded-lg border flex items-start gap-2 ${
                            issue.severity === 'error'
                              ? 'bg-red-50/70 border-red-200 text-red-800'
                              : 'bg-amber-50/70 border-amber-200 text-amber-800'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {reasonerReport.inferredAxioms.length > 0 && (
                    <div className="border-t border-slate-100 pt-2.5">
                      <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                        推理机推导出的隐含公理 ({reasonerReport.inferredAxioms.length})
                      </div>
                      <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                        {reasonerReport.inferredAxioms.map((inf) => (
                          <li key={inf.id} className="text-xs text-slate-700 flex flex-col">
                            <span className="font-medium text-slate-900">
                              {inf.subjectLabel} · <span className="font-mono text-[11px] text-blue-700">{inf.rule}</span>
                            </span>
                            <span className="text-[11px] text-slate-600">{inf.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Inspector: Selected Class Details, Properties, SHACL */}
          <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            <div className="border-b border-slate-100 pb-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{LAYER_META[selectedClass.layer].short}</span>
                <span className="font-mono tabular-nums">
                  预估实例: {selectedClass.estimatedInstances.toLocaleString('zh-CN')}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900">{selectedClass.label}</h2>
              <div className="text-xs font-mono text-blue-700 break-all">
                {preset.prefix}:{selectedClass.name}
              </div>
              {selectedClass.disjointWith && selectedClass.disjointWith.length > 0 && (
                <div className="text-[11px] text-slate-500 pt-1">
                  互斥声明 (owl:disjointWith):{' '}
                  <span className="font-mono text-slate-700">
                    {selectedClass.disjointWith
                      .map((id) => classMap.get(id)?.name ?? id)
                      .join(', ')}
                  </span>
                </div>
              )}
            </div>

            {/* Data Properties (Own + Inherited) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">
                  数据属性 (Data Properties)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddPropForm((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>添加属性</span>
                </button>
              </div>

              {showAddPropForm && (
                <form onSubmit={handleCreateProp} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="prop-name" className="block text-[11px] text-slate-600 mb-1">
                        英文属性名
                      </label>
                      <input
                        id="prop-name"
                        type="text"
                        required
                        value={newPropName}
                        onChange={(e) => setNewPropName(e.target.value)}
                        placeholder="riskTier"
                        className="w-full px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <label htmlFor="prop-label" className="block text-[11px] text-slate-600 mb-1">
                        中文标签
                      </label>
                      <input
                        id="prop-label"
                        type="text"
                        required
                        value={newPropLabel}
                        onChange={(e) => setNewPropLabel(e.target.value)}
                        placeholder="风险等级"
                        className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <select
                      aria-label="属性数据类型"
                      value={newPropType}
                      onChange={(e) => setNewPropType(e.target.value as OntologyDataProperty['datatype'])}
                      className="px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded"
                    >
                      <option value="xsd:string">xsd:string</option>
                      <option value="xsd:integer">xsd:integer</option>
                      <option value="xsd:decimal">xsd:decimal</option>
                      <option value="xsd:dateTime">xsd:dateTime</option>
                      <option value="xsd:boolean">xsd:boolean</option>
                    </select>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={newPropIndexed}
                        onChange={(e) => setNewPropIndexed(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>建查询索引</span>
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddPropForm(false)}
                      className="px-2 py-1 text-xs text-slate-600"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 rounded"
                    >
                      保存属性
                    </button>
                  </div>
                </form>
              )}

              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {selectedClass.dataProperties.length === 0 && inheritedProps.length === 0 && (
                  <div className="px-3 py-3 text-xs text-slate-500">暂无数据属性定义</div>
                )}
                {selectedClass.dataProperties.map((prop) => (
                  <div key={prop.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="font-medium text-slate-900">{prop.label}</div>
                      <div className="font-mono text-[11px] text-slate-500">{prop.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[11px] text-slate-700">{prop.datatype}</div>
                      <div className="text-[11px] text-slate-500">
                        {prop.indexed ? '已建索引' : '未索引'}
                        {prop.required ? ' · 必填' : ''}
                      </div>
                    </div>
                  </div>
                ))}
                {inheritedProps.map((prop) => (
                  <div
                    key={`inh-${prop.id}`}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-xs bg-slate-50/70"
                  >
                    <div>
                      <div className="font-medium text-slate-700">{prop.label}</div>
                      <div className="text-[11px] text-slate-500">
                        继承自 {prop.inheritedFrom} · <span className="font-mono">{prop.name}</span>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">{prop.datatype}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Object Relationships touching this class */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                关联对象属性 ({relatedObjectProps.length})
              </h3>
              {relatedObjectProps.length === 0 ? (
                <p className="text-xs text-slate-500">当前类暂无直接关联的对象属性。</p>
              ) : (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {relatedObjectProps.map((op) => {
                    const isOutgoing = op.domainId === selectedClass.id;
                    const peer = classMap.get(isOutgoing ? op.rangeId : op.domainId);
                    return (
                      <div key={op.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-slate-800">
                            {isOutgoing ? '出向' : '入向'} · {op.label} ({op.name})
                          </div>
                          <div className="text-[11px] text-slate-500">
                            目标类: {peer?.label ?? '-'}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-600 tabular-nums shrink-0">
                          {op.cardinality}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SHACL Validation Shapes */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-900">
                SHACL 入库约束规则 ({classShaclRules.length})
              </h3>
              {classShaclRules.length === 0 ? (
                <p className="text-xs text-slate-500">无额外 NodeShape</p>
              ) : (
                <ul className="space-y-2">
                  {classShaclRules.map((rule) => (
                    <li
                      key={rule.id}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between gap-2"
                    >
                      <span className="font-mono font-medium text-slate-900">
                        sh:{rule.constraintType} ({rule.propertyName}) = {rule.value}
                      </span>
                      <span
                        className={`text-[11px] font-medium shrink-0 ${
                          rule.severity === 'Violation' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {rule.severity === 'Violation' ? 'Violation' : 'Warning'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Concrete ABox Instance Triple Example */}
            <div className="border-t border-slate-100 pt-4 space-y-2" data-testid="instance-triple-preview">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-900">
                  ABox 实例三元组
                </h3>
                <span className="font-mono text-[11px] text-blue-700 truncate">
                  {exampleInstance.instanceUri}
                </span>
              </div>
              <div className="bg-slate-950 text-slate-100 rounded-lg p-3 space-y-1 text-[11px] font-mono overflow-x-auto">
                {exampleInstance.triples.map((t, i) => (
                  <div key={`${t.predicate}-${i}`} className="whitespace-nowrap">
                    <span className="text-blue-300">{t.predicate}</span>{' '}
                    <span className="text-emerald-300">{t.object}</span>{' '}
                    <span className="text-slate-400">
                      {i === exampleInstance.triples.length - 1 ? '.' : ';'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Sub-mode 2: Ontology 4-Layer Architecture Explorer */}
      {subMode === 'architecture' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 space-y-3">
            {(['upper', 'domain', 'constraint', 'instance'] as OntologyLayerId[]).map((layerId) => {
              const meta = LAYER_META[layerId];
              const count = preset.classes.filter((c) => c.layer === layerId).length;
              const isSelected = activeLayerFocus === layerId;
              return (
                <button
                  key={layerId}
                  type="button"
                  onClick={() => setActiveLayerFocus(layerId)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-white border-blue-600 ring-2 ring-blue-600/15'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                    <span>{meta.short}</span>
                    <span className="font-mono tabular-nums">{count} 个类</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{meta.title}</div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {LAYER_META[activeLayerFocus].title}
              </h2>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-900">
                映射实体类 ({preset.classes.filter((c) => c.layer === activeLayerFocus).length})
              </h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {preset.classes.filter((c) => c.layer === activeLayerFocus).length === 0 ? (
                  <div className="p-4 text-xs text-slate-500">暂无节点</div>
                ) : (
                  preset.classes
                    .filter((c) => c.layer === activeLayerFocus)
                    .map((cls) => (
                      <div key={cls.id} className="p-3.5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-semibold text-slate-900">{cls.label}</span>
                          <span className="font-mono text-xs text-slate-500">
                            {preset.prefix}:{cls.name}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            · {cls.estimatedInstances.toLocaleString('zh-CN')} 实例
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClassId(cls.id);
                            setSubMode('workbench');
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0"
                        >
                          画布定位
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-mode 3: Live Turtle / OWL Source View */}
      {subMode === 'turtle' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-900">Turtle (.ttl) 序列化源码</h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {turtleText.split('\n').length} 行
            </span>
          </div>
          <div className="p-5 bg-slate-950 text-slate-100 overflow-x-auto max-h-[540px] overflow-y-auto">
            <pre className="text-xs font-mono leading-relaxed">{turtleText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
