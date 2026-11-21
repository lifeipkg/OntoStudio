import { Cpu, Database, Gauge, GitMerge, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ConstructionOptimizationConfig, QueryOptimizationConfig } from '../types/ontology';
import { simulateConstructionMetrics, simulateQueryPlan } from '../utils/ontologyEngine';

const SCALES: Array<{ value: 10 | 100 | 500 | 1000; label: string }> = [
  { value: 10, label: '1,000 万 (10M)' },
  { value: 100, label: '1 亿 (100M)' },
  { value: 500, label: '5 亿 (500M)' },
  { value: 1000, label: '10 亿 (1B)' },
];

export function OptimizationView() {
  const [buildCfg, setBuildCfg] = useState<ConstructionOptimizationConfig>({
    tripleScaleMillions: 500,
    incrementalDelta: true,
    typePartitionBlocking: true,
    owlProfile: 'OWL2_EL',
    parallelShacl: true,
  });

  const [queryCfg, setQueryCfg] = useState<QueryOptimizationConfig>({
    tripleScaleMillions: 500,
    hopDepth: 3,
    dictionaryBitmapEncoding: true,
    ontologyClassPruning: true,
    cardinalityJoinReorder: true,
    materializedHotViews: false,
  });

  const buildMetrics = useMemo(() => simulateConstructionMetrics(buildCfg), [buildCfg]);
  const queryResult = useMemo(() => simulateQueryPlan(queryCfg), [queryCfg]);

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-bold text-slate-900">大规模图谱构建与查询优化仿真</h1>
        <span className="text-xs font-mono text-slate-500">10M – 1B Triples</span>
      </section>

      {/* Lab 1: Large-Scale Construction Optimization */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">
              图谱构建优化 (Ingestion & Reasoning)
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">图谱规模:</span>
            <div className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {SCALES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setBuildCfg((c) => ({ ...c, tripleScaleMillions: s.value }))}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap tabular-nums transition-colors ${
                    buildCfg.tripleScaleMillions === s.value
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-3">
            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={buildCfg.typePartitionBlocking}
                  onChange={(e) =>
                    setBuildCfg((c) => ({ ...c, typePartitionBlocking: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  本体类分区消歧 (Type-Partitioned Blocking)
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">O(N·k)</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={buildCfg.incrementalDelta}
                  onChange={(e) =>
                    setBuildCfg((c) => ({ ...c, incrementalDelta: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  增量 Delta-Upsert + 内容哈希去重
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">Delta</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={buildCfg.parallelShacl}
                  onChange={(e) =>
                    setBuildCfg((c) => ({ ...c, parallelShacl: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  SHACL 局部子图并行校验
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">Partitioned</span>
            </label>

            <div className="p-3.5 rounded-lg border border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-slate-900">OWL 推理语言子集 (Profile) 选择</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'OWL2_EL', label: 'OWL 2 EL (推荐)' },
                    { id: 'OWL2_RL', label: 'OWL 2 RL (规则)' },
                    { id: 'OWL2_DL', label: 'OWL 2 DL (全集)' },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setBuildCfg((c) => ({ ...c, owlProfile: p.id }))}
                    className={`px-2 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                      buildCfg.owlProfile === p.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">{buildMetrics.reasoningComplexity}</p>
            </div>
          </div>

          {/* Live Metrics Table */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="construction-metrics">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">写入与推理吞吐量</div>
                <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {buildMetrics.ingestRateKTriplesPerSec}k
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Triples / sec</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">万级增量更新延迟</div>
                <div className="text-2xl font-bold text-blue-700 font-mono tabular-nums mt-1">
                  {buildMetrics.incrementalUpdateMs >= 60000
                    ? `${(buildMetrics.incrementalUpdateMs / 60000).toFixed(1)} min`
                    : `${buildMetrics.incrementalUpdateMs} ms`}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {buildCfg.incrementalDelta ? 'Delta 增量生效' : '退化为全量重算'}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">实体消歧比对次数</div>
                <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {buildMetrics.entityResolutionComparisonsBillions}B
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">十亿次两两候选比对</div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">全量初始化耗时</div>
                <div className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {buildMetrics.fullBuildMinutes} 分钟
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {buildCfg.tripleScaleMillions}M 三元组全集
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 col-span-2">
                <div className="text-[11px] text-slate-500">推理机常驻内存估算</div>
                <div className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {buildMetrics.memoryFootprintGB} GB
                </div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {buildCfg.owlProfile}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Lab 2: Large-Scale Query Efficiency Optimization */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Gauge className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">
              查询效率优化 (Query Optimizer & Execution Plan)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="hop-slider" className="text-xs font-medium text-slate-700 whitespace-nowrap">
                多跳深度: <span className="font-mono font-bold text-blue-600 tabular-nums">{queryCfg.hopDepth}-Hop</span>
              </label>
              <input
                id="hop-slider"
                type="range"
                min={1}
                max={5}
                step={1}
                value={queryCfg.hopDepth}
                onChange={(e) =>
                  setQueryCfg((c) => ({
                    ...c,
                    hopDepth: Number(e.target.value) as 1 | 2 | 3 | 4 | 5,
                  }))
                }
                className="w-28 accent-blue-600"
              />
            </div>

            <div className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-full sm:w-auto">
              {SCALES.map((s) => (
                <button
                  key={`q-${s.value}`}
                  type="button"
                  onClick={() => setQueryCfg((c) => ({ ...c, tripleScaleMillions: s.value }))}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap tabular-nums transition-colors ${
                    queryCfg.tripleScaleMillions === s.value
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Query Optimization Toggles */}
          <div className="lg:col-span-4 space-y-3">
            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={queryCfg.ontologyClassPruning}
                  onChange={(e) =>
                    setQueryCfg((c) => ({ ...c, ontologyClassPruning: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  本体类层次位掩码剪枝
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">Bitmask</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={queryCfg.cardinalityJoinReorder}
                  onChange={(e) =>
                    setQueryCfg((c) => ({ ...c, cardinalityJoinReorder: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  基数约束连接重排序
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">1..1 First</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={queryCfg.dictionaryBitmapEncoding}
                  onChange={(e) =>
                    setQueryCfg((c) => ({ ...c, dictionaryBitmapEncoding: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  HDT / CSR 整数字典与位图索引
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">64-bit ID</span>
            </label>

            <label className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={queryCfg.materializedHotViews}
                  onChange={(e) =>
                    setQueryCfg((c) => ({ ...c, materializedHotViews: e.target.checked }))
                  }
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="text-xs font-semibold text-slate-900">
                  高频推理路径物化视图
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 shrink-0">Hot Views</span>
            </label>
          </div>

          {/* Query Benchmark & Physical Plan */}
          <div className="lg:col-span-8 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="query-metrics">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">无优化基线延迟</div>
                <div className="text-xl font-bold text-slate-500 font-mono tabular-nums mt-1 line-through">
                  {queryResult.baselineLatencyMs.toLocaleString('zh-CN')} ms
                </div>
              </div>

              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50">
                <div className="text-[11px] text-blue-700 font-medium">优化后 P95 延迟</div>
                <div className="text-2xl font-bold text-blue-700 font-mono tabular-nums mt-1">
                  {queryResult.optimizedLatencyMs.toLocaleString('zh-CN')} ms
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">查询加速比</div>
                <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-1 flex items-center gap-1">
                  <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{queryResult.speedupFactor}x</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="text-[11px] text-slate-500">无效边剪枝率</div>
                <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                  {queryResult.pruningRatioPct}%
                </div>
                <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                  仅扫 {queryResult.optimizedScannedEdges.toLocaleString('zh-CN')} 条边
                </div>
              </div>
            </div>

            {/* Execution Plan Operators */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <Cpu className="w-4 h-4 text-slate-600" aria-hidden="true" />
                  <span>物理查询执行计划流水线 (Physical Query Plan)</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  基线扫描: {queryResult.baselineScannedEdges.toLocaleString('zh-CN')} 条边
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {queryResult.planSteps.map((step) => (
                  <div key={step.operator} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold font-mono text-slate-900">
                        {step.operator}
                      </div>
                      <div className="text-xs text-slate-600">{step.detail}</div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-right">
                      <div>
                        <div className="text-[11px] text-slate-500">估算中间行数</div>
                        <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                          {step.estimatedRows.toLocaleString('zh-CN')}
                        </div>
                      </div>
                      <div className="w-16">
                        <div className="text-[11px] text-slate-500">耗时占比</div>
                        <div className="text-xs font-mono font-semibold text-blue-700 tabular-nums">
                          {step.costSharePct}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rewritten Query Preview */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs font-semibold text-slate-900">
                <GitMerge className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                <span>本体感知查询重写器输出 (Rewritten SPARQL Execution AST)</span>
              </div>
              <pre className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                {queryResult.rewrittenQuery}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
