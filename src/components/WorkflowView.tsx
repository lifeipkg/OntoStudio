import { ArrowRight, CheckCircle2, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { WORKFLOW_STAGES } from '../data/ontologyPresets';

interface CQSandboxCase {
  id: string;
  domain: string;
  question: string;
  requiredClasses: string[];
  criticalAxiomLabel: string;
  criticalAxiomCode: string;
  withoutAxiomRisk: string;
  sparqlSnippet: string;
}

const CQ_SANDBOX_CASES: CQSandboxCase[] = [
  {
    id: 'cq-school-schedule',
    domain: '教务排课与教材',
    question: '如何查询高一年级张伟老师担任班主任的班级中，周二上午物理课对应的学生名单及配发教材 ISBN？',
    requiredClasses: ['Grade', 'Classroom', 'HomeroomTeacher', 'Student', 'CourseSchedule', 'Course', 'Textbook'],
    criticalAxiomLabel: '逆属性推导 + Functional 唯一归属约束',
    criticalAxiomCode: 'edu:enrolledInClass a owl:FunctionalProperty ; owl:inverseOf edu:hasStudent .\nedu:managedByHomeroom a owl:FunctionalProperty .',
    withoutAxiomRisk: '若缺少 Functional 唯一归属约束，同一学生可能被错误写入多个行政班造成教材配发与人数统计重复；缺少 inverseOf 双向推演时，需额外手写反向冗余三元组。',
    sparqlSnippet: `SELECT ?className ?studentName ?isbn WHERE {\n  ?grade edu:gradeLevel 10 .\n  ?class edu:belongsToGrade ?grade ;\n         edu:className ?className ;\n         edu:managedByHomeroom [ edu:fullName "张伟" ] .\n  ?student edu:enrolledInClass ?class ; edu:fullName ?studentName .\n  ?sch edu:scheduleForClass ?class ; edu:scheduledCourse ?course .\n  ?course edu:courseCode "PHY-102" .\n  ?tb edu:textbookIssuedToClass ?class ; edu:textbookForCourse ?course ; edu:isbnCode ?isbn .\n}`,
  },
  {
    id: 'cq-school-assets',
    domain: '班级扫帚与拖把资产',
    question: '若全校大扫除前需核验各班扫帚与拖把配额，哪些班级存在清洁资产编号缺失或超期未消毒？',
    requiredClasses: ['Classroom', 'ClassAsset', 'Broom', 'Mop'],
    criticalAxiomLabel: 'SHACL 资产编码正则校验 + 父类公共属性继承',
    criticalAxiomCode: 'edu:Broom rdfs:subClassOf edu:ClassAsset .\nedu:Mop rdfs:subClassOf edu:ClassAsset .\nsh:pattern "^CLEAN-[0-9]{4}$" .',
    withoutAxiomRisk: '若扫帚与拖把未继承 ClassAsset 的台账数量与完好状态属性，或缺少 SHACL 编码正则门禁，各班损坏资产将无法汇总，导致交叉借用丢失。',
    sparqlSnippet: `SELECT ?className ?assetCode ?status ?days WHERE {\n  ?mop a edu:Mop ; edu:mopOwnedByClass ?cls ;\n       edu:assetCode ?assetCode ; edu:conditionStatus ?status ;\n       edu:sanitizeCycleDays ?days .\n  ?cls edu:className ?className .\n  FILTER(?days > 7 || ?status != "完好")\n}`,
  },
  {
    id: 'cq-school-playground',
    domain: '操场分配与防撞场',
    question: '周三第 3 节「东区田径场」共被安排了几个班级同时使用？是否超出操场片区核定容纳上限？',
    requiredClasses: ['PlaygroundZone', 'PlaygroundAllocation', 'Classroom', 'CourseSchedule'],
    criticalAxiomLabel: 'Functional 单片区锁定 + SHACL maxCount 冲突拦截',
    criticalAxiomCode: 'edu:allocatesPlayground a owl:FunctionalProperty .\nedu:PlaygroundAllocShape sh:maxCount 1 .',
    withoutAxiomRisk: '若单条操场分配记录允许同时挂载多个片区或缺乏时段并发聚合约束，多个年级体育课将在同一跑道发生场地冲突与安全隐患。',
    sparqlSnippet: `SELECT ?zoneName ?maxCap (COUNT(DISTINCT ?cls) AS ?bookedClasses) WHERE {\n  ?zone a edu:PlaygroundZone ; edu:zoneCode "PG-TRACK-EAST" ;\n        edu:maxClassQuota ?maxCap .\n  ?alloc edu:allocatesPlayground ?zone ;\n         edu:playgroundForClass ?cls ;\n         edu:timeSlot "周三第3节" .\n} GROUP BY ?zoneName ?maxCap HAVING (COUNT(DISTINCT ?cls) > ?maxCap)`,
  },
  {
    id: 'cq-school-discipline',
    domain: '教导处·学生会·纪律编排',
    question: '学生会纪检部在午休巡检中登记的扣分记录，如何自动溯源到教导处对应校规条款与责任班主任？',
    requiredClasses: ['AcademicAffairsOffice', 'StudentUnion', 'DisciplineRoster', 'DisciplineRule', 'Classroom', 'HomeroomTeacher'],
    criticalAxiomLabel: '教导处-学生会监督链 + 纪律条款强制关联',
    criticalAxiomCode: 'edu:supervisesUnion a owl:FunctionalProperty .\nedu:RosterRuleShape sh:minCount 1 .',
    withoutAxiomRisk: '若学生会巡检记录未强制关联教导处发布的 DisciplineRule 条款编号，纪律扣分将缺少制度依据，无法准确通报到对应班级与班主任。',
    sparqlSnippet: `SELECT ?className ?teacherName ?ruleCode ?pts WHERE {\n  ?affairs edu:supervisesUnion ?union ; edu:enactsDisciplineRule ?rule .\n  ?union edu:executesDiscipline ?roster .\n  ?roster edu:checkWindow "午休巡检" ; edu:rosterInspectsClass ?cls ; edu:rosterAppliesRule ?rule .\n  ?rule edu:ruleCode ?ruleCode ; edu:maxDeductionPoints ?pts .\n  ?cls edu:className ?className ; edu:managedByHomeroom [ edu:fullName ?teacherName ] .\n}`,
  },
];

interface WorkflowViewProps {
  onStartBuilder?: () => void;
}

export function WorkflowView({ onStartBuilder }: WorkflowViewProps) {
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [selectedCqId, setSelectedCqId] = useState<string>(CQ_SANDBOX_CASES[0].id);
  const [axiomEnabled, setAxiomEnabled] = useState(true);

  const stage = WORKFLOW_STAGES[activeStageIndex];
  const cqCase = CQ_SANDBOX_CASES.find((c) => c.id === selectedCqId) ?? CQ_SANDBOX_CASES[0];

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">本体工程六阶段流水线</h1>
          <span className="text-xs font-mono text-slate-500">Ontology 101 · NeOn · OWL / SHACL</span>
        </div>
        {onStartBuilder && (
          <button
            type="button"
            onClick={onStartBuilder}
            data-testid="workflow-start-builder-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
            <span>启动 0→1 搭建向导</span>
          </button>
        )}
      </section>

      {/* 6-Stage Interactive Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <nav
          aria-label="本体开发六阶段导航"
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden"
        >
          {WORKFLOW_STAGES.map((item, idx) => {
            const isActive = idx === activeStageIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveStageIndex(idx)}
                className={`w-full text-left px-4 py-3.5 transition-colors flex items-start gap-3 ${
                  isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`font-mono text-xs font-bold tabular-nums mt-0.5 ${
                    isActive ? 'text-blue-600' : 'text-slate-400'
                  }`}
                >
                  {item.stepNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-semibold truncate ${
                      isActive ? 'text-blue-700' : 'text-slate-900'
                    }`}
                  >
                    {item.title}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        <article className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <div className="text-xs text-blue-600 font-medium">
                阶段 {stage.stepNumber} · {stage.methodology}
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-1">{stage.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeStageIndex === 0}
                onClick={() => setActiveStageIndex((i) => Math.max(0, i - 1))}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一步
              </button>
              <button
                type="button"
                disabled={activeStageIndex === WORKFLOW_STAGES.length - 1}
                onClick={() => setActiveStageIndex((i) => Math.min(WORKFLOW_STAGES.length - 1, i + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>下一阶段</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <FileText className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span>阶段输入依赖</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {stage.inputs.map((inp) => (
                  <li key={inp} className="flex items-start gap-2">
                    <span className="text-slate-400">·</span>
                    <span>{inp}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>工程交付产物</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {stage.deliverables.map((del) => (
                  <li key={del} className="flex items-start gap-2">
                    <span className="text-emerald-600">·</span>
                    <span>{del}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-slate-200">
                <div className="text-[11px] font-medium text-slate-500 mb-1">能力问题 (CQ)</div>
                <div className="text-slate-800">{stage.exampleCQ}</div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-950 text-slate-100 font-mono">
                <div className="text-[11px] text-slate-400 mb-1 font-sans">公理 / 定义</div>
                {stage.resultingAxiom}
              </div>
              <div className="flex items-start gap-2 text-slate-700">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{stage.validationCheck}</span>
              </div>
            </div>
          </div>
        </article>
      </div>

      {/* Interactive CQ-to-Axiom Sandbox */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900">
            CQ 能力问题 → 公理验证沙盒
          </h2>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
            {CQ_SANDBOX_CASES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedCqId(item.id);
                  setAxiomEnabled(true);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  selectedCqId === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.domain}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-6 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-slate-500">业务能力问题 (Competency Question)</div>
              <p className="text-sm font-semibold text-slate-900">{cqCase.question}</p>
            </div>

            <div className="text-xs text-slate-600">
              涉及核心类：{cqCase.requiredClasses.join(' · ')}
            </div>

            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{cqCase.criticalAxiomLabel}</div>
                  <div className="text-[11px] font-mono text-slate-600 mt-0.5 whitespace-pre-line">
                    {cqCase.criticalAxiomCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAxiomEnabled((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                    axiomEnabled
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                  {axiomEnabled ? '公理已启用' : '已关闭公理'}
                </button>
              </div>

              <div
                className={`p-3 rounded-md text-xs leading-relaxed border ${
                  axiomEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {axiomEnabled
                  ? '状态正常：推理机与查询规划器可完整识别语义路径，返回 100% 召回率与零歧义结果。'
                  : `故障退化：${cqCase.withoutAxiomRisk}`}
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 bg-slate-950 text-slate-100 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>对应自动化验证查询 (SPARQL)</span>
              <span>{axiomEnabled ? '可执行推理闭包' : '退化为局部直连扫描'}</span>
            </div>
            <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
              {cqCase.sparqlSnippet}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
