import type {
  DomainOntologyPreset,
  OntologyClass,
  OntologyDataProperty,
  OntologyLayerId,
  OntologyObjectProperty,
  ShaclRule,
} from '../types/ontology';

export interface ParseTurtleOptions {
  fileName?: string;
  customName?: string;
}

export interface TurtleFileInput {
  fileName?: string;
  content: string;
}

export interface StrictMissingClassDef {
  iri: string;
  prefixedRef: string;
  localName: string;
}

export interface StrictValidationDiagnostics {
  missingClassDefs: StrictMissingClassDef[];
  untypedSubjectCount: number;
  repairTurtleSnippet: string;
}

export type ParseTurtleResult =
  | {
      ok: true;
      ontology: DomainOntologyPreset;
      fileCount: number;
      dedupedTriples: number;
      aboxInstanceCount: number;
      diagnostics: StrictValidationDiagnostics;
    }
  | {
      ok: false;
      error: string;
      diagnostics?: StrictValidationDiagnostics;
    };

export interface MergeOntologyStats {
  addedClasses: number;
  skippedDuplicateClasses: number;
  addedDataProps: number;
  skippedDuplicateDataProps: number;
  addedObjectProps: number;
  skippedDuplicateObjectProps: number;
  addedShacl: number;
  skippedDuplicateShacl: number;
}

export interface MergeOntologyResult {
  merged: DomainOntologyPreset;
  stats: MergeOntologyStats;
}

interface BlankNodeData {
  predicates: Array<{ predicate: string; objects: string[] }>;
}

type SubjectData = Map<string, string[]>;

interface ExtractedStatements {
  customPrefixes: Array<{ prefix: string; ns: string }>;
  baseUri: string;
  subjects: Map<string, SubjectData>;
  blankNodes: Map<string, BlankNodeData>;
  rawTripleCount: number;
  uniqueTripleCount: number;
}

const STANDARD_PREFIXES: Record<string, string> = {
  owl: 'http://www.w3.org/2002/07/owl#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  sh: 'http://www.w3.org/ns/shacl#',
};

function stripCommentsAndTokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comment line
    if (ch === '#') {
      while (i < len && input[i] !== '\n') i++;
      continue;
    }

    // Full IRI <...>
    if (ch === '<') {
      let end = i + 1;
      while (end < len && input[end] !== '>') end++;
      tokens.push(input.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    // Triple-quoted or single-quoted string literal
    if (ch === '"' || ch === "'") {
      const triple = input.slice(i, i + 3) === ch.repeat(3);
      let end = i + (triple ? 3 : 1);
      while (end < len) {
        if (input[end] === '\\') {
          end += 2;
          continue;
        }
        if (triple) {
          if (input.slice(end, end + 3) === ch.repeat(3)) {
            end += 3;
            break;
          }
          end++;
        } else {
          if (input[end] === ch) {
            end++;
            break;
          }
          end++;
        }
      }
      // Optional language tag (@zh) or datatype (^^xsd:string / ^^<...>)
      if (input[end] === '@') {
        end++;
        while (end < len && /[A-Za-z0-9-]/.test(input[end])) end++;
      } else if (input.slice(end, end + 2) === '^^') {
        end += 2;
        if (input[end] === '<') {
          while (end < len && input[end] !== '>') end++;
          if (end < len) end++;
        } else {
          while (end < len && !/[\s;.,[\]()]/.test(input[end])) end++;
        }
      }
      tokens.push(input.slice(i, end));
      i = end;
      continue;
    }

    // Punctuation
    if (ch === '.' || ch === ';' || ch === ',' || ch === '[' || ch === ']' || ch === '(' || ch === ')') {
      // Distinguish decimal number or '.' statement terminator
      if (ch === '.' && i + 1 < len && /[0-9]/.test(input[i + 1])) {
        let end = i + 1;
        while (end < len && /[0-9eE+-]/.test(input[end])) end++;
        tokens.push(input.slice(i, end));
        i = end;
        continue;
      }
      tokens.push(ch);
      i++;
      continue;
    }

    // Word / prefixed name / keyword / numeric literal
    let end = i;
    while (end < len && !/[\s;.,[\]()#"']/.test(input[end])) {
      end++;
    }
    const word = input.slice(i, end);
    tokens.push(word);
    i = end;
  }

  return tokens;
}

function unquoteLiteral(raw: string): { value: string; lang?: string } {
  const match = raw.match(/^(?:"""([\s\S]*)"""|'''([\s\S]*)'''|"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)')(?:@([A-Za-z0-9-]+)|\^\^.+)?$/);
  if (!match) return { value: raw };
  const text = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
  return { value: text, lang: match[5] };
}

function isLiteralValue(val: string): boolean {
  if (val.startsWith('"') || val.startsWith("'")) return true;
  if (val === 'true' || val === 'false') return true;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(val);
}

function inferLiteralDatatype(val: string): OntologyDataProperty['datatype'] {
  const dtMatch = val.match(/\^\^(.+)$/);
  if (dtMatch) {
    return mapXsdDatatype(dtMatch[1].replace(/^<|>$/g, ''));
  }
  if (val === 'true' || val === 'false') return 'xsd:boolean';
  if (/^[+-]?\d+$/.test(val)) return 'xsd:integer';
  if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(val)) return 'xsd:decimal';
  const unquoted = unquoteLiteral(val).value;
  if (/^\d{4}-\d{2}-\d{2}T/.test(unquoted)) return 'xsd:dateTime';
  return 'xsd:string';
}

function expandTerm(token: string, prefixes: Record<string, string>, baseUri = ''): string {
  if (token === 'a') return 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  if (token.startsWith('<') && token.endsWith('>')) {
    const inner = token.slice(1, -1);
    if (baseUri && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(inner)) {
      if (inner.startsWith('#')) {
        return `${baseUri.replace(/#$/, '')}${inner}`;
      }
      return `${baseUri}${inner}`;
    }
    return inner;
  }
  if (isLiteralValue(token)) {
    return token;
  }
  const colonIdx = token.indexOf(':');
  if (colonIdx !== -1 && !token.startsWith('"') && !token.startsWith("'")) {
    const pfx = token.slice(0, colonIdx);
    const local = token.slice(colonIdx + 1);
    const ns = prefixes[pfx];
    if (ns) return `${ns}${local}`;
  }
  return token;
}

function extractLocalName(iriOrTerm: string): string {
  if (!iriOrTerm) return 'Term';
  const hashIdx = iriOrTerm.lastIndexOf('#');
  if (hashIdx !== -1 && hashIdx < iriOrTerm.length - 1) {
    return iriOrTerm.slice(hashIdx + 1);
  }
  const slashIdx = iriOrTerm.lastIndexOf('/');
  if (slashIdx !== -1 && slashIdx < iriOrTerm.length - 1) {
    return iriOrTerm.slice(slashIdx + 1);
  }
  const colonIdx = iriOrTerm.lastIndexOf(':');
  if (colonIdx !== -1 && colonIdx < iriOrTerm.length - 1) {
    return iriOrTerm.slice(colonIdx + 1);
  }
  return iriOrTerm;
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) return 'Entity';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `C_${cleaned}`;
}

function pickBestLabel(literals: string[], fallbackName: string): string {
  if (literals.length === 0) return fallbackName;
  const parsed = literals.map(unquoteLiteral);
  const zh = parsed.find((p) => p.lang?.toLowerCase().startsWith('zh') && p.value.trim());
  if (zh) return zh.value.trim();
  const any = parsed.find((p) => p.value.trim());
  return any ? any.value.trim() : fallbackName;
}

function mapXsdDatatype(rangeIri: string): OntologyDataProperty['datatype'] {
  const local = extractLocalName(rangeIri).toLowerCase();
  if (local === 'integer' || local === 'int' || local === 'long' || local === 'short') {
    return 'xsd:integer';
  }
  if (local === 'decimal' || local === 'float' || local === 'double') {
    return 'xsd:decimal';
  }
  if (local === 'datetime' || local === 'date' || local === 'timestamp') {
    return 'xsd:dateTime';
  }
  if (local === 'boolean') {
    return 'xsd:boolean';
  }
  return 'xsd:string';
}

function computeHierarchicalCoords(classes: OntologyClass[]): void {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const depthMemo = new Map<string, number>();

  const getDepth = (id: string, visiting = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const cls = byId.get(id);
    const depth = cls?.parentId && byId.has(cls.parentId) ? 1 + getDepth(cls.parentId, visiting) : 0;
    depthMemo.set(id, depth);
    return depth;
  };

  const buckets = new Map<number, OntologyClass[]>();
  for (const cls of classes) {
    const d = getDepth(cls.id);
    const list = buckets.get(d) ?? [];
    list.push(cls);
    buckets.set(d, list);
  }

  const maxDepth = Math.max(0, ...buckets.keys());
  const width = 520;
  const height = 390;

  for (const [depth, list] of buckets.entries()) {
    const y = maxDepth === 0 ? 180 : 18 + (depth / maxDepth) * (height - 40);
    const count = list.length;
    list.forEach((cls, idx) => {
      cls.x = count === 1 ? width / 2 : 20 + (idx / (count - 1)) * (width - 40);
      cls.y = Math.round(y);
    });
  }
}

function extractTurtleStatements(
  source: string,
  bnodeScope: string,
): { ok: true; data: ExtractedStatements } | { ok: false; error: string } {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: 'Turtle 内容为空，请上传非空的 .ttl 文件或粘贴 Turtle 源码。' };
  }

  const tokens = stripCommentsAndTokenize(trimmed);
  if (tokens.length < 4) {
    return { ok: false, error: '未能识别有效的 Turtle 三元组语句。' };
  }

  const prefixes: Record<string, string> = { ...STANDARD_PREFIXES };
  const customPrefixes: Array<{ prefix: string; ns: string }> = [];
  let baseUri = '';

  const subjects = new Map<string, SubjectData>();
  const blankNodes = new Map<string, BlankNodeData>();
  let bnodeSeq = 0;
  let rawTripleCount = 0;
  let uniqueTripleCount = 0;

  const ensureSubject = (subj: string): SubjectData => {
    let map = subjects.get(subj);
    if (!map) {
      map = new Map<string, string[]>();
      subjects.set(subj, map);
    }
    return map;
  };

  const addTriple = (subj: string, pred: string, obj: string) => {
    rawTripleCount++;
    const map = ensureSubject(subj);
    const list = map.get(pred) ?? [];
    if (!list.includes(obj)) {
      list.push(obj);
      uniqueTripleCount++;
    }
    map.set(pred, list);
  };

  let cursor = 0;

  const parseBlankNode = (): string => {
    cursor++;
    const bnodeId = `_:${bnodeScope}b${++bnodeSeq}`;
    const predicates: Array<{ predicate: string; objects: string[] }> = [];

    while (cursor < tokens.length && tokens[cursor] !== ']') {
      const predTok = tokens[cursor++];
      if (!predTok || predTok === ';') continue;
      const pred = expandTerm(predTok, prefixes, baseUri);
      const objs: string[] = [];

      while (cursor < tokens.length) {
        const tok = tokens[cursor];
        if (tok === '[') {
          objs.push(parseBlankNode());
        } else if (tok === '(') {
          objs.push(parseCollection());
        } else if (tok === ']' || tok === ';') {
          break;
        } else if (tok === ',') {
          cursor++;
          continue;
        } else {
          cursor++;
          objs.push(tok.startsWith('"') || tok.startsWith("'") ? tok : expandTerm(tok, prefixes, baseUri));
        }

        if (tokens[cursor] === ',') {
          cursor++;
          continue;
        }
        if (tokens[cursor] === ';' || tokens[cursor] === ']') {
          break;
        }
      }

      if (objs.length > 0) {
        predicates.push({ predicate: pred, objects: objs });
        for (const o of objs) {
          addTriple(bnodeId, pred, o);
        }
      }
      if (tokens[cursor] === ';') {
        cursor++;
      }
    }

    if (tokens[cursor] === ']') cursor++;
    blankNodes.set(bnodeId, { predicates });
    return bnodeId;
  };

  const parseCollection = (): string => {
    cursor++; // skip '('
    const items: string[] = [];
    while (cursor < tokens.length && tokens[cursor] !== ')') {
      const tok = tokens[cursor];
      if (tok === '[') {
        items.push(parseBlankNode());
      } else if (tok === '(') {
        items.push(parseCollection());
      } else {
        cursor++;
        items.push(tok.startsWith('"') || tok.startsWith("'") ? tok : expandTerm(tok, prefixes, baseUri));
      }
    }
    if (tokens[cursor] === ')') cursor++;
    const colId = `_:${bnodeScope}list${++bnodeSeq}`;
    addTriple(colId, 'list:items', JSON.stringify(items));
    return colId;
  };

  try {
    while (cursor < tokens.length) {
      const tok = tokens[cursor];

      if (tok === '@prefix' || tok.toUpperCase() === 'PREFIX') {
        cursor++;
        const pfxRaw = tokens[cursor++] ?? ':';
        const iriRaw = tokens[cursor++] ?? '<>';
        if (tokens[cursor] === '.') cursor++;
        const pfx = pfxRaw.endsWith(':') ? pfxRaw.slice(0, -1) : pfxRaw;
        const iri = iriRaw.startsWith('<') && iriRaw.endsWith('>') ? iriRaw.slice(1, -1) : iriRaw;
        prefixes[pfx] = iri;
        if (!STANDARD_PREFIXES[pfx] && pfx !== '') {
          customPrefixes.push({ prefix: pfx, ns: iri });
        }
        continue;
      }

      if (tok === '@base' || tok.toUpperCase() === 'BASE') {
        cursor++;
        const iriRaw = tokens[cursor++] ?? '<>';
        if (tokens[cursor] === '.') cursor++;
        baseUri = iriRaw.startsWith('<') && iriRaw.endsWith('>') ? iriRaw.slice(1, -1) : iriRaw;
        continue;
      }

      let subj: string;
      if (tok === '[') {
        subj = parseBlankNode();
      } else {
        cursor++;
        subj = expandTerm(tok, prefixes, baseUri);
      }

      if (tokens[cursor] === '.') {
        cursor++;
        continue;
      }

      while (cursor < tokens.length && tokens[cursor] !== '.') {
        const predTok = tokens[cursor++];
        if (!predTok || predTok === ';') continue;
        if (predTok === '.') break;

        const pred = expandTerm(predTok, prefixes, baseUri);
        while (cursor < tokens.length) {
          const objTok = tokens[cursor];
          if (!objTok || objTok === ';' || objTok === '.') break;
          if (objTok === ',') {
            cursor++;
            continue;
          }

          let objVal: string;
          if (objTok === '[') {
            objVal = parseBlankNode();
          } else if (objTok === '(') {
            objVal = parseCollection();
          } else {
            cursor++;
            objVal =
              objTok.startsWith('"') || objTok.startsWith("'")
                ? objTok
                : expandTerm(objTok, prefixes, baseUri);
          }

          addTriple(subj, pred, objVal);

          if (tokens[cursor] === ',') {
            cursor++;
            continue;
          }
          break;
        }

        if (tokens[cursor] === ';') {
          cursor++;
        }
      }

      if (tokens[cursor] === '.') {
        cursor++;
      }
    }
  } catch {
    return { ok: false, error: 'Turtle 语法解析失败，请检查括号、引号与句尾点号是否成对闭合。' };
  }

  return {
    ok: true,
    data: {
      customPrefixes,
      baseUri,
      subjects,
      blankNodes,
      rawTripleCount,
      uniqueTripleCount,
    },
  };
}

