import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Files,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DomainOntologyPreset } from '../types/ontology';
import {
  mergeOntologyModels,
  parseTurtleBatchToOntology,
  type MergeOntologyStats,
  type TurtleFileInput,
} from '../utils/turtleParser';

interface QueuedTurtleFile {
  id: string;
  fileName: string;
  content: string;
  lineCount: number;
}

interface ImportTurtleModalProps {
  open: boolean;
  ontologies: DomainOntologyPreset[];
  defaultTargetId?: string | null;
  onClose: () => void;
  onCreateOntology: (ontology: DomainOntologyPreset, dedupedTriples: number, fileCount: number) => void;
  onMergeOntology: (
    targetId: string,
    incoming: DomainOntologyPreset,
    fileCount: number,
  ) => MergeOntologyStats | null;
}

export function ImportTurtleModal({
  open,
  ontologies,
  defaultTargetId = null,
  onClose,
  onCreateOntology,
  onMergeOntology,
}: ImportTurtleModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'create' | 'merge'>(defaultTargetId ? 'merge' : 'create');
  const [targetId, setTargetId] = useState<string>(defaultTargetId ?? '');
  const [queuedFiles, setQueuedFiles] = useState<QueuedTurtleFile[]>([]);
  const [customName, setCustomName] = useState<string>('');
  const [ttlContent, setTtlContent] = useState<string>('');
  const [strictMode, setStrictMode] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState(false);
  const [submitError, setSubmitError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setQueuedFiles([]);
    setCustomName('');
    setTtlContent('');
    setSubmitError('');
    setIsDragging(false);

    if (defaultTargetId) {
      setMode('merge');
      setTargetId(defaultTargetId);
    } else {
      setMode('create');
      const firstId = ontologies[0] ? (ontologies[0].id ?? ontologies[0].key) : '';
      setTargetId(firstId);
    }
  }, [open, defaultTargetId, ontologies]);

  const targetOntology = useMemo(
    () => ontologies.find((o) => (o.id ?? o.key) === targetId) ?? null,
    [ontologies, targetId],
  );

  const batchInputs = useMemo<TurtleFileInput[]>(() => {
    const inputs: TurtleFileInput[] = queuedFiles.map((f) => ({
      fileName: f.fileName,
      content: f.content,
    }));
    if (ttlContent.trim()) {
      inputs.push({
        fileName: queuedFiles.length === 0 ? undefined : 'inline-snippet.ttl',
        content: ttlContent,
      });
    }
    return inputs;
  }, [queuedFiles, ttlContent]);

  const parsedBatch = useMemo(() => {
    if (batchInputs.length === 0) return null;
    return parseTurtleBatchToOntology(batchInputs, { customName });
  }, [batchInputs, customName]);

  const activeDiagnostics = parsedBatch?.diagnostics ?? null;
  const hasStrictGap = Boolean(
    activeDiagnostics &&
      (activeDiagnostics.missingClassDefs.length > 0 || activeDiagnostics.untypedSubjectCount > 0),
  );

  const mergePreview = useMemo(() => {
    if (mode !== 'merge' || !targetOntology || !parsedBatch || !parsedBatch.ok) return null;
    return mergeOntologyModels(targetOntology, parsedBatch.ontology);
  }, [mode, targetOntology, parsedBatch]);

  if (!open) return null;

  const resetForm = () => {
    setQueuedFiles([]);
    setCustomName('');
    setTtlContent('');
    setSubmitError('');
    setIsDragging(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const enqueueFiles = async (fileList: FileList | File[]) => {
    setSubmitError('');
    const incomingFiles = Array.from(fileList);
    if (incomingFiles.length === 0) return;

    try {
      const readResults = await Promise.all(
        incomingFiles.map(async (file) => {
          const text = await file.text();
          return {
            fileName: file.name,
            content: text,
            lineCount: text ? text.split(/\r?\n/).length : 0,
          };
        }),
      );

      setQueuedFiles((prev) => {
        const next = [...prev];
        for (const item of readResults) {
          const isDuplicateFile = next.some(
            (existing) =>
              existing.fileName === item.fileName && existing.content.trim() === item.content.trim(),
          );
          if (!isDuplicateFile) {
            next.push({
              id: `${item.fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              ...item,
            });
          }
        }
        return next;
      });
    } catch {
      setSubmitError('读取文件失败，请确认文件编码为 UTF-8 文本格式。');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void enqueueFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void enqueueFiles(e.dataTransfer.files);
    }
  };

  const removeQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
    setSubmitError('');
  };

  const submitWithOptions = (allowSupplementary: boolean) => {
    if (batchInputs.length === 0) {
      setSubmitError('请先选择至少一个 .ttl 文件或粘贴 Turtle 源码。');
      return;
    }
    const res = parseTurtleBatchToOntology(batchInputs, {
      customName,
      allowSupplementaryInstances: allowSupplementary,
    });
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }

    if (mode === 'merge') {
      if (!targetOntology) {
        setSubmitError('请选择要继续导入的目标本体模型。');
        return;
      }
      onMergeOntology(targetOntology.id ?? targetOntology.key, res.ontology, res.fileCount);
      resetForm();
      return;
    }

    onCreateOntology(res.ontology, res.dedupedTriples, res.fileCount);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitWithOptions(false);
  };

  const handleApplyRepairSnippet = () => {
    if (!activeDiagnostics?.repairTurtleSnippet) return;
    setSubmitError('');
    setTtlContent((prev) =>
      prev.trim()
        ? `${prev.trimEnd()}\n\n${activeDiagnostics.repairTurtleSnippet}`
        : activeDiagnostics.repairTurtleSnippet,
    );
  };

  const totalSkippedInMerge = mergePreview
    ? mergePreview.stats.skippedDuplicateClasses +
      mergePreview.stats.skippedDuplicateDataProps +
      mergePreview.stats.skippedDuplicateObjectProps +
      mergePreview.stats.skippedDuplicateShacl
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-ttl-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 id="import-ttl-title" className="text-base font-semibold text-slate-900 truncate">
              {mode === 'merge' ? '继续导入 .ttl（自动合并去重）' : '批量导入 Turtle (.ttl) 本体'}
            </h2>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={strictMode}
              data-testid="strict-mode-toggle"
              onClick={() => setStrictMode((v) => !v)}
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                strictMode
                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>严格模式</span>
              <span
                className={`w-7 h-4 rounded-full relative transition-colors ${
                  strictMode ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    strictMode ? 'left-3.5' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label="关闭导入弹窗"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg" role="group" aria-label="导入方式">
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setSubmitError('');
              }}
              className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                mode === 'create'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              新建本体（多文件自动合并）
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('merge');
                setSubmitError('');
                if (!targetId && ontologies[0]) {
                  setTargetId(ontologies[0].id ?? ontologies[0].key);
                }
              }}
              className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                mode === 'merge'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              继续导入到已有本体（去重追加）
            </button>
          </div>

          {/* Target Selector or Custom Name */}
          {mode === 'merge' ? (
            <div>
              <label htmlFor="merge-target-ontology" className="block text-xs font-medium text-slate-700 mb-1">
                目标本体模型
              </label>
              <select
                id="merge-target-ontology"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {ontologies.map((onto) => {
                  const id = onto.id ?? onto.key;
                  return (
                    <option key={id} value={id}>
                      {onto.name} ({onto.prefix}: · {onto.classes.length} 类 / {onto.objectProperties.length} 关系)
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div>
              <label htmlFor="import-onto-name" className="block text-xs font-medium text-slate-700 mb-1">
                本体名称（选填，留空则读取 owl:Ontology 或文件名）
              </label>
              <input
                id="import-onto-name"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：校园实验室设备本体"
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {/* Multi-File Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
              isDragging
                ? 'border-blue-600 bg-blue-50/70'
                : 'border-slate-300 bg-slate-50/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Upload className="w-5 h-5 text-blue-600 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {queuedFiles.length > 0
                    ? `已排队 ${queuedFiles.length} 个 .ttl 文件（可继续添加）`
                    : '拖拽或选择多个 .ttl / .turtle 文件'}
                </div>
                <div className="text-[11px] font-mono text-slate-500">
                  支持 TBox Schema 与 ABox 实例 (.ttl) · 多文件按类/属性/关系/SHACL 自动去重
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".ttl,.turtle,text/turtle"
              onChange={handleFileChange}
              aria-label="选择 Turtle 文件"
              className="sr-only"
              data-testid="ttl-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              {queuedFiles.length > 0 ? '继续添加文件' : '选择文件'}
            </button>
          </div>

          {/* Queued Files List */}
          {queuedFiles.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="queued-ttl-files">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Files className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                  待合并文件队列 ({queuedFiles.length})
                </span>
                <button
                  type="button"
                  onClick={() => setQueuedFiles([])}
                  className="text-slate-500 hover:text-red-600"
                >
                  清空队列
                </button>
              </div>
              <ul className="divide-y divide-slate-100 max-h-32 overflow-y-auto">
                {queuedFiles.map((file) => (
                  <li
                    key={file.id}
                    className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs bg-white"
                  >
                    <span className="font-mono text-slate-800 truncate">{file.fileName}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {file.lineCount} 行
                      </span>
                      <button
                        type="button"
                        onClick={() => removeQueuedFile(file.id)}
                        aria-label={`移除 ${file.fileName}`}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Direct Turtle Source Input */}
          <div>
            <label htmlFor="import-ttl-source" className="block text-xs font-medium text-slate-700 mb-1">
              {queuedFiles.length > 0 ? '补充 Turtle 片段（选填）' : 'Turtle (.ttl) 源码'}
            </label>
            <textarea
              id="import-ttl-source"
              rows={queuedFiles.length > 0 ? 4 : 7}
              value={ttlContent}
              onChange={(e) => {
                setTtlContent(e.target.value);
                setSubmitError('');
              }}
              placeholder="@prefix ex: <https://example.org/onto#> .&#10;ex:Entity a owl:Class ; rdfs:label &quot;实体&quot;@zh ."
              className="w-full px-3 py-2 text-xs font-mono bg-slate-950 text-slate-100 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 leading-relaxed"
            />
          </div>

          {/* Parsed Stats / Merge Diff Preview */}
          {parsedBatch && parsedBatch.ok && mode === 'create' && (
            <div
              className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/70 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900"
              data-testid="ttl-parse-preview"
            >
              <span className="font-semibold">{parsedBatch.ontology.name}</span>
              <span className="font-mono tabular-nums">
                {parsedBatch.fileCount} 份 · {parsedBatch.ontology.classes.length} 类 ·{' '}
                {parsedBatch.ontology.objectProperties.length} 关系 ·{' '}
                {parsedBatch.ontology.shaclRules.length} SHACL
                {parsedBatch.aboxInstanceCount > 0 ? ` · ${parsedBatch.aboxInstanceCount} ABox 实例` : ''}
                {parsedBatch.dedupedTriples > 0 ? ` · 去重 ${parsedBatch.dedupedTriples} 三元组` : ''}
              </span>
            </div>
          )}

          {mergePreview && parsedBatch && parsedBatch.ok && (
            <div
              className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/70 space-y-1 text-xs text-emerald-900"
              data-testid="ttl-parse-preview"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">合并至「{targetOntology?.name}」</span>
                <span className="font-mono tabular-nums font-medium">
                  +{mergePreview.stats.addedClasses} 类 · +{mergePreview.stats.addedDataProps} 属性 · +
                  {mergePreview.stats.addedObjectProps} 关系 · +{mergePreview.stats.addedShacl} SHACL
                  {parsedBatch.aboxInstanceCount > 0 ? ` · ${parsedBatch.aboxInstanceCount} ABox 实例` : ''}
                </span>
              </div>
              <div className="font-mono text-[11px] text-emerald-800 tabular-nums">
                已去重跳过 {totalSkippedInMerge} 项（{mergePreview.stats.skippedDuplicateClasses} 类 /{' '}
                {mergePreview.stats.skippedDuplicateDataProps} 属性 /{' '}
                {mergePreview.stats.skippedDuplicateObjectProps} 关系 /{' '}
                {mergePreview.stats.skippedDuplicateShacl} SHACL）
              </div>
            </div>
          )}

          {strictMode && parsedBatch && !hasStrictGap && parsedBatch.ok && (
            <div
              className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50/60 flex items-center gap-2 text-xs text-blue-800"
              data-testid="strict-mode-passed"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
              <span>严格模式校验通过：所有引用类均包含显式 owl:Class / rdfs:Class 定义</span>
            </div>
          )}

          {strictMode && hasStrictGap && activeDiagnostics && (
            <div
              className="p-3.5 rounded-lg border border-amber-300 bg-amber-50/85 space-y-2.5 text-xs text-amber-950"
              data-testid="strict-mode-diagnostics"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                  <span>
                    严格校验：{activeDiagnostics.missingClassDefs.length > 0
                      ? `${activeDiagnostics.missingClassDefs.length} 个 Class 缺少显式 owl:Class 定义`
                      : `检测到 ${activeDiagnostics.untypedSubjectCount} 个未声明 rdf:type 的实例节点`}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {activeDiagnostics.repairTurtleSnippet && (
                    <button
                      type="button"
                      onClick={handleApplyRepairSnippet}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-900 bg-white border border-amber-300 rounded-md hover:bg-amber-100 transition-colors"
                    >
                      <Wrench className="w-3 h-3" aria-hidden="true" />
                      <span>一键补全声明</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => submitWithOptions(true)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
                  >
                    作为补充实例数据导入
                  </button>
                </div>
              </div>

              {activeDiagnostics.missingClassDefs.length > 0 && (
                <div className="font-mono text-[11px] text-amber-900">
                  缺失类定义：{activeDiagnostics.missingClassDefs.map((m) => m.prefixedRef).join(' , ')}
                </div>
              )}

              {activeDiagnostics.repairTurtleSnippet && (
                <pre className="p-2.5 rounded-md bg-slate-950 text-emerald-300 font-mono text-[11px] overflow-x-auto leading-relaxed">
                  {activeDiagnostics.repairTurtleSnippet}
                </pre>
              )}
            </div>
          )}

          {(submitError || (parsedBatch && !parsedBatch.ok && !(strictMode && hasStrictGap))) && (
            <div
              className="p-3 rounded-lg border border-red-200 bg-red-50/80 text-xs text-red-800 flex items-start gap-2"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{submitError || (!parsedBatch?.ok ? parsedBatch?.error : '')}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            取消
          </button>
          {strictMode && hasStrictGap ? (
            <button
              type="button"
              onClick={() => submitWithOptions(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {mode === 'merge' ? '作为补充实例继续导入' : '作为补充实例导入'}
            </button>
          ) : (
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              {mode === 'merge' ? '确认继续导入' : '确认导入'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
