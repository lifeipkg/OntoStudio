import type {
  DomainOntologyPreset,
  OntologyClass,
  OntologyDataProperty,
  OntologyLayerId,
  OntologyObjectProperty,
  ShaclRule,
} from '../types/ontology';

export interface BuilderDraft {
  name: string;
  prefix: string;
  namespace: string;
  competencyQuestion: string;
  classes: OntologyClass[];
  objectProperties: OntologyObjectProperty[];
  shaclRules: ShaclRule[];
}

export interface BeginnerTemplateMeta {
  id: 'library' | 'enterprise' | 'blank';
  title: string;
  badge: string;
  createDraft: () => BuilderDraft;
}

export const BEGINNER_TEMPLATES: BeginnerTemplateMeta[] = [
  {
    id: 'library',
    title: '图书馆借阅系统',
    badge: '入门推荐 · 4 类 / 3 关系',
    createDraft: () => ({
      name: '图书馆借阅本体',
      prefix: 'lib',
      namespace: 'https://onto.studio/lib#',
      competencyQuestion: '某本纸质书当前被哪位读者借走？它的 ISBN 与所在书架编号是什么？',
      classes: [
        {
          id: 'wiz-item',
          name: 'LibraryResource',
          label: '馆藏资源',
          parentId: null,
          layer: 'upper',
          description: '图书馆内可被编目与流通的顶层资源实体',
          x: 160,
          y: 35,
          estimatedInstances: 0,
          dataProperties: [
            {
              id: 'wiz-dp-1',
              name: 'catalogCode',
              label: '馆藏编号',
              datatype: 'xsd:string',
              required: true,
              indexed: true,
            },
          ],
        },
        {
          id: 'wiz-book',
          name: 'PaperBook',
          label: '纸质图书',
          parentId: 'wiz-item',
          layer: 'domain',
          description: '继承馆藏资源编号并具备 ISBN 的纸质实体书',
          disjointWith: ['wiz-reader'],
          x: 100,
          y: 165,
          estimatedInstances: 18000,
          dataProperties: [
            {
              id: 'wiz-dp-2',
              name: 'isbn',
              label: 'ISBN 编码',
              datatype: 'xsd:string',
              required: true,
              indexed: true,
            },
            {
              id: 'wiz-dp-3',
              name: 'title',
              label: '书名',
              datatype: 'xsd:string',
              required: true,
              indexed: false,
            },
          ],
        },
        {
          id: 'wiz-shelf',
          name: 'Bookshelf',
          label: '书架分区',
          parentId: 'wiz-item',
          layer: 'domain',
          description: '存放纸质图书的物理排架区域',
          x: 250,
          y: 165,
          estimatedInstances: 420,
          dataProperties: [
            {
              id: 'wiz-dp-4',
              name: 'zoneCode',
              label: '区位编码',
              datatype: 'xsd:string',
              indexed: true,
            },
          ],
        },
        {
          id: 'wiz-reader',
          name: 'Reader',
          label: '借阅读者',
          parentId: null,
          layer: 'domain',
          description: '持有借阅证并借出图书的自然人',
          disjointWith: ['wiz-book'],
          x: 410,
          y: 100,
          estimatedInstances: 6500,
          dataProperties: [
            {
              id: 'wiz-dp-5',
              name: 'cardId',
              label: '借书证号',
              datatype: 'xsd:string',
              required: true,
              indexed: true,
            },
            {
              id: 'wiz-dp-6',
              name: 'readerName',
              label: '读者姓名',
              datatype: 'xsd:string',
              indexed: false,
            },
          ],
        },
      ],
      objectProperties: [
        {
          id: 'wiz-op-1',
          name: 'placedOnShelf',
          label: '存放于书架',
          domainId: 'wiz-book',
          rangeId: 'wiz-shelf',
          cardinality: '1..1',
          functional: true,
        },
        {
          id: 'wiz-op-2',
          name: 'borrowedBy',
          label: '当前借阅人',
          domainId: 'wiz-book',
          rangeId: 'wiz-reader',
          cardinality: '0..1',
          functional: true,
          inverseOf: 'borrowsBook',
        },
        {
          id: 'wiz-op-3',
          name: 'borrowsBook',
          label: '借阅图书',
          domainId: 'wiz-reader',
          rangeId: 'wiz-book',
          cardinality: '0..*',
          inverseOf: 'borrowedBy',
        },
      ],
      shaclRules: [
        {
          id: 'wiz-sh-1',
          targetClassId: 'wiz-book',
          propertyName: 'isbn',
          constraintType: 'minCount',
          value: '1',
          severity: 'Violation',
          description: '纸质图书入库时必须填写 ISBN 编码',
        },
        {
          id: 'wiz-sh-2',
          targetClassId: 'wiz-reader',
          propertyName: 'cardId',
          constraintType: 'pattern',
          value: '^LIB-[0-9]{6}$',
          severity: 'Violation',
          description: '借书证号需符合 LIB-6位数字 格式',
        },
      ],
    }),
  },
  {
    id: 'enterprise',
    title: '企业组织与项目协作',
    badge: '常见业务 · 4 类 / 2 关系',
    createDraft: () => ({
      name: '企业组织与项目本体',
      prefix: 'org',
      namespace: 'https://onto.studio/org#',
      competencyQuestion: '某个研发项目由哪个部门负责？哪些员工参与了该项目？',
      classes: [
        {
          id: 'wiz-org-unit',
          name: 'OrgUnit',
          label: '组织单元',
          parentId: null,
          layer: 'upper',
          description: '企业内部行政或业务团队抽象实体',
          x: 150,
          y: 40,
          estimatedInstances: 0,
          dataProperties: [
            { id: 'wiz-e-dp1', name: 'unitCode', label: '编码', datatype: 'xsd:string', indexed: true },
          ],
        },
        {
          id: 'wiz-dept',
          name: 'Department',
          label: '业务部门',
          parentId: 'wiz-org-unit',
          layer: 'domain',
          description: '独立核算的正式职能部门',
          disjointWith: ['wiz-emp'],
          x: 150,
          y: 175,
          estimatedInstances: 48,
          dataProperties: [
            { id: 'wiz-e-dp2', name: 'deptName', label: '部门名称', datatype: 'xsd:string', required: true },
          ],
        },
        {
          id: 'wiz-emp',
          name: 'Employee',
          label: '正式员工',
          parentId: null,
          layer: 'domain',
          description: '在职员工实体',
          disjointWith: ['wiz-dept'],
          x: 390,
          y: 80,
          estimatedInstances: 1200,
          dataProperties: [
            { id: 'wiz-e-dp3', name: 'empId', label: '工号', datatype: 'xsd:string', required: true, indexed: true },
            { id: 'wiz-e-dp4', name: 'fullName', label: '姓名', datatype: 'xsd:string' },
          ],
        },
        {
          id: 'wiz-proj',
          name: 'Project',
          label: '研发项目',
          parentId: null,
          layer: 'domain',
          description: '跨团队交付的项目实体',
          x: 390,
          y: 230,
          estimatedInstances: 160,
          dataProperties: [
            { id: 'wiz-e-dp5', name: 'projName', label: '项目名称', datatype: 'xsd:string', required: true },
          ],
        },
      ],
      objectProperties: [
        {
          id: 'wiz-e-op1',
          name: 'belongsToDept',
          label: '所属部门',
          domainId: 'wiz-emp',
          rangeId: 'wiz-dept',
          cardinality: '1..1',
          functional: true,
        },
        {
          id: 'wiz-e-op2',
          name: 'participatesIn',
          label: '参与项目',
          domainId: 'wiz-emp',
          rangeId: 'wiz-proj',
          cardinality: '0..*',
        },
      ],
      shaclRules: [
        {
          id: 'wiz-e-sh1',
          targetClassId: 'wiz-emp',
          propertyName: 'empId',
          constraintType: 'minCount',
          value: '1',
          severity: 'Violation',
          description: '员工工号为必填字段',
        },
      ],
    }),
  },
  {
    id: 'blank',
    title: '从空白开始自定义',
    badge: '完全手写 · 0 → 1',
    createDraft: () => ({
      name: '',
      prefix: 'myonto',
      namespace: 'https://onto.studio/myonto#',
      competencyQuestion: '',
      classes: [],
      objectProperties: [],
      shaclRules: [],
    }),
  },
];