function joinUniqueFileNames(names: Array<string | undefined>): string | undefined {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const seg of name.split(' + ')) {
      const clean = seg.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        parts.push(clean);
      }
    }
  }
  return parts.length > 0 ? parts.join(' + ') : undefined;
}

/**
 * Parses one or multiple Turtle (.ttl) files into a single deduplicated DomainOntologyPreset.
 * Each file resolves @prefix/@base within its own scope before pooling and deduplicating RDF triples.
 */
export function parseTurtleBatchToOntology(
  files: TurtleFileInput[],
  options?: { customName?: string; allowSupplementaryInstances?: boolean },
): ParseTurtleResult {
  const nonEmptyFiles = files.filter((f) => f.content.trim().length > 0);
  if (nonEmptyFiles.length === 0) {
    return { ok: false, error: 'Turtle 内容为空，请上传非空的 .ttl 文件或粘贴 Turtle 源码。' };
  }

  const pooledCustomPrefixes: Array<{ prefix: string; ns: string }> = [];
  const seenPrefixes = new Set<string>();
  let pooledBaseUri = '';
  const pooledSubjects = new Map<string, SubjectData>();
  const pooledBlankNodes = new Map<string, BlankNodeData>();
  let totalRawTriples = 0;
  let dedupedTriples = 0;

  for (let idx = 0; idx < nonEmptyFiles.length; idx++) {
    const file = nonEmptyFiles[idx];
    const extracted = extractTurtleStatements(file.content, `f${idx}_`);
    if (!extracted.ok) {
      const prefixMsg = file.fileName ? `文件「${file.fileName}」：` : '';
      return { ok: false, error: `${prefixMsg}${extracted.error}` };
    }

    totalRawTriples += extracted.data.rawTripleCount;
    dedupedTriples += extracted.data.rawTripleCount - extracted.data.uniqueTripleCount;

    for (const p of extracted.data.customPrefixes) {
      const key = `${p.prefix}::${p.ns}`;
      if (!seenPrefixes.has(key)) {
        seenPrefixes.add(key);
        pooledCustomPrefixes.push(p);
      }
    }

    if (!pooledBaseUri && extracted.data.baseUri) {
      pooledBaseUri = extracted.data.baseUri;
    }

    for (const [bnodeId, bdata] of extracted.data.blankNodes.entries()) {
      pooledBlankNodes.set(bnodeId, bdata);
    }

    for (const [subj, predMap] of extracted.data.subjects.entries()) {
      let targetPredMap = pooledSubjects.get(subj);
      if (!targetPredMap) {
        targetPredMap = new Map<string, string[]>();
        pooledSubjects.set(subj, targetPredMap);
      }
      for (const [pred, objs] of predMap.entries()) {
        const list = targetPredMap.get(pred) ?? [];
        for (const obj of objs) {
          if (list.includes(obj)) {
            dedupedTriples++;
          } else {
            list.push(obj);
          }
        }
        targetPredMap.set(pred, list);
      }
    }
  }

  if (totalRawTriples === 0) {
    return { ok: false, error: '未能识别有效的 Turtle 三元组语句。' };
  }

  const RDF_TYPE = `${STANDARD_PREFIXES.rdf}type`;
  const RDFS_LABEL = `${STANDARD_PREFIXES.rdfs}label`;
  const RDFS_COMMENT = `${STANDARD_PREFIXES.rdfs}comment`;
  const RDFS_SUBCLASS = `${STANDARD_PREFIXES.rdfs}subClassOf`;
  const RDFS_DOMAIN = `${STANDARD_PREFIXES.rdfs}domain`;
  const RDFS_RANGE = `${STANDARD_PREFIXES.rdfs}range`;
  const OWL_ONTOLOGY = `${STANDARD_PREFIXES.owl}Ontology`;
  const OWL_CLASS = `${STANDARD_PREFIXES.owl}Class`;
  const RDFS_CLASS = `${STANDARD_PREFIXES.rdfs}Class`;
  const OWL_THING = `${STANDARD_PREFIXES.owl}Thing`;
  const OWL_DISJOINT = `${STANDARD_PREFIXES.owl}disjointWith`;
  const OWL_IMPORTS = `${STANDARD_PREFIXES.owl}imports`;
  const OWL_OBJ_PROP = `${STANDARD_PREFIXES.owl}ObjectProperty`;
  const OWL_DATA_PROP = `${STANDARD_PREFIXES.owl}DatatypeProperty`;
  const OWL_TRANSITIVE = `${STANDARD_PREFIXES.owl}TransitiveProperty`;
  const OWL_SYMMETRIC = `${STANDARD_PREFIXES.owl}SymmetricProperty`;
  const OWL_FUNCTIONAL = `${STANDARD_PREFIXES.owl}FunctionalProperty`;
  const OWL_INVERSE_OF = `${STANDARD_PREFIXES.owl}inverseOf`;
  const SH_NODE_SHAPE = `${STANDARD_PREFIXES.sh}NodeShape`;
  const SH_TARGET_CLASS = `${STANDARD_PREFIXES.sh}targetClass`;
  const SH_PROPERTY = `${STANDARD_PREFIXES.sh}property`;
  const SH_PATH = `${STANDARD_PREFIXES.sh}path`;
  const SH_MIN_COUNT = `${STANDARD_PREFIXES.sh}minCount`;
  const SH_MAX_COUNT = `${STANDARD_PREFIXES.sh}maxCount`;
  const SH_PATTERN = `${STANDARD_PREFIXES.sh}pattern`;
  const SH_SEVERITY = `${STANDARD_PREFIXES.sh}severity`;

  const combinedFileName = joinUniqueFileNames(nonEmptyFiles.map((f) => f.fileName));
  const primaryFileName = nonEmptyFiles.find((f) => f.fileName)?.fileName;

  const primaryPrefixEntry = pooledCustomPrefixes[0];
  const fallbackSlug = primaryFileName
    ? sanitizeIdentifier(primaryFileName.replace(/\.(ttl|turtle)$/i, '')).toLowerCase().slice(0, 12)
    : 'onto';
  const prefix = primaryPrefixEntry?.prefix || fallbackSlug || 'onto';
  const namespace =
    primaryPrefixEntry?.ns ||
    pooledBaseUri ||
    `https://onto.imported.local/${prefix}#`;

  let ontologyName = '';
  let upperStandard = 'http://www.w3.org/2002/07/owl#Thing';
  for (const [, preds] of pooledSubjects.entries()) {
    const types = preds.get(RDF_TYPE) ?? [];
    if (types.includes(OWL_ONTOLOGY)) {
      const labels = preds.get(RDFS_LABEL) ?? [];
      if (labels.length > 0) {
        ontologyName = pickBestLabel(labels, '');
      }
      const imports = preds.get(OWL_IMPORTS) ?? [];
      if (imports.length > 0 && !imports[0].startsWith('_:')) {
        upperStandard = imports[0];
      }
      break;
    }
  }

  if (!ontologyName) {
    ontologyName =
      options?.customName?.trim() ||
      (primaryFileName ? primaryFileName.replace(/\.(ttl|turtle)$/i, '') : '') ||
      `${prefix} 本体模型`;
  } else if (options?.customName?.trim()) {
    ontologyName = options.customName.trim();
  }

  const OWL_NAMED_INDIVIDUAL = `${STANDARD_PREFIXES.owl}NamedIndividual`;
  const SCHEMA_TYPES = new Set([
    OWL_ONTOLOGY,
    OWL_CLASS,
    RDFS_CLASS,
    OWL_OBJ_PROP,
    OWL_DATA_PROP,
    OWL_TRANSITIVE,
    OWL_SYMMETRIC,
    OWL_FUNCTIONAL,
    SH_NODE_SHAPE,
  ]);

  const isCustomTerm = (iri: string) =>
    !iri.startsWith('_:') &&
    !isLiteralValue(iri) &&
    !iri.startsWith(STANDARD_PREFIXES.owl) &&
    !iri.startsWith(STANDARD_PREFIXES.rdf) &&
    !iri.startsWith(STANDARD_PREFIXES.rdfs) &&
    !iri.startsWith(STANDARD_PREFIXES.xsd) &&
    !iri.startsWith(STANDARD_PREFIXES.sh);

  const explicitClassIris = new Set<string>();
  const classIris = new Set<string>();
  const aboxInstances = new Map<string, string[]>();
  const untypedSubjects = new Set<string>();
  const instanceCountByClassIri = new Map<string, number>();

  for (const [subj, preds] of pooledSubjects.entries()) {
    if (subj.startsWith('_:')) continue;
    const types = preds.get(RDF_TYPE) ?? [];
    if (types.includes(OWL_CLASS) || types.includes(RDFS_CLASS)) {
      if (subj !== OWL_THING) {
        explicitClassIris.add(subj);
        classIris.add(subj);
      }
    }
    if (preds.has(RDFS_SUBCLASS)) {
      if (subj !== OWL_THING) classIris.add(subj);
      for (const sup of preds.get(RDFS_SUBCLASS) ?? []) {
        if (isCustomTerm(sup)) classIris.add(sup);
      }
    }
    if (types.includes(OWL_OBJ_PROP) || types.includes(OWL_TRANSITIVE) || types.includes(OWL_SYMMETRIC)) {
      for (const d of preds.get(RDFS_DOMAIN) ?? []) {
        if (isCustomTerm(d)) classIris.add(d);
      }
      for (const r of preds.get(RDFS_RANGE) ?? []) {
        if (isCustomTerm(r)) classIris.add(r);
      }
    }
    if (types.includes(OWL_DATA_PROP)) {
      for (const d of preds.get(RDFS_DOMAIN) ?? []) {
        if (isCustomTerm(d)) classIris.add(d);
      }
    }
    if (types.includes(SH_NODE_SHAPE)) {
      for (const t of preds.get(SH_TARGET_CLASS) ?? []) {
        if (isCustomTerm(t)) classIris.add(t);
      }
    }

    // ABox instance detection (e.g. `edu:Broom_01 a edu:Broom .` or `edu:Broom_01 a owl:NamedIndividual, edu:Broom .`)
    const isSchemaSubject =
      types.some((t) => SCHEMA_TYPES.has(t)) ||
      preds.has(RDFS_SUBCLASS) ||
      preds.has(RDFS_DOMAIN) ||
      preds.has(RDFS_RANGE);

    if (!isSchemaSubject) {
      const instanceClassIris = types.filter((t) => isCustomTerm(t));
      const resolvedTypes =
        instanceClassIris.length > 0
          ? instanceClassIris
          : types.includes(OWL_NAMED_INDIVIDUAL)
            ? [OWL_NAMED_INDIVIDUAL]
            : [];
      if (resolvedTypes.length > 0) {
        aboxInstances.set(subj, resolvedTypes);
        for (const clsIri of resolvedTypes) {
          classIris.add(clsIri);
          instanceCountByClassIri.set(clsIri, (instanceCountByClassIri.get(clsIri) ?? 0) + 1);
        }
      } else if (isCustomTerm(subj)) {
        untypedSubjects.add(subj);
      }
    }
  }

  const formatIriAsRef = (iri: string): string => {
    for (const entry of pooledCustomPrefixes) {
      if (iri.startsWith(entry.ns)) {
        return `${entry.prefix}:${iri.slice(entry.ns.length)}`;
      }
    }
    if (iri.startsWith(namespace)) {
      return `${prefix}:${iri.slice(namespace.length)}`;
    }
    return `<${iri}>`;
  };

  const missingClassDefs: StrictMissingClassDef[] = [];
  for (const iri of classIris) {
    if (!explicitClassIris.has(iri) && iri !== OWL_NAMED_INDIVIDUAL) {
      const localName = sanitizeIdentifier(extractLocalName(iri));
      missingClassDefs.push({
        iri,
        prefixedRef: formatIriAsRef(iri),
        localName,
      });
    }
  }

  const buildRepairSnippet = (): string => {
    const lines: string[] = [
      `@prefix owl: <${STANDARD_PREFIXES.owl}> .`,
      `@prefix rdfs: <${STANDARD_PREFIXES.rdfs}> .`,
      `@prefix ${prefix}: <${namespace}> .`,
    ];
    if (missingClassDefs.length > 0) {
      for (const m of missingClassDefs) {
        lines.push(`${m.prefixedRef} a owl:Class ; rdfs:label "${m.localName}"@zh .`);
      }
    } else if (untypedSubjects.size > 0) {
      lines.push(`${prefix}:SupplementaryInstance a owl:Class ; rdfs:label "补充实例实体"@zh .`);
      for (const subj of Array.from(untypedSubjects).slice(0, 6)) {
        lines.push(`${formatIriAsRef(subj)} a ${prefix}:SupplementaryInstance .`);
      }
    }
    return lines.join('\n');
  };

  const diagnostics: StrictValidationDiagnostics = {
    missingClassDefs,
    untypedSubjectCount: untypedSubjects.size,
    repairTurtleSnippet:
      missingClassDefs.length > 0 || untypedSubjects.size > 0 ? buildRepairSnippet() : '',
  };

  if (classIris.size === 0 && options?.allowSupplementaryInstances && untypedSubjects.size > 0) {
    const fallbackClassIri = `${namespace}SupplementaryInstance`;
    classIris.add(fallbackClassIri);
    for (const subj of untypedSubjects) {
      aboxInstances.set(subj, [fallbackClassIri]);
      instanceCountByClassIri.set(
        fallbackClassIri,
        (instanceCountByClassIri.get(fallbackClassIri) ?? 0) + 1,
      );
    }
  }

  if (classIris.size === 0) {
    return {
      ok: false,
      error:
        '未在文件中检测到 owl:Class / rdfs:Class / 属性 / SHACL 目标类或 ABox 实例类型 (rdf:type) 声明，请检查 Turtle 语法与前缀定义。',
      diagnostics: untypedSubjects.size > 0 ? diagnostics : undefined,
    };
  }

  const iriToId = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const iri of classIris) {
    const rawId = sanitizeIdentifier(extractLocalName(iri));
    let cid = `imp-${rawId.toLowerCase()}`;
    let seq = 2;
    while (usedIds.has(cid)) {
      cid = `imp-${rawId.toLowerCase()}-${seq++}`;
    }
    usedIds.add(cid);
    iriToId.set(iri, cid);
  }

  const classes: OntologyClass[] = [];
  for (const iri of classIris) {
    const preds = pooledSubjects.get(iri);
    const localName = sanitizeIdentifier(extractLocalName(iri));
    const label = pickBestLabel(preds?.get(RDFS_LABEL) ?? [], localName);
    const comments = preds?.get(RDFS_COMMENT) ?? [];
    const description = comments.length > 0 ? pickBestLabel(comments, '') : `${label} (${localName})`;

    const superRefs = (preds?.get(RDFS_SUBCLASS) ?? []).filter(
      (ref) => !ref.startsWith('_:') && ref !== OWL_THING && iriToId.has(ref),
    );
    const parentId = superRefs.length > 0 ? iriToId.get(superRefs[0])! : null;

    const disjRefs = Array.from(
      new Set(
        (preds?.get(OWL_DISJOINT) ?? [])
          .map((ref) => iriToId.get(ref))
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const aboxCount = instanceCountByClassIri.get(iri) ?? 0;

    classes.push({
      id: iriToId.get(iri)!,
      name: localName,
      label,
      parentId,
      layer: aboxCount > 0 && !preds ? 'instance' : parentId === null ? 'upper' : 'domain',
      description,
      ...(disjRefs.length > 0 ? { disjointWith: disjRefs } : {}),
      x: 100,
      y: 100,
      dataProperties: [],
      estimatedInstances: aboxCount > 0 ? aboxCount : parentId === null ? 0 : 1200,
    });
  }

  const classById = new Map(classes.map((c) => [c.id, c]));
  const childCount = new Map<string, number>();
  for (const c of classes) {
    if (c.parentId) {
      childCount.set(c.parentId, (childCount.get(c.parentId) ?? 0) + 1);
    }
  }
  for (const c of classes) {
    if (c.parentId === null && (childCount.get(c.id) ?? 0) > 0) {
      c.layer = 'upper';
    } else if (c.parentId !== null) {
      c.layer = 'domain';
    }
  }

  // Collect explicit TBox DatatypeProperties with per-class case-insensitive deduplication
  let dpSeq = 0;
  for (const [subj, preds] of pooledSubjects.entries()) {
    if (subj.startsWith('_:')) continue;
    const types = preds.get(RDF_TYPE) ?? [];
    if (!types.includes(OWL_DATA_PROP)) continue;

    const propName = sanitizeIdentifier(extractLocalName(subj));
    const propLabel = pickBestLabel(preds.get(RDFS_LABEL) ?? [], propName);
    const datatype = mapXsdDatatype((preds.get(RDFS_RANGE) ?? [])[0] ?? '');
    const domains = (preds.get(RDFS_DOMAIN) ?? []).filter((d) => iriToId.has(d));
    const targetIds = domains.length > 0 ? domains.map((d) => iriToId.get(d)!) : [classes[0].id];

    for (const cid of targetIds) {
      const cls = classById.get(cid);
      if (!cls) continue;
      if (!cls.dataProperties.some((dp) => dp.name.toLowerCase() === propName.toLowerCase())) {
        cls.dataProperties.push({
          id: `imp-dp-${++dpSeq}`,
          name: propName,
          label: propLabel,
          datatype,
          indexed: propName.toLowerCase().includes('id') || propName.toLowerCase().includes('code'),
        });
      }
    }
  }

  // Collect explicit TBox ObjectProperties with semantic key deduplication
  const objectProperties: OntologyObjectProperty[] = [];
  const objPropByKey = new Map<string, OntologyObjectProperty>();
  let opSeq = 0;
  for (const [subj, preds] of pooledSubjects.entries()) {
    if (subj.startsWith('_:')) continue;
    const types = preds.get(RDF_TYPE) ?? [];
    const isExplicitObjProp = types.includes(OWL_OBJ_PROP) || types.includes(OWL_TRANSITIVE) || types.includes(OWL_SYMMETRIC);
    if (!isExplicitObjProp) continue;

    const domainIri = (preds.get(RDFS_DOMAIN) ?? []).find((d) => iriToId.has(d));
    const rangeIri = (preds.get(RDFS_RANGE) ?? []).find((r) => iriToId.has(r));
    if (!domainIri || !rangeIri) continue;

    const domainId = iriToId.get(domainIri)!;
    const rangeId = iriToId.get(rangeIri)!;
    const propName = sanitizeIdentifier(extractLocalName(subj));
    const propLabel = pickBestLabel(preds.get(RDFS_LABEL) ?? [], propName);
    const functional = types.includes(OWL_FUNCTIONAL);
    const transitive = types.includes(OWL_TRANSITIVE);
    const symmetric = types.includes(OWL_SYMMETRIC);
    const inverseRaw = (preds.get(OWL_INVERSE_OF) ?? [])[0];
    const inverseOf = inverseRaw && !inverseRaw.startsWith('_:') ? extractLocalName(inverseRaw) : undefined;

    const key = `${propName.toLowerCase()}::${domainId}::${rangeId}`;
    const existing = objPropByKey.get(key);
    if (existing) {
      if (functional) {
        existing.functional = true;
        existing.cardinality = '1..1';
      }
      if (transitive) existing.transitive = true;
      if (symmetric) existing.symmetric = true;
      if (!existing.inverseOf && inverseOf) existing.inverseOf = inverseOf;
      if (existing.label === existing.name && propLabel !== propName) existing.label = propLabel;
      continue;
    }

    const op: OntologyObjectProperty = {
      id: `imp-op-${++opSeq}`,
      name: propName,
      label: propLabel,
      domainId,
      rangeId,
      cardinality: functional ? '1..1' : '1..*',
      ...(transitive ? { transitive: true } : {}),
      ...(symmetric ? { symmetric: true } : {}),
      ...(functional ? { functional: true } : {}),
      ...(inverseOf ? { inverseOf } : {}),
    };
    objPropByKey.set(key, op);
    objectProperties.push(op);
  }

  // Infer DatatypeProperties & ObjectProperties from ABox instance triples when not explicitly declared
  for (const [subj, domainClassIris] of aboxInstances.entries()) {
    const preds = pooledSubjects.get(subj);
    if (!preds) continue;
    for (const [predIri, objs] of preds.entries()) {
      if (!isCustomTerm(predIri)) continue;
      const propName = sanitizeIdentifier(extractLocalName(predIri));

      for (const obj of objs) {
        if (isLiteralValue(obj)) {
          const inferredType = inferLiteralDatatype(obj);
          for (const domainIri of domainClassIris) {
            const cid = iriToId.get(domainIri);
            const cls = cid ? classById.get(cid) : undefined;
            if (!cls) continue;
            if (!cls.dataProperties.some((dp) => dp.name.toLowerCase() === propName.toLowerCase())) {
              cls.dataProperties.push({
                id: `imp-dp-${++dpSeq}`,
                name: propName,
                label: propName,
                datatype: inferredType,
                indexed: propName.toLowerCase().includes('id') || propName.toLowerCase().includes('code'),
              });
            }
          }
        } else if (!obj.startsWith('_:') && aboxInstances.has(obj)) {
          const rangeClassIris = aboxInstances.get(obj)!;
          for (const domainIri of domainClassIris) {
            const domainId = iriToId.get(domainIri);
            if (!domainId) continue;
            for (const rangeIri of rangeClassIris) {
              const rangeId = iriToId.get(rangeIri);
              if (!rangeId) continue;
              const key = `${propName.toLowerCase()}::${domainId}::${rangeId}`;
              if (!objPropByKey.has(key)) {
                const op: OntologyObjectProperty = {
                  id: `imp-op-${++opSeq}`,
                  name: propName,
                  label: propName,
                  domainId,
                  rangeId,
                  cardinality: '1..*',
                };
                objPropByKey.set(key, op);
                objectProperties.push(op);
              }
            }
          }
        }
      }
    }
  }

  // Collect SHACL NodeShapes with semantic key deduplication
  const shaclRules: ShaclRule[] = [];
  const shaclSeen = new Set<string>();
  let shSeq = 0;

  const pushShaclRule = (rule: Omit<ShaclRule, 'id'>) => {
    const key = `${rule.targetClassId}::${rule.propertyName.toLowerCase()}::${rule.constraintType}::${rule.value}`;
    if (shaclSeen.has(key)) return;
    shaclSeen.add(key);
    shaclRules.push({
      id: `imp-sh-${++shSeq}`,
      ...rule,
    });
  };

  for (const [subj, preds] of pooledSubjects.entries()) {
    if (subj.startsWith('_:')) continue;
    const types = preds.get(RDF_TYPE) ?? [];
    if (!types.includes(SH_NODE_SHAPE)) continue;

    const targetIris = (preds.get(SH_TARGET_CLASS) ?? []).filter((t) => iriToId.has(t));
    const propShapes = preds.get(SH_PROPERTY) ?? [];
    for (const targetIri of targetIris) {
      const targetClassId = iriToId.get(targetIri)!;
      const targetCls = classById.get(targetClassId);
      if (targetCls && targetCls.parentId !== null) {
        targetCls.layer = 'constraint';
      }

      for (const propNodeId of propShapes) {
        const bnode = pooledBlankNodes.get(propNodeId);
        if (!bnode) continue;
        const bPreds = new Map<string, string[]>();
        for (const p of bnode.predicates) {
          bPreds.set(p.predicate, p.objects);
        }
        const pathRaw = (bPreds.get(SH_PATH) ?? [])[0];
        const propertyName = pathRaw ? extractLocalName(pathRaw) : 'property';
        const severityRaw = (bPreds.get(SH_SEVERITY) ?? [])[0] ?? '';
        const severity: 'Violation' | 'Warning' =
          extractLocalName(severityRaw) === 'Warning' ? 'Warning' : 'Violation';

        const minCount = (bPreds.get(SH_MIN_COUNT) ?? [])[0];
        const maxCount = (bPreds.get(SH_MAX_COUNT) ?? [])[0];
        const patternRaw = (bPreds.get(SH_PATTERN) ?? [])[0];

        if (minCount !== undefined) {
          const val = unquoteLiteral(minCount).value;
          pushShaclRule({
            targetClassId,
            propertyName,
            constraintType: 'minCount',
            value: val,
            severity,
            description: `${propertyName} sh:minCount ${val}`,
          });
          if (Number(val) >= 1 && targetCls) {
            const dp = targetCls.dataProperties.find((d) => d.name.toLowerCase() === propertyName.toLowerCase());
            if (dp) dp.required = true;
          }
        }
        if (maxCount !== undefined) {
          const val = unquoteLiteral(maxCount).value;
          pushShaclRule({
            targetClassId,
            propertyName,
            constraintType: 'maxCount',
            value: val,
            severity,
            description: `${propertyName} sh:maxCount ${val}`,
          });
        }
        if (patternRaw !== undefined) {
          const val = unquoteLiteral(patternRaw).value;
          pushShaclRule({
            targetClassId,
            propertyName,
            constraintType: 'pattern',
            value: val,
            severity,
            description: `${propertyName} sh:pattern "${val}"`,
          });
        }
      }
    }
  }

  computeHierarchicalCoords(classes);

  const uniqueKey = `imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ontology: DomainOntologyPreset = {
    id: uniqueKey,
    key: uniqueKey,
    source: 'imported',
    fileName: combinedFileName,
    importedAt: new Date().toISOString().slice(0, 10),
    name: ontologyName,
    namespace,
    prefix,
    upperStandard,
    summary: `${classes.length} 个类 / ${objectProperties.length} 条对象属性`,
    classes,
    objectProperties,
    shaclRules,
  };

  return {
    ok: true,
    ontology,
    fileCount: nonEmptyFiles.length,
    dedupedTriples,
    aboxInstanceCount: aboxInstances.size,
    diagnostics,
  };
}

/**
 * Parses a single W3C Turtle (.ttl) OWL/RDFS/SHACL document into a DomainOntologyPreset.
 */
export function parseTurtleToOntology(
  source: string,
  options?: ParseTurtleOptions,
): ParseTurtleResult {
  return parseTurtleBatchToOntology(
    [{ fileName: options?.fileName, content: source }],
    { customName: options?.customName },
  );
}

/**
 * Merges an incoming parsed ontology fragment into an existing DomainOntologyPreset,
 * strictly deduplicating OWL classes, data properties, object properties, disjointWith axioms,
 * and SHACL NodeShape constraints while reporting granular merge/skip counts.
 */
export function mergeOntologyModels(
  base: DomainOntologyPreset,
  incoming: DomainOntologyPreset,
): MergeOntologyResult {
  const stats: MergeOntologyStats = {
    addedClasses: 0,
    skippedDuplicateClasses: 0,
    addedDataProps: 0,
    skippedDuplicateDataProps: 0,
    addedObjectProps: 0,
    skippedDuplicateObjectProps: 0,
    addedShacl: 0,
    skippedDuplicateShacl: 0,
  };

  const mergedClasses: OntologyClass[] = base.classes.map((cls) => ({
    ...cls,
    ...(cls.disjointWith ? { disjointWith: [...cls.disjointWith] } : {}),
    dataProperties: cls.dataProperties.map((dp) => ({ ...dp })),
  }));

  const usedClassIds = new Set(mergedClasses.map((c) => c.id));
  const classById = new Map(mergedClasses.map((c) => [c.id, c]));
  const classByNameLower = new Map(mergedClasses.map((c) => [c.name.toLowerCase(), c]));
  const incomingToCanonicalId = new Map<string, string>();
  const addedClassIds: string[] = [];

  let dpSeq = mergedClasses.reduce((sum, c) => sum + c.dataProperties.length, 0) + 1;

  // Pass 1: Match or add classes & merge data properties
  for (const incCls of incoming.classes) {
    const existing = classByNameLower.get(incCls.name.toLowerCase());
    if (existing) {
      stats.skippedDuplicateClasses++;
      incomingToCanonicalId.set(incCls.id, existing.id);

      // Upgrade placeholder label/description when incoming brings richer metadata
      if (existing.label === existing.name && incCls.label !== incCls.name) {
        existing.label = incCls.label;
      }
      if (
        existing.description === `${existing.label} (${existing.name})` &&
        incCls.description &&
        incCls.description !== `${incCls.label} (${incCls.name})`
      ) {
        existing.description = incCls.description;
      }

      for (const incDp of incCls.dataProperties) {
        const existingDp = existing.dataProperties.find(
          (dp) => dp.name.toLowerCase() === incDp.name.toLowerCase(),
        );
        if (existingDp) {
          stats.skippedDuplicateDataProps++;
          if (incDp.required) existingDp.required = true;
          if (incDp.indexed) existingDp.indexed = true;
          if (existingDp.label === existingDp.name && incDp.label !== incDp.name) {
            existingDp.label = incDp.label;
          }
        } else {
          stats.addedDataProps++;
          existing.dataProperties.push({
            ...incDp,
            id: `m-dp-${++dpSeq}`,
          });
        }
      }
    } else {
      stats.addedClasses++;
      let canonicalId = incCls.id;
      let suffix = 2;
      while (usedClassIds.has(canonicalId)) {
        canonicalId = `${incCls.id}-m${suffix++}`;
      }
      usedClassIds.add(canonicalId);
      incomingToCanonicalId.set(incCls.id, canonicalId);
      addedClassIds.push(canonicalId);

      const clonedProps = incCls.dataProperties.map((dp) => {
        stats.addedDataProps++;
        return {
          ...dp,
          id: `m-dp-${++dpSeq}`,
        };
      });

      const newCls: OntologyClass = {
        ...incCls,
        id: canonicalId,
        parentId: null,
        disjointWith: undefined,
        dataProperties: clonedProps,
      };
      mergedClasses.push(newCls);
      classById.set(canonicalId, newCls);
      classByNameLower.set(newCls.name.toLowerCase(), newCls);
    }
  }

  // Pass 2: Remap parentId & disjointWith axioms cleanly
  for (const incCls of incoming.classes) {
    const canonicalId = incomingToCanonicalId.get(incCls.id);
    if (!canonicalId) continue;
    const targetCls = classById.get(canonicalId);
    if (!targetCls) continue;

    if (incCls.parentId) {
      const canonicalParentId = incomingToCanonicalId.get(incCls.parentId);
      if (canonicalParentId && canonicalParentId !== canonicalId && targetCls.parentId === null) {
        targetCls.parentId = canonicalParentId;
        if (targetCls.layer === 'upper') {
          targetCls.layer = 'domain';
        }
      }
    }

    if (incCls.disjointWith && incCls.disjointWith.length > 0) {
      const mergedDisj = new Set(targetCls.disjointWith ?? []);
      for (const rawDisj of incCls.disjointWith) {
        const canonicalDisj = incomingToCanonicalId.get(rawDisj);
        if (canonicalDisj && canonicalDisj !== canonicalId) {
          mergedDisj.add(canonicalDisj);
        }
      }
      if (mergedDisj.size > 0) {
        targetCls.disjointWith = Array.from(mergedDisj);
      }
    }
  }

  // Position newly added classes near their parent without scrambling existing preset positions
  addedClassIds.forEach((cid, idx) => {
    const cls = classById.get(cid);
    if (!cls) return;
    const parent = cls.parentId ? classById.get(cls.parentId) : undefined;
    if (parent) {
      const offset = (idx % 2 === 0 ? -1 : 1) * (55 + (idx % 3) * 28);
      cls.x = Math.min(505, Math.max(20, Math.round(parent.x + offset)));
      cls.y = Math.min(375, Math.max(20, Math.round(parent.y + 78)));
    } else {
      cls.x = 60 + ((idx * 110) % 420);
      cls.y = 40 + Math.floor((idx * 110) / 420) * 84;
    }
  });

  // Pass 3: Merge & deduplicate ObjectProperties
  const mergedObjectProps: OntologyObjectProperty[] = base.objectProperties.map((op) => ({ ...op }));
  const usedOpIds = new Set(mergedObjectProps.map((op) => op.id));
  const opByKey = new Map<string, OntologyObjectProperty>();
  for (const op of mergedObjectProps) {
    opByKey.set(`${op.name.toLowerCase()}::${op.domainId}::${op.rangeId}`, op);
  }
  let opSeq = mergedObjectProps.length + 1;

  for (const incOp of incoming.objectProperties) {
    const domainId = incomingToCanonicalId.get(incOp.domainId);
    const rangeId = incomingToCanonicalId.get(incOp.rangeId);
    if (!domainId || !rangeId) continue;

    const key = `${incOp.name.toLowerCase()}::${domainId}::${rangeId}`;
    const existingOp = opByKey.get(key);
    if (existingOp) {
      stats.skippedDuplicateObjectProps++;
      if (incOp.functional) {
        existingOp.functional = true;
        existingOp.cardinality = '1..1';
      }
      if (incOp.transitive) existingOp.transitive = true;
      if (incOp.symmetric) existingOp.symmetric = true;
      if (!existingOp.inverseOf && incOp.inverseOf) existingOp.inverseOf = incOp.inverseOf;
      if (existingOp.label === existingOp.name && incOp.label !== incOp.name) {
        existingOp.label = incOp.label;
      }
    } else {
      stats.addedObjectProps++;
      let opId = `m-op-${++opSeq}`;
      while (usedOpIds.has(opId)) {
        opId = `m-op-${++opSeq}`;
      }
      usedOpIds.add(opId);
      const newOp: OntologyObjectProperty = {
        ...incOp,
        id: opId,
        domainId,
        rangeId,
      };
      opByKey.set(key, newOp);
      mergedObjectProps.push(newOp);
    }
  }

  // Pass 4: Merge & deduplicate SHACL Rules
  const mergedShacl: ShaclRule[] = base.shaclRules.map((r) => ({ ...r }));
  const usedShIds = new Set(mergedShacl.map((r) => r.id));
  const shaclKeys = new Set<string>(
    mergedShacl.map(
      (r) => `${r.targetClassId}::${r.propertyName.toLowerCase()}::${r.constraintType}::${r.value}`,
    ),
  );
  let shSeq = mergedShacl.length + 1;

  for (const incRule of incoming.shaclRules) {
    const targetClassId = incomingToCanonicalId.get(incRule.targetClassId);
    if (!targetClassId) continue;

    const key = `${targetClassId}::${incRule.propertyName.toLowerCase()}::${incRule.constraintType}::${incRule.value}`;
    if (shaclKeys.has(key)) {
      stats.skippedDuplicateShacl++;
      continue;
    }

    shaclKeys.add(key);
    stats.addedShacl++;
    let shId = `m-sh-${++shSeq}`;
    while (usedShIds.has(shId)) {
      shId = `m-sh-${++shSeq}`;
    }
    usedShIds.add(shId);
    mergedShacl.push({
      ...incRule,
      id: shId,
      targetClassId,
    });

    const targetCls = classById.get(targetClassId);
    if (targetCls) {
      if (targetCls.parentId !== null && targetCls.layer === 'domain') {
        targetCls.layer = 'constraint';
      }
      if (incRule.constraintType === 'minCount' && Number(incRule.value) >= 1) {
        const dp = targetCls.dataProperties.find(
          (d) => d.name.toLowerCase() === incRule.propertyName.toLowerCase(),
        );
        if (dp) dp.required = true;
      }
    }
  }

  const combinedFileName = joinUniqueFileNames([base.fileName, incoming.fileName]);

  return {
    merged: {
      ...base,
      ...(combinedFileName ? { fileName: combinedFileName } : {}),
      importedAt: base.source === 'imported' ? new Date().toISOString().slice(0, 10) : base.importedAt,
      summary: `${mergedClasses.length} 个类 / ${mergedObjectProps.length} 条对象属性`,
      classes: mergedClasses,
      objectProperties: mergedObjectProps,
      shaclRules: mergedShacl,
    },
    stats,
  };
}
