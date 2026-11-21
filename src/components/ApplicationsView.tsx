import { CheckCircle2, Database, Layers3, Network, ShieldAlert, Zap } from 'lucide-react';
import { useState } from 'react';
import { APPLICATION_MANIFESTATIONS } from '../data/ontologyPresets';

type AppTab = 'digital-twin' | 'graphrag' | 'obda';

interface GraphRagCase {
  id: string;
  question: string;
  naiveAnswer: string;
  naiveIssues: string[];
  ontoCypher: string;
  ontoEvidencePath: string[];
  ontoAnswer: string;
}

const GRAPHRAG_CASES: GraphRagCase[] = [
  {
    id: 'rag-school-playground',
    question: '排查周二第 3 节高一(3)班的操场分配片区是否与其它班级冲突，并列出该时段体育授课教师与教导处审批规则。',
    naiveAnswer:
      '根据校园管理文档，高一年级每周安排两节体育课并在田径场开展，若遇到多班同时使用操场需由体育组和教导处协调场地。',
    naiveIssues: [
      '纯文本切片割裂了“行政班级 ← 操场分配计划 → 操场分区 ← 容纳班额上限”多跳结构',
      '无法实时比对同一 timeSlot 下的并发占用班级数量与 maxClassQuota 阈值',
    ],
    ontoCypher: `MATCH (c:Classroom {classCode: "G1-C03"})<-[:playgroundForClass]-(pa:PlaygroundAllocation)-[:allocatesPlayground]->(z:PlaygroundZone)\nWHERE pa.timeSlot = "周二第3节"\nMATCH (other:PlaygroundAllocation {timeSlot: pa.timeSlot})-[:allocatesPlayground]->(z)\nOPTIONAL MATCH (ta:TeacherAssignment)-[:assignmentInClass]->(c)\nRETURN z.zoneCode, z.maxClassQuota, count(DISTINCT other) AS activeClasses, collect(DISTINCT ta.assignmentId)`,
    ontoEvidencePath: [
      'Classroom(高一(3)班 / G1-C03) ← playgroundForClass ← PlaygroundAllocation(PA-TUE-03)',
      'PlaygroundAllocation(PA-TUE-03) -[allocatesPlayground]-> PlaygroundZone(东区400米田径场 / maxClassQuota: 3)',
      'TeacherAssignment(TA-2026-108) -[assignedTeacher]-> Teacher(李教练 · 体育护导)',
    ],
    ontoAnswer:
      '定位到「东区400米田径场 (PG-TRACK-EAST)」当前周二第3节实排 2 个班（高一(3)班、高一(5)班），低于上限 3 班无撞场，并同步关联体育授课教师与教材清单。',
  },
  {
    id: 'rag-school-discipline',
    question: '汇总过去一周高一年级各班扫帚/拖把完好率低于 80% 且在学生会卫生纪律巡检中被扣分的班级与责任班主任。',
    naiveAnswer:
      '学校学生会定期检查各班卫生角，扫帚和拖把由总务及教导处配发，如有损坏可向班主任申请补充。',
    naiveIssues: [
      '纯向量检索无法关联“班级资产台账 (Broom/Mop)”与“学生会纪律编排表 (DisciplineRoster)”两张异构业务实体表',
      '缺少 DisciplineRule 与 Classroom 的语义路径，无法精准输出责任班主任姓名与扣分条款',
    ],
    ontoCypher: `MATCH (affairs:AcademicAffairsOffice)-[:supervisesUnion]->(u:StudentUnion)-[:executesDiscipline]->(r:DisciplineRoster)-[:rosterInspectsClass]->(c:Classroom)\nMATCH (r)-[:rosterAppliesRule]->(rule:DisciplineRule)\nMATCH (c)<-[:broomOwnedByClass|mopOwnedByClass]-(asset:ClassAsset)\nMATCH (c)-[:managedByHomeroom]->(ht:HomeroomTeacher)\nWHERE asset.conditionStatus <> "完好"\nRETURN c.className, ht.fullName, rule.ruleCode, count(asset) AS brokenAssets`,
    ontoEvidencePath: [
      'AcademicAffairsOffice(教导处) -[supervisesUnion]-> StudentUnion(校学生会纪检部)',
      'DisciplineRoster(DR-W09-NOON) -[rosterAppliesRule]-> DisciplineRule(校规 DR-104 · 卫生角洁具定置)',
      'Broom(CLEAN-1031 / 刷毛磨损) -[broomOwnedByClass]-> Classroom(高一(3)班) -[managedByHomeroom]-> HomeroomTeacher(张伟)',
    ],
    ontoAnswer:
      '精准锁定 1 个异常班级「高一(3)班」（班主任：张伟），涉及教室软毛扫帚 CLEAN-1031 损坏与校规 DR-104 扣 1.5 分记录，已联动生成补发单。',
  },
];