export function sanitizeSlugIdentifier(raw: string, fallback = 'Entity'): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return fallback;
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `C_${cleaned}`;
}

export function layoutBuilderClasses(classes: OntologyClass[]): OntologyClass[] {
  const cloned = classes.map((c) => ({
    ...c,
    dataProperties: c.dataProperties.map((dp) => ({ ...dp })),
    ...(c.disjointWith ? { disjointWith: [...c.disjointWith] } : {}),
  }));

  const byId = new Map(cloned.map((c) => [c.id, c]));
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
  for (const cls of cloned) {
    const d = getDepth(cls.id);
    const list = buckets.get(d) ?? [];
    list.push(cls);
    buckets.set(d, list);
  }

  const maxDepth = Math.max(0, ...buckets.keys());
  const width = 500;
  const height = 360;

  for (const [depth, list] of buckets.entries()) {
    const y = maxDepth === 0 ? 170 : 30 + (depth / maxDepth) * (height - 60);
    const count = list.length;
    list.forEach((cls, idx) => {
      cls.x = count === 1 ? width / 2 : 35 + (idx / (count - 1)) * (width - 70);
      cls.y = Math.round(y);
    });
  }

  return cloned;
}

export function buildPresetFromDraft(draft: BuilderDraft): DomainOntologyPreset {
  const cleanPrefix = sanitizeSlugIdentifier(draft.prefix || 'onto', 'onto').toLowerCase();
  const cleanName = draft.name.trim() || `${cleanPrefix} 自定义本体`;
  const cleanNamespace =
    draft.namespace.trim() || `https://onto.studio/${cleanPrefix}#`;
  const laidOutClasses = layoutBuilderClasses(draft.classes);

  const uniqueKey = `wizard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id: uniqueKey,
    key: uniqueKey,
    source: 'wizard',
    importedAt: new Date().toISOString().slice(0, 10),
    name: cleanName,
    namespace: cleanNamespace,
    prefix: cleanPrefix,
    upperStandard: 'http://www.w3.org/2002/07/owl#Thing',
    summary: `${laidOutClasses.length} 个类 / ${draft.objectProperties.length} 条对象属性`,
    classes: laidOutClasses,
    objectProperties: draft.objectProperties.map((op) => ({ ...op })),
    shaclRules: draft.shaclRules.map((r) => ({ ...r })),
  };
}

export function validateBuilderStep(
  step: number,
  draft: BuilderDraft,
): { valid: boolean; hint?: string } {
  if (step === 0) {
    if (!draft.name.trim()) {
      return { valid: false, hint: '请填写本体中文名称（或点击上方示例模板一键体验）' };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(draft.prefix.trim())) {
      return { valid: false, hint: '前缀需为英文字母开头的标识符（如 lib / org）' };
    }
    return { valid: true };
  }
  if (step === 1) {
    if (draft.classes.length === 0) {
      return { valid: false, hint: '请至少添加 1 个核心类（建议 2 个以上以便建立关系）' };
    }
    return { valid: true };
  }
  if (step === 2) {
    return { valid: true };
  }
  if (step === 3) {
    return { valid: true };
  }
  if (step === 4) {
    if (draft.classes.length === 0) {
      return { valid: false, hint: '请先在第 2 步添加至少 1 个类' };
    }
    return { valid: true };
  }
  return { valid: true };
}

export type BuilderStepLayerHint = OntologyLayerId;
export type BuilderDatatypeOption = OntologyDataProperty['datatype'];
