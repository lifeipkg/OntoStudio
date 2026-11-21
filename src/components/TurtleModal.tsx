import { Check, Copy, Download, X } from 'lucide-react';
import { useState } from 'react';

interface TurtleModalProps {
  open: boolean;
  ontologyName: string;
  prefix: string;
  turtleContent: string;
  onClose: () => void;
}

export function TurtleModal({
  open,
  ontologyName,
  prefix,
  turtleContent,
  onClose,
}: TurtleModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(turtleContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([turtleContent], { type: 'text/turtle;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}-ontology.ttl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="turtle-modal-title"
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="turtle-modal-title" className="text-base font-semibold text-slate-900">
              OWL / SHACL Turtle (.ttl)
            </h2>
            <p className="text-xs font-mono text-slate-500 mt-0.5">{ontologyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭导出弹窗"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto bg-slate-950 text-slate-100 flex-1">
          <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-words">
            {turtleContent}
          </pre>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? '已复制到剪贴板' : '复制源码'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 {prefix}-ontology.ttl</span>
          </button>
        </div>
      </div>
    </div>
  );
}