export function ApplicationsView() {
  const [activeTab, setActiveTab] = useState<AppTab>('digital-twin');
  const [selectedObjectId, setSelectedObjectId] = useState<'classroom' | 'asset' | 'discipline'>('classroom');
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [ragCaseId, setRagCaseId] = useState<string>(GRAPHRAG_CASES[0].id);
  const [ragMode, setRagMode] = useState<'compare' | 'onto'>('compare');
  const [obdaTable, setObdaTable] = useState<'edu_timetable' | 'campus_assets' | 'union_discipline'>('edu_timetable');

  const currentRag = GRAPHRAG_CASES.find((c) => c.id === ragCaseId) ?? GRAPHRAG_CASES[0];

  const objectProfiles = {
    classroom: {
      title: '高一 (3) 班 · 行政班级中枢',
      classUri: 'edu:Classroom',
      attributes: [
        { k: '班级编号', v: 'G1-C03' },
        { k: '固定教室', v: '笃行楼 302 室' },
        { k: '责任班主任', v: '张伟 (高级教师)' },
        { k: '配发洁具/教材', v: '扫帚5 · 拖把4 · 教材480册' },
      ],
      links: [
        '课表排班 → 周二第3节 物理实验 (TeacherAssignment: 李明)',
        '操场配额 → 周二第6节 东区400米田径场 (PlaygroundAllocation)',
        '纪律巡检 → 学生会卫生组每日午休例行核查 (DisciplineRoster)',
      ],
      actionLabel: '一键核验班级物资与课表冲突 (ActionType)',
      actionResult: '已遍历 edu:Classroom 关联子图：高一(3)班扫帚/拖把台账齐备，周二全天上学课表与操场片区占用均零冲突。',
    },
    asset: {
      title: '教室软毛扫帚 · CLEAN-1031',
      classUri: 'edu:Broom',
      attributes: [
        { k: '资产台账码', v: 'CLEAN-1031' },
        { k: '配属数量', v: '5 把 (含包干区竹扫帚)' },
        { k: '存放卫生角', v: '笃行楼 302 后门左角' },
        { k: 'SHACL 质检', v: 'Pass · 编码规范合规' },
      ],
      links: [
        '配属班级 → 高一 (3) 班 (edu:broomOwnedByClass)',
        '关联校规 → DR-104 卫生角洁具定点定量摆放准则',
      ],
      actionLabel: '发起班级损毁扫帚换新申请 (ActionType)',
      actionResult: '已依据本体 LinkType 自动通知高一(3)班班主任张伟与总务处仓库，生成 2 把软毛扫帚领用工单。',
    },
    discipline: {
      title: '午休纪律与卫生联合编排 · DR-W09',
      classUri: 'edu:DisciplineRoster',
      attributes: [
        { k: '编排单号', v: 'DR-W09-NOON' },
        { k: '执勤时段', v: '每日 12:30 - 13:20' },
        { k: '检查组织', v: '学生会纪检部 + 护导教师' },
        { k: '挂钩校规', v: 'DR-101 ~ DR-108 (教导处)' },
      ],
      links: [
        '上级监管 → 教导处 (edu:supervisesUnion)',
        '巡检覆盖 → 高一年级 12 个行政班及对应班主任',
      ],
      actionLabel: '重新生成下周学生会与教师护导排班 (ActionType)',
      actionResult: '已结合 TeacherAssignment 避让高一(3)班任课高峰时段，自动生成无冲突的教导处-学生会联合巡检表。',
    },
  }[selectedObjectId];

  const obdaMappings = {
    edu_timetable: {
      source: '教务处 SQL Server · T_COURSE_SCHEDULE 表',
      targetClass: 'edu:CourseSchedule',
      r2rml: `<#ScheduleMapping> a rr:TriplesMap ;\n  rr:logicalTable [ rr:tableName "T_COURSE_SCHEDULE" ] ;\n  rr:subjectMap [\n    rr:template "https://onto.edukg.org/id/schedule/{SCH_ID}" ;\n    rr:class edu:CourseSchedule\n  ] ;\n  rr:predicateObjectMap [\n    rr:predicate edu:scheduleForClass ;\n    rr:objectMap [ rr:template "https://onto.edukg.org/id/class/{CLASS_CODE}" ]\n  ] .`,
      pushedSql: `SELECT sch_id, class_code, course_code, weekday_slot\nFROM T_COURSE_SCHEDULE\nWHERE term_code = '2026-FALL' AND class_code = 'G1-C03';`,
    },
    campus_assets: {
      source: '校园总务 MySQL · t_class_assets_ledger 表',
      targetClass: 'edu:Broom / edu:Mop / edu:Textbook',
      r2rml: `<#AssetLedgerMapping> a rr:TriplesMap ;\n  rr:logicalTable [ rr:tableName "t_class_assets_ledger" ] ;\n  rr:subjectMap [\n    rr:template "https://onto.edukg.org/id/asset/{ASSET_CODE}" ;\n    rr:class edu:ClassAsset\n  ] ;\n  rr:predicateObjectMap [\n    rr:predicate edu:broomOwnedByClass ;\n    rr:objectMap [ rr:template "https://onto.edukg.org/id/class/{CLASS_CODE}" ]\n  ] .`,
      pushedSql: `SELECT asset_code, asset_category, class_code, quantity, condition_status\nFROM t_class_assets_ledger\nWHERE asset_category IN ('BROOM', 'MOP', 'TEXTBOOK');`,
    },
    union_discipline: {
      source: '德育管理 PostgreSQL · student_union_roster 表',
      targetClass: 'edu:DisciplineRoster',
      r2rml: `<#DisciplineRosterMapping> a rr:TriplesMap ;\n  rr:logicalTable [ rr:tableName "student_union_roster" ] ;\n  rr:subjectMap [\n    rr:template "https://onto.edukg.org/id/roster/{ROSTER_ID}" ;\n    rr:class edu:DisciplineRoster\n  ] ;\n  rr:predicateObjectMap [\n    rr:predicate edu:rosterAppliesRule ;\n    rr:objectMap [ rr:template "https://onto.edukg.org/id/rule/{RULE_CODE}" ]\n  ] .`,
      pushedSql: `SELECT roster_id, check_window, target_class_code, rule_code, deduction_pts\nFROM student_union_roster\nWHERE check_date >= CURRENT_DATE - INTERVAL '7 days';`,
    },
  }[obdaTable];

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <h1 className="text-lg font-bold text-slate-900">学校本体应用表现形式</h1>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0" role="tablist">
          {APPLICATION_MANIFESTATIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={activeTab === m.id}
              onClick={() => {
                setActiveTab(m.id);
                setActionStatus(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === m.id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {m.id === 'digital-twin'
                ? '1. 语义对象中台'
                : m.id === 'graphrag'
                  ? '2. GraphRAG 幻觉抑制'
                  : '3. OBDA 虚拟化融合'}
            </button>
          ))}
        </div>
      </section>

      {/* Tab 1: Semantic Digital Twin (Object & Action Model) */}
      {activeTab === 'digital-twin' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Layers3 className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <span>语义对象视图 (Object / Link / Action)</span>
            </div>

            <div className="space-y-2">
              {(
                [
                  { id: 'classroom', name: '高一 (3) 班 · 行政班级中枢', type: 'edu:Classroom' },
                  { id: 'asset', name: '教室软毛扫帚 (CLEAN-1031)', type: 'edu:Broom' },
                  { id: 'discipline', name: '午休纪律与卫生联合编排 (DR-W09)', type: 'edu:DisciplineRoster' },
                ] as const
              ).map((obj) => (
                <button
                  key={obj.id}
                  type="button"
                  onClick={() => {
                    setSelectedObjectId(obj.id);
                    setActionStatus(null);
                  }}
                  className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-center justify-between gap-3 ${
                    selectedObjectId === obj.id
                      ? 'border-blue-600 bg-blue-50/60'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{obj.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">{obj.type}</div>
                  </div>
                  <span className="text-xs text-blue-600 font-medium">查看对象</span>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-mono text-blue-600">{objectProfiles.classUri}</div>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">{objectProfiles.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setActionStatus(objectProfiles.actionResult)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{objectProfiles.actionLabel}</span>
              </button>
            </div>

            {actionStatus && (
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{actionStatus}</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {objectProfiles.attributes.map((attr) => (
                <div key={attr.k} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[11px] text-slate-500">{attr.k}</div>
                  <div className="text-xs font-semibold text-slate-900 mt-1 tabular-nums">{attr.v}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">本体语义关联导航 (LinkTypes)</div>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {objectProfiles.links.map((lk) => (
                  <li key={lk} className="px-4 py-2.5 text-xs text-slate-700 flex items-center gap-2">
                    <Network className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    <span>{lk}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: GraphRAG & Hallucination Suppression */}
      {activeTab === 'graphrag' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-wrap gap-2">
                {GRAPHRAG_CASES.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setRagCaseId(c.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      ragCaseId === c.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    场景 {idx + 1}：{c.id === 'rag-school-playground' ? '操场防撞场与课表溯源' : '扫帚/拖把台账与纪律巡检'}
                  </button>
                ))}
              </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setRagMode('compare')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  ragMode === 'compare' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                对比模式 (Vector vs Ontology)
              </button>
              <button
                type="button"
                onClick={() => setRagMode('onto')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  ragMode === 'onto' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                仅看本体执行详情
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500 mb-1">自然语言提问</div>
            <p className="text-base font-bold text-slate-900">{currentRag.question}</p>
          </div>

          <div className={`grid grid-cols-1 ${ragMode === 'compare' ? 'lg:grid-cols-2' : ''} gap-5`}>
            {ragMode === 'compare' && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldAlert className="w-4 h-4 text-amber-600" aria-hidden="true" />
                    <span>传统纯向量 RAG (无本体约束)</span>
                  </div>
                  <span className="text-xs font-medium text-amber-700">易发生多跳断链</span>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 leading-relaxed">
                  {currentRag.naiveAnswer}
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">失败根因分析</div>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    {currentRag.naiveIssues.map((iss) => (
                      <li key={iss} className="flex items-start gap-2">
                        <span className="text-amber-600">·</span>
                        <span>{iss}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  <span>本体约束 GraphRAG (Schema-Grounded NL2Cypher)</span>
                </div>
                <span className="text-xs font-medium text-emerald-700">确定性可回溯</span>
              </div>

              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-950 leading-relaxed">
                {currentRag.ontoAnswer}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-900">大模型受本体 Schema 约束生成的确定性查询</div>
                <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {currentRag.ontoCypher}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-900">图谱可解释证据路径 (Evidence Chain)</div>
                <ul className="space-y-1 text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {currentRag.ontoEvidencePath.map((path) => (
                    <li key={path} className="truncate" title={path}>
                      → {path}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: OBDA / Virtual Knowledge Graph */}
      {activeTab === 'obda' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Database className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <span>物理数据源 (R2RML)</span>
            </div>
            <div className="space-y-2 pt-1">
              {(
                [
                  { id: 'edu_timetable', label: '教务 SQL Server · 上学排课表', cls: 'edu:CourseSchedule' },
                  { id: 'campus_assets', label: '总务 MySQL · 扫帚拖把教材台账', cls: 'edu:ClassAsset' },
                  { id: 'union_discipline', label: '德育 PostgreSQL · 学生会执勤表', cls: 'edu:DisciplineRoster' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setObdaTable(t.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    obdaTable === t.id
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900">{t.label}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">映射目标 → {t.cls}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <div className="text-xs text-slate-500">虚拟图谱映射与 SQL 下推详情</div>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">
                  {obdaMappings.source} → {obdaMappings.targetClass}
                </h2>
              </div>
              <span className="text-xs font-mono text-emerald-700 font-medium">零数据冗余搬迁</span>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">1. R2RML 声明式语义映射规则</div>
              <pre className="p-4 bg-slate-950 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                {obdaMappings.r2rml}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">2. 查询时动态重写下推至原库的优化 SQL (SQL Pushdown)</div>
              <pre className="p-4 bg-slate-900 text-emerald-300 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                {obdaMappings.pushedSql}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
