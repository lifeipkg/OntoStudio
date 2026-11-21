import { useEffect, useMemo, useState } from 'react';
import { ApplicationsView } from './components/ApplicationsView';
import { ImportTurtleModal } from './components/ImportTurtleModal';
import { OntologyEditorView } from './components/OntologyEditorView';
import { OntologyListView } from './components/OntologyListView';
import { OptimizationView } from './components/OptimizationView';
import { TopBar } from './components/TopBar';
import { TurtleModal } from './components/TurtleModal';
import { WorkflowView } from './components/WorkflowView';
import { ZeroToOneBuilderView } from './components/ZeroToOneBuilderView';
import { DOMAIN_PRESETS } from './data/ontologyPresets';
import type {
  DomainOntologyPreset,
  NavSection,
  OntologyClass,
  OntologyDataProperty,
  OntologyLayerId,
  OntologyObjectProperty,
  ReasonerReport,
} from './types/ontology';
import { generateTurtleSerialization, runOntologyReasoner } from './utils/ontologyEngine';
import { mergeOntologyModels, type MergeOntologyStats } from './utils/turtleParser';

const IMPORTED_STORAGE_KEY = 'ontostudio_imported_ontologies_v1';
const SCHOOL_OVERRIDE_STORAGE_KEY = 'ontostudio_school_override_v1';

function cloneSchoolPreset(): DomainOntologyPreset {
  return JSON.parse(JSON.stringify(DOMAIN_PRESETS.school)) as DomainOntologyPreset;
}

