export type NavSection = 'editor' | 'workflow' | 'applications' | 'optimization';

export type DomainKey = string;

export type OntologySourceType = 'preset' | 'imported' | 'wizard';

export type OntologyLayerId = 'upper' | 'domain' | 'constraint' | 'instance';

export interface OntologyDataProperty {
  id: string;
  name: string;
  label: string;
  datatype: 'xsd:string' | 'xsd:integer' | 'xsd:decimal' | 'xsd:dateTime' | 'xsd:boolean';
  required?: boolean;
  indexed?: boolean;
}

export interface ShaclRule {
  id: string;
  targetClassId: string;
  propertyName: string;
  constraintType: 'minCount' | 'maxCount' | 'pattern' | 'range' | 'disjointWith';
  value: string;
  severity: 'Violation' | 'Warning';
  description: string;
}

export interface OntologyClass {
  id: string;
  name: string; // e.g., "Patient"
  label: string; // e.g., "患者"
  parentId: string | null; // null means owl:Thing
  layer: OntologyLayerId;
  description: string;
  disjointWith?: string[];
  x: number; // canvas coordinate
  y: number; // canvas coordinate
  dataProperties: OntologyDataProperty[];
  estimatedInstances: number;
}

export interface OntologyObjectProperty {
  id: string;
  name: string; // e.g., "diagnosedWith"
  label: string; // e.g., "确诊疾病"
  domainId: string;
  rangeId: string;
  cardinality: '0..1' | '1..1' | '0..*' | '1..*';
  inverseOf?: string;
  transitive?: boolean;
  symmetric?: boolean;
  functional?: boolean;
}

export interface DomainOntologyPreset {
  id?: string;
  key: DomainKey;
  source?: OntologySourceType;
  fileName?: string;
  importedAt?: string;
  name: string;
  namespace: string;
  prefix: string;
  upperStandard: string;
  summary: string;
  classes: OntologyClass[];
  objectProperties: OntologyObjectProperty[];
  shaclRules: ShaclRule[];
}

export interface ReasonerIssue {
  id: string;
  severity: 'error' | 'warning';
  code: 'CYCLE_DETECTED' | 'DISJOINT_CONFLICT' | 'ORPHAN_RANGE' | 'MISSING_INDEX';
  message: string;
  targetId: string;
}

export interface InferredAxiom {
  id: string;
  subjectId: string;
  subjectLabel: string;
  rule: string;
  detail: string;
}

export interface ReasonerReport {
  consistent: boolean;
  profile: 'OWL 2 EL' | 'OWL 2 RL' | 'OWL 2 DL';
  checkedClasses: number;
  checkedProperties: number;
  issues: ReasonerIssue[];
  inferredAxioms: InferredAxiom[];
  executionTimeMs: number;
}

export interface WorkflowStage {
  id: string;
  stepNumber: string;
  title: string;
  subtitle: string;
  methodology: string;
  inputs: string[];
  deliverables: string[];
  modernShift: string;
  exampleCQ: string;
  resultingAxiom: string;
  validationCheck: string;
}

export interface ConstructionOptimizationConfig {
  tripleScaleMillions: 10 | 100 | 500 | 1000;
  incrementalDelta: boolean;
  typePartitionBlocking: boolean;
  owlProfile: 'OWL2_DL' | 'OWL2_EL' | 'OWL2_RL';
  parallelShacl: boolean;
}

export interface ConstructionMetrics {
  ingestRateKTriplesPerSec: number;
  fullBuildMinutes: number;
  incrementalUpdateMs: number;
  entityResolutionComparisonsBillions: number;
  memoryFootprintGB: number;
  reasoningComplexity: string;
}

export interface QueryOptimizationConfig {
  tripleScaleMillions: 10 | 100 | 500 | 1000;
  hopDepth: 1 | 2 | 3 | 4 | 5;
  dictionaryBitmapEncoding: boolean;
  ontologyClassPruning: boolean;
  cardinalityJoinReorder: boolean;
  materializedHotViews: boolean;
}

export interface QueryPlanStep {
  operator: string;
  detail: string;
  estimatedRows: number;
  costSharePct: number;
}

export interface QueryBenchmarkResult {
  baselineLatencyMs: number;
  optimizedLatencyMs: number;
  speedupFactor: number;
  baselineScannedEdges: number;
  optimizedScannedEdges: number;
  pruningRatioPct: number;
  planSteps: QueryPlanStep[];
  rewrittenQuery: string;
}
