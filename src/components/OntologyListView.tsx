import { ArrowRight, CheckCircle2, Download, FilePlus2, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DomainOntologyPreset, ReasonerReport } from '../types/ontology';
import { runOntologyReasoner } from '../utils/ontologyEngine';

interface OntologyListViewProps {
  ontologies: DomainOntologyPreset[];
  onSelectOntology: (ontologyId: string) => void;
  onOpenBuilder: () => void;
  onOpenImport: () => void;
  onContinueImport: (ontologyId: string) => void;
  onExportOntology: (ontologyId: string) => void;
  onDeleteOntology: (ontologyId: string) => void;
  importFeedback?: string | null;
  onDismissFeedback?: () => void;
}

export function OntologyListView({
  ontologies,
  onSelectOntology,
  onOpenBuilder,
  onOpenImport,
  onContinueImport,
  onExportOntology,
  onDeleteOntology,
  importFeedback,
  onDismissFeedback,
}: OntologyListViewProps) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ontologies
      .filter((onto) => {
        if (!q) return true;
        return (
          onto.name.toLowerCase().includes(q) ||
          onto.prefix.toLowerCase().includes(q) ||
          onto.namespace.toLowerCase().includes(q) ||
          (onto.fileName ?? '').toLowerCase().includes(q)
        );
      })
      .map((onto) => {
        const id = onto.id ?? onto.key;
        const report: ReasonerReport = runOntologyReasoner(onto);
        return { onto, id, report };
      });
  }, [ontologies, query]);

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <section className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-slate-900">本体模型列表</h1>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {ontologies.length} 个模型
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <label htmlFor="ontology-list-search" className="sr-only">
              筛选本体模型
            </label>
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="ontology-list-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选名称 / 前缀 / 命名空间..."
              className="pl-8 pr-3 py-1.5 w-60 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={onOpenBuilder}
            data-testid="open-builder-btn"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
            <span>从零搭建本体</span>
          </button>

          <button
            type="button"
            onClick={onOpenImport}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>批量导入 .ttl</span>
          </button>
        </div>
      </section>

      {importFeedback && (
        <div
          className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 text-xs text-emerald-900 flex items-center justify-between gap-3"
          data-testid="import-feedback-banner"
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

      {/* Ontology Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="ontology-list-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
                <th className="py-3 px-5">本体名称</th>
                <th className="py-3 px-4">前缀 / 命名空间</th>
                <th className="py-3 px-4">来源</th>
                <th className="py-3 px-4 text-right">类数</th>
                <th className="py-3 px-4 text-right">关系数</th>
                <th className="py-3 px-4 text-right">SHACL</th>
                <th className="py-3 px-4">推理校验</th>
                <th className="py-3 px-5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500">
                    无匹配的本体模型
                  </td>
                </tr>
              ) : (
                rows.map(({ onto, id, report }) => {
                  const isUserCreated = onto.source === 'imported' || onto.source === 'wizard';
                  const sourceLabel =
                    onto.source === 'wizard'
                      ? '向导自建'
                      : onto.source === 'imported'
                        ? 'TTL 导入'
                        : '内置预设';
                  return (
                    <tr
                      key={id}
                      data-testid={`ontology-row-${id}`}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <button
                          type="button"
                          onClick={() => onSelectOntology(id)}
                          className="text-left group focus:outline-none focus-visible:underline"
                        >
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {onto.name}
                          </div>
                          {onto.fileName && (
                            <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate max-w-[320px]" title={onto.fileName}>
                              {onto.fileName}
                              {onto.importedAt ? ` · ${onto.importedAt}` : ''}
                            </div>
                          )}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                        <div className="font-semibold text-blue-700">{onto.prefix}:</div>
                        <div className="truncate max-w-[240px]" title={onto.namespace}>
                          {onto.namespace}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                        {sourceLabel}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {onto.classes.length}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {onto.objectProperties.length}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                        {onto.shaclRules.length}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px]">
                        {report.consistent ? (
                          <span className="text-emerald-700 font-medium">Consistent</span>
                        ) : (
                          <span className="text-red-700 font-medium">
                            {report.issues.filter((i) => i.severity === 'error').length} 冲突
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onContinueImport(id)}
                            aria-label={`继续导入到 ${onto.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <FilePlus2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                            <span>继续导入</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onExportOntology(id)}
                            aria-label={`导出 ${onto.name} Turtle`}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          {isUserCreated && (
                            <button
                              type="button"
                              onClick={() => onDeleteOntology(id)}
                              aria-label={`删除 ${onto.name}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectOntology(id)}
                            aria-label={`进入详情 ${onto.name}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                          >
                            <span>进入详情</span>
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