function loadInitialOntologies(): DomainOntologyPreset[] {
  let base = cloneSchoolPreset();
  if (typeof window === 'undefined' || !window.localStorage) {
    return [base];
  }
  try {
    const schoolRaw = window.localStorage.getItem(SCHOOL_OVERRIDE_STORAGE_KEY);
    if (schoolRaw) {
      const parsedSchool = JSON.parse(schoolRaw) as DomainOntologyPreset;
      if (
        parsedSchool &&
        parsedSchool.key === 'school' &&
        Array.isArray(parsedSchool.classes) &&
        parsedSchool.classes.length > 0
      ) {
        base = parsedSchool;
      }
    }
  } catch {
    // ignore storage errors
  }

  try {
    const raw = window.localStorage.getItem(IMPORTED_STORAGE_KEY);
    if (!raw) return [base];
    const parsed = JSON.parse(raw) as DomainOntologyPreset[];
    if (!Array.isArray(parsed)) return [base];
    const validImported = parsed.filter(
      (o) =>
        o &&
        typeof o.name === 'string' &&
        Array.isArray(o.classes) &&
        o.classes.length > 0 &&
        o.key !== 'school',
    );
    return [base, ...validImported];
  } catch {
    return [base];
  }
}

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('editor');
  const [editorView, setEditorView] = useState<'list' | 'detail' | 'builder'>('list');
  const [ontologies, setOntologies] = useState<DomainOntologyPreset[]>(loadInitialOntologies);
  const [selectedOntologyId, setSelectedOntologyId] = useState<string>('school');
  const [reasonerReport, setReasonerReport] = useState<ReasonerReport | null>(() =>
    runOntologyReasoner(ontologies[0] ?? DOMAIN_PRESETS.school),
  );
  const [exportTargetId, setExportTargetId] = useState<string | null>(null);
  const [importModal, setImportModal] = useState<{ open: boolean; targetId: string | null }>({
    open: false,
    targetId: null,
  });
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  // Persist user-imported / wizard-built ontologies and any extended school preset to localStorage
  useEffect(() => {
    try {
      const userCreatedOnly = ontologies.filter(
        (o) => o.source === 'imported' || o.source === 'wizard',
      );
      window.localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(userCreatedOnly));

      const schoolItem = ontologies.find((o) => (o.id ?? o.key) === 'school');
      const baseSchool = DOMAIN_PRESETS.school;
      const schoolModified =
        schoolItem &&
        (schoolItem.classes.length !== baseSchool.classes.length ||
          schoolItem.objectProperties.length !== baseSchool.objectProperties.length ||
          schoolItem.shaclRules.length !== baseSchool.shaclRules.length ||
          Boolean(schoolItem.fileName));
      if (schoolModified && schoolItem) {
        window.localStorage.setItem(SCHOOL_OVERRIDE_STORAGE_KEY, JSON.stringify(schoolItem));
      } else {
        window.localStorage.removeItem(SCHOOL_OVERRIDE_STORAGE_KEY);
      }
    } catch {
      // ignore storage quota errors
    }
  }, [ontologies]);

  const activeOntology = useMemo(
    () =>
      ontologies.find((o) => (o.id ?? o.key) === selectedOntologyId) ?? ontologies[0],
    [ontologies, selectedOntologyId],
  );

  const exportTargetOntology = useMemo(
    () =>
      ontologies.find((o) => (o.id ?? o.key) === exportTargetId) ?? activeOntology,
    [ontologies, exportTargetId, activeOntology],
  );

  const exportTurtleText = useMemo(
    () => generateTurtleSerialization(exportTargetOntology),
    [exportTargetOntology],
  );

  const handleSelectSection = (section: NavSection) => {
    if (section === 'editor' && activeSection === 'editor' && editorView !== 'list') {
      setEditorView('list');
    }
    setActiveSection(section);
  };

  const handleSelectOntology = (ontologyId: string) => {
    const target = ontologies.find((o) => (o.id ?? o.key) === ontologyId);
    if (!target) return;
    setSelectedOntologyId(ontologyId);
    setReasonerReport(runOntologyReasoner(target));
    setImportFeedback(null);
    setEditorView('detail');
    setActiveSection('editor');
  };

  const handleCompleteBuilder = (built: DomainOntologyPreset) => {
    const builtId = built.id ?? built.key;
    setOntologies((prev) => [...prev, built]);
    setSelectedOntologyId(builtId);
    setReasonerReport(runOntologyReasoner(built));
    setActiveSection('editor');
    setEditorView('detail');
    setImportFeedback(
      `已通过 0→1 向导创建「${built.name}」：${built.classes.length} 类 · ${built.objectProperties.length} 关系 · ${built.shaclRules.length} SHACL`,
    );
  };

  const handleCreateOntology = (
    imported: DomainOntologyPreset,
    dedupedTriples: number,
    fileCount: number,
  ) => {
    setOntologies((prev) => [...prev, imported]);
    setImportModal({ open: false, targetId: null });
    setActiveSection('editor');
    setEditorView('list');
    setImportFeedback(
      `已导入「${imported.name}」：${fileCount} 份文件 · ${imported.classes.length} 类 · ${imported.objectProperties.length} 关系 · ${imported.shaclRules.length} SHACL${dedupedTriples > 0 ? `（去重 ${dedupedTriples} 条重复三元组）` : ''}`,
    );
  };

  const handleMergeOntology = (
    targetId: string,
    incoming: DomainOntologyPreset,
    fileCount: number,
  ): MergeOntologyStats | null => {
    const target = ontologies.find((o) => (o.id ?? o.key) === targetId);
    if (!target) return null;

    const { merged, stats } = mergeOntologyModels(target, incoming);
    setOntologies((prev) =>
      prev.map((item) => ((item.id ?? item.key) === targetId ? merged : item)),
    );
    if (selectedOntologyId === targetId) {
      setReasonerReport(runOntologyReasoner(merged));
    }

    const skippedTotal =
      stats.skippedDuplicateClasses +
      stats.skippedDuplicateDataProps +
      stats.skippedDuplicateObjectProps +
      stats.skippedDuplicateShacl;

    setImportFeedback(
      `已继续导入 ${fileCount} 份文件至「${merged.name}」：+${stats.addedClasses} 类 · +${stats.addedDataProps} 属性 · +${stats.addedObjectProps} 关系 · +${stats.addedShacl} SHACL（去重跳过 ${skippedTotal} 项）`,
    );
    setImportModal({ open: false, targetId: null });
    return stats;
  };

  const handleDeleteOntology = (ontologyId: string) => {
    setOntologies((prev) => {
      const next = prev.filter((o) => (o.id ?? o.key) !== ontologyId);
      if (selectedOntologyId === ontologyId && next.length > 0) {
        const fallback = next[0];
        setSelectedOntologyId(fallback.id ?? fallback.key);
        setReasonerReport(runOntologyReasoner(fallback));
        setEditorView('list');
      }
      return next;
    });
  };

  const updateActiveOntology = (
    updater: (prev: DomainOntologyPreset) => DomainOntologyPreset,
  ) => {
    const targetId = activeOntology.id ?? activeOntology.key;
    setOntologies((prev) =>
      prev.map((item) => {
        if ((item.id ?? item.key) !== targetId) return item;
        const updated = updater(item);
        setReasonerReport(runOntologyReasoner(updated));
        return updated;
      }),
    );
  };

  const handleAddSubclass = (
    parentId: string,
    name: string,
    label: string,
    description: string,
    layer: OntologyLayerId,
  ) => {
    updateActiveOntology((prev) => {
      const parent = prev.classes.find((c) => c.id === parentId);
      const siblingCount = prev.classes.filter((c) => c.parentId === parentId).length;
      const newClass: OntologyClass = {
        id: `custom-${Date.now()}`,
        name,
        label,
        parentId,
        layer,
        description,
        x: Math.min(510, Math.max(16, (parent?.x ?? 264) + (siblingCount % 2 === 0 ? -70 : 90))),
        y: Math.min(390, (parent?.y ?? 160) + 94),
        estimatedInstances: 15000,
        dataProperties: [],
      };
      return {
        ...prev,
        classes: [...prev.classes, newClass],
      };
    });
  };

  const handleAddDataProperty = (classId: string, prop: Omit<OntologyDataProperty, 'id'>) => {
    updateActiveOntology((prev) => ({
      ...prev,
      classes: prev.classes.map((cls) =>
        cls.id === classId
          ? {
              ...cls,
              dataProperties: [
                ...cls.dataProperties,
                { ...prop, id: `dp-${Date.now()}` },
              ],
            }
          : cls,
      ),
    }));
  };

  const handleAddObjectProperty = (prop: Omit<OntologyObjectProperty, 'id'>) => {
    updateActiveOntology((prev) => ({
      ...prev,
      objectProperties: [
        ...prev.objectProperties,
        { ...prop, id: `op-${Date.now()}` },
      ],
    }));
  };

  const handleRunReasoner = () => {
    setReasonerReport(runOntologyReasoner(activeOntology));
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onOpenExport={() => setExportTargetId(activeOntology.id ?? activeOntology.key)}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeSection === 'editor' && editorView === 'list' && (
          <OntologyListView
            ontologies={ontologies}
            onSelectOntology={handleSelectOntology}
            onOpenBuilder={() => setEditorView('builder')}
            onOpenImport={() => setImportModal({ open: true, targetId: null })}
            onContinueImport={(id) => setImportModal({ open: true, targetId: id })}
            onExportOntology={(id) => setExportTargetId(id)}
            onDeleteOntology={handleDeleteOntology}
            importFeedback={importFeedback}
            onDismissFeedback={() => setImportFeedback(null)}
          />
        )}

        {activeSection === 'editor' && editorView === 'builder' && (
          <ZeroToOneBuilderView
            onBackToList={() => setEditorView('list')}
            onCompleteBuild={handleCompleteBuilder}
          />
        )}

        {activeSection === 'editor' && editorView === 'detail' && (
          <OntologyEditorView
            key={activeOntology.id ?? activeOntology.key}
            preset={activeOntology}
            onBackToList={() => setEditorView('list')}
            onContinueImport={() =>
              setImportModal({ open: true, targetId: activeOntology.id ?? activeOntology.key })
            }
            importFeedback={importFeedback}
            onDismissFeedback={() => setImportFeedback(null)}
            onAddSubclass={handleAddSubclass}
            onAddDataProperty={handleAddDataProperty}
            onAddObjectProperty={handleAddObjectProperty}
            reasonerReport={reasonerReport}
            onRunReasoner={handleRunReasoner}
          />
        )}

        {activeSection === 'workflow' && (
          <WorkflowView
            onStartBuilder={() => {
              setActiveSection('editor');
              setEditorView('builder');
            }}
          />
        )}
        {activeSection === 'applications' && <ApplicationsView />}
        {activeSection === 'optimization' && <OptimizationView />}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-auto">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <span>OntoStudio · 现代本体架构与大规模知识图谱工程实验室</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setActiveSection('editor');
                setEditorView('list');
              }}
              className="hover:text-slate-900 transition-colors"
            >
              本体编辑器
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('workflow')}
              className="hover:text-slate-900 transition-colors"
            >
              开发流程
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('applications')}
              className="hover:text-slate-900 transition-colors"
            >
              实际应用
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('optimization')}
              className="hover:text-slate-900 transition-colors"
            >
              性能优化
            </button>
          </div>
        </div>
      </footer>

      <TurtleModal
        open={exportTargetId !== null}
        ontologyName={exportTargetOntology.name}
        prefix={exportTargetOntology.prefix}
        turtleContent={exportTurtleText}
        onClose={() => setExportTargetId(null)}
      />

      <ImportTurtleModal
        open={importModal.open}
        ontologies={ontologies}
        defaultTargetId={importModal.targetId}
        onClose={() => setImportModal({ open: false, targetId: null })}
        onCreateOntology={handleCreateOntology}
        onMergeOntology={handleMergeOntology}
      />
    </div>
  );
}
