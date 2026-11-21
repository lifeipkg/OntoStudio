import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OntologyClass, OntologyLayerId, OntologyObjectProperty } from '../types/ontology';
import {
  buildForceEdges,
  seedForceNodes,
  splitSphereLabel,
  stepForceSimulation,
  type ForceBounds,
  type ForceNodeState,
} from '../utils/forceGraph';

export type SchoolFocusTab = 'all' | 'assets' | 'schedule' | 'governance';

interface DynamicSphereGraphProps {
  classes: OntologyClass[];
  totalClassCount: number;
  objectProperties: OntologyObjectProperty[];
  prefix: string;
  selectedClassId: string;
  selectedPropertyId: string | null;
  schoolFocus: SchoolFocusTab;
  showSchoolFocusTabs?: boolean;
  onChangeFocus: (tab: SchoolFocusTab, defaultClassId?: string) => void;
  onSelectClass: (id: string) => void;
  onSelectProperty: (id: string | null) => void;
}

const SPHERE_STROKE: Record<OntologyLayerId, string> = {
  upper: '#64748b',
  domain: '#2563eb',
  constraint: '#d97706',
  instance: '#059669',
};

const SPHERE_GRADIENT: Record<OntologyLayerId, string> = {
  upper: 'url(#sphere-upper)',
  domain: 'url(#sphere-domain)',
  constraint: 'url(#sphere-constraint)',
  instance: 'url(#sphere-instance)',
};

const FOCUS_TABS: Array<{
  id: SchoolFocusTab;
  label: string;
  defaultClass?: string;
}> = [
  { id: 'all', label: '全校总览' },
  { id: 'assets', label: '班级物资 (扫帚/拖把/教科书)', defaultClass: 'edu-broom' },
  { id: 'schedule', label: '课程·教师·操场分配', defaultClass: 'edu-course-sch' },
  { id: 'governance', label: '教导处·学生会·纪律编排', defaultClass: 'edu-disc-roster' },
];

export function DynamicSphereGraph({
  classes,
  totalClassCount,
  objectProperties,
  prefix,
  selectedClassId,
  selectedPropertyId,
  schoolFocus,
  showSchoolFocusTabs = true,
  onChangeFocus,
  onSelectClass,
  onSelectProperty,
}: DynamicSphereGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [bounds, setBounds] = useState<ForceBounds>({ width: 660, height: 520 });
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const dragMetaRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const nodesRef = useRef<ForceNodeState[]>(seedForceNodes(classes, { width: 660, height: 520 }));
  const [nodes, setNodes] = useState<ForceNodeState[]>(() => nodesRef.current);

  const edges = useMemo(
    () => buildForceEdges(classes, objectProperties),
    [classes, objectProperties],
  );

  // Track container width responsively
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateBounds = () => {
      const w = Math.max(320, Math.round(el.clientWidth));
      const h = schoolFocus === 'all' ? 520 : 450;
      setBounds((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [schoolFocus]);

  // Re-seed nodes cleanly when focus tab, class list, or bounds change
  const classSignature = useMemo(
    () => classes.map((c) => `${c.id}:${c.dataProperties.length}`).join('|'),
    [classes],
  );
  const prevFocusRef = useRef<SchoolFocusTab>(schoolFocus);

  useEffect(() => {
    const focusChanged = prevFocusRef.current !== schoolFocus;
    prevFocusRef.current = schoolFocus;
    const prevMap = focusChanged ? undefined : new Map(nodesRef.current.map((n) => [n.id, n]));
    const seeded = seedForceNodes(classes, bounds, prevMap);
    nodesRef.current = seeded;
    setNodes(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classSignature, bounds.width, bounds.height, schoolFocus]);

  // Respect prefers-reduced-motion for ambient float, while still allowing drag physics
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Animation loop for dynamic spherical physics
  useEffect(() => {
    if (!isRunning) return;
    let rafId = 0;

    const tick = (timeMs: number) => {
      const stepped = stepForceSimulation(nodesRef.current, edges, bounds, timeMs, {
        ambientFloat: !prefersReducedMotion,
      });
      nodesRef.current = stepped;
      setNodes(stepped);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [isRunning, edges, bounds, prefersReducedMotion]);

  const handleResetLayout = useCallback(() => {
    const reset = seedForceNodes(classes, bounds);
    nodesRef.current = reset;
    setNodes(reset);
    setIsRunning(true);
  }, [classes, bounds]);

  const toSvgCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: bounds.width / 2, y: bounds.height / 2 };
    const rect = svg.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleNodePointerDown = (e: React.PointerEvent<SVGGElement>, nodeId: string) => {
    e.stopPropagation();
    const targetNode = nodesRef.current.find((n) => n.id === nodeId);
    if (!targetNode) return;

    const pt = toSvgCoords(e.clientX, e.clientY);
    dragMetaRef.current = {
      id: nodeId,
      offsetX: targetNode.x - pt.x,
      offsetY: targetNode.y - pt.y,
      startX: pt.x,
      startY: pt.y,
    };
    setDraggingId(nodeId);
    onSelectClass(nodeId);
    onSelectProperty(null);

    nodesRef.current = nodesRef.current.map((n) =>
      n.id === nodeId ? { ...n, pinned: true, vx: 0, vy: 0 } : n,
    );
    setNodes(nodesRef.current);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragMetaRef.current;
    if (!drag) return;
    const pt = toSvgCoords(e.clientX, e.clientY);

    nodesRef.current = nodesRef.current.map((n) => {
      if (n.id !== drag.id) return n;
      const clampedX = Math.min(
        bounds.width - n.radius - 12,
        Math.max(n.radius + 12, pt.x + drag.offsetX),
      );
      const clampedY = Math.min(
        bounds.height - n.radius - 12,
        Math.max(n.radius + 12, pt.y + drag.offsetY),
      );
      return {
        ...n,
        x: clampedX,
        y: clampedY,
        vx: 0,
        vy: 0,
      };
    });

    if (!isRunning) {
      setNodes(nodesRef.current);
    }
  };

  const handleSvgPointerUp = () => {
    const drag = dragMetaRef.current;
    if (!drag) return;
    dragMetaRef.current = null;
    setDraggingId(null);
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === drag.id ? { ...n, pinned: false } : n,
    );
    setNodes(nodesRef.current);
  };

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const focusNodeId = hoveredId ?? selectedClassId;

  const neighborIds = useMemo(() => {
    const set = new Set<string>([focusNodeId]);
    for (const op of objectProperties) {
      if (op.domainId === focusNodeId) set.add(op.rangeId);
      if (op.rangeId === focusNodeId) set.add(op.domainId);
    }
    for (const cls of classes) {
      if (cls.id === focusNodeId && cls.parentId) set.add(cls.parentId);
      if (cls.parentId === focusNodeId) set.add(cls.id);
    }
    return set;
  }, [focusNodeId, objectProperties, classes]);

  const visibleObjectProperties = useMemo(
    () =>
      objectProperties.filter(
        (op) => nodeMap.has(op.domainId) && nodeMap.has(op.rangeId),
      ),
    [objectProperties, nodeMap],
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Canvas Header & Controls */}
      <div className="px-4 py-3 border-b border-slate-200 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">动态球体语义图谱</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRunning((r) => !r)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap transition-colors"
            >
              {isRunning ? (
                <>
                  <Pause className="w-3 h-3" aria-hidden="true" />
                  <span>暂停动态</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" aria-hidden="true" />
                  <span>继续动态</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleResetLayout}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap transition-colors"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>重置分布</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {showSchoolFocusTabs ? (
            <div
              className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
              role="group"
              aria-label="学校本体模块聚焦"
            >
              {FOCUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChangeFocus(tab.id, tab.defaultClass)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${
                    schoolFocus === tab.id
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.id === 'all' ? `${tab.label} (${totalClassCount}类)` : tab.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs font-mono text-slate-600 tabular-nums">
              全部类节点 ({totalClassCount} 类 / {objectProperties.length} 关系)
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>虚线: subClassOf</span>
            <span>实线: ObjectProperty</span>
          </div>
        </div>
      </div>

      {/* Interactive Physics SVG Stage */}
      <div
        ref={containerRef}
        className="relative bg-slate-50/70 select-none overflow-hidden"
        data-testid="dynamic-sphere-canvas"
        data-physics-running={isRunning ? 'true' : 'false'}
      >
        <svg
          ref={svgRef}
          width={bounds.width}
          height={bounds.height}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
          className="block w-full touch-none"
        >
          <defs>
            <pattern id="onto-sphere-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2e8f0" strokeWidth="0.6" />
            </pattern>

            <radialGradient id="sphere-upper" cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </radialGradient>
            <radialGradient id="sphere-domain" cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#dbeafe" />
              <stop offset="100%" stopColor="#93c5fd" />
            </radialGradient>
            <radialGradient id="sphere-constraint" cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#fef3c7" />
              <stop offset="100%" stopColor="#fcd34d" />
            </radialGradient>
            <radialGradient id="sphere-instance" cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#d1fae5" />
              <stop offset="100%" stopColor="#6ee7b7" />
            </radialGradient>
            <radialGradient id="sphere-selected" cx="32%" cy="28%" r="72%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="50%" stopColor="#bfdbfe" />
              <stop offset="100%" stopColor="#60a5fa" />
            </radialGradient>

            <filter id="sphere-drop" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.12" />
            </filter>

            <marker
              id="arrow-sub"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M 0 0.8 L 6.5 3.5 L 0 6.2 z" fill="#94a3b8" />
            </marker>
            <marker
              id="arrow-rel"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M 0 0.8 L 6.5 3.5 L 0 6.2 z" fill="#2563eb" />
            </marker>
            <marker
              id="arrow-rel-muted"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M 0 0.8 L 6.5 3.5 L 0 6.2 z" fill="#64748b" />
            </marker>
          </defs>

          <rect width="100%" height="100%" fill="url(#onto-sphere-grid)" />

          {/* Inheritance (subClassOf) Edges */}
          {classes.map((cls) => {
            if (!cls.parentId) return null;
            const child = nodeMap.get(cls.id);
            const parent = nodeMap.get(cls.parentId);
            if (!child || !parent) return null;

            const dx = parent.x - child.x;
            const dy = parent.y - child.y;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            const x1 = child.x + ux * child.radius;
            const y1 = child.y + uy * child.radius;
            const x2 = parent.x - ux * (parent.radius + 3);
            const y2 = parent.y - uy * (parent.radius + 3);

            const isFocused =
              hoveredId !== null
                ? child.id === hoveredId || parent.id === hoveredId
                : child.id === selectedClassId || parent.id === selectedClassId;

            return (
              <line
                key={`sub-${cls.id}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#94a3b8"
                strokeWidth={isFocused ? 1.6 : 1.1}
                strokeDasharray="4 3"
                opacity={hoveredId && !isFocused ? 0.25 : 0.72}
                markerEnd="url(#arrow-sub)"
              />
            );
          })}

          {/* Object Property Edges */}
          {visibleObjectProperties.map((op, idx) => {
            const from = nodeMap.get(op.domainId)!;
            const to = nodeMap.get(op.rangeId)!;
            const isRelated = selectedPropertyId
              ? op.id === selectedPropertyId
              : op.domainId === focusNodeId || op.rangeId === focusNodeId;

            const strokeColor = isRelated ? '#2563eb' : '#64748b';
            const edgeOpacity = selectedPropertyId
              ? isRelated
                ? 0.98
                : 0.2
              : hoveredId
                ? isRelated
                  ? 0.98
                  : 0.18
                : isRelated
                  ? 0.95
                  : 0.45;

            if (from.id === to.id) {
              const sx = from.x + from.radius * 0.65;
              const sy = from.y - from.radius * 0.75;
              const pathD = `M ${sx} ${sy} C ${sx + 28} ${sy - 32}, ${sx - 28} ${sy - 32}, ${sx - 18} ${sy}`;
              return (
                <g key={op.id} opacity={edgeOpacity}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isRelated ? 1.9 : 1.2}
                    markerEnd={isRelated ? 'url(#arrow-rel)' : 'url(#arrow-rel-muted)'}
                  />
                  <text
                    x={sx - 4}
                    y={sy - 26}
                    textAnchor="middle"
                    fontSize="9.5"
                    fontWeight="600"
                    fill={strokeColor}
                  >
                    {op.label}
                  </text>
                </g>
              );
            }

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            const x1 = from.x + ux * from.radius;
            const y1 = from.y + uy * from.radius;
            const x2 = to.x - ux * (to.radius + 3);
            const y2 = to.y - uy * (to.radius + 3);

            // Perpendicular bow for organic curved connection
            const bow = (idx % 2 === 0 ? 1 : -1) * Math.min(28, dist * 0.14);
            const cx = (x1 + x2) / 2 - uy * bow;
            const cy = (y1 + y2) / 2 + ux * bow;
            const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

            const lx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
            const ly = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
            const showLabel =
              totalClassCount <= 10 ||
              schoolFocus !== 'all' ||
              selectedPropertyId === op.id ||
              (hoveredId !== null && (op.domainId === hoveredId || op.rangeId === hoveredId));
            const labelW = Math.max(70, Math.round(op.label.length * 10 + 16));

            return (
              <g key={op.id} opacity={edgeOpacity}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isRelated ? 2 : 1.2}
                  markerEnd={isRelated ? 'url(#arrow-rel)' : 'url(#arrow-rel-muted)'}
                />

                {isRelated && isRunning && !prefersReducedMotion && (
                  <circle r="2.8" fill="#2563eb">
                    <animateMotion dur="2.2s" repeatCount="indefinite" path={pathD} />
                  </circle>
                )}

                {showLabel && (
                  <>
                    <rect
                      x={lx - labelW / 2}
                      y={ly - 8}
                      width={labelW}
                      height="16"
                      rx="3"
                      fill="#ffffff"
                      stroke={isRelated ? '#93c5fd' : '#e2e8f0'}
                      strokeWidth="0.9"
                    />
                    <text
                      x={lx}
                      y={ly + 3}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontWeight="600"
                      fill={isRelated ? '#1d4ed8' : '#475569'}
                    >
                      {op.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Dynamic Spherical Nodes */}
          {nodes.map((node) => {
            const isSelected = node.id === selectedClassId;
            const isHovered = node.id === hoveredId;
            const isDragging = node.id === draggingId;
            const isConnected = neighborIds.has(node.id);
            const dimmed = hoveredId !== null && !isConnected;
            const lines = splitSphereLabel(node.label);
            const showUri = schoolFocus !== 'all' || isSelected || isHovered;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${node.label} (${prefix}:${node.name})`}
                onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectClass(node.id);
                    onSelectProperty(null);
                  }
                }}
                opacity={dimmed ? 0.35 : 1}
                className={isDragging ? 'cursor-grabbing outline-none' : 'cursor-grab outline-none'}
                data-testid={`sphere-node-${node.id}`}
              >
                {/* Selection / Active Halo Ring */}
                {isSelected && (
                  <circle
                    r={node.radius + 5}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    opacity="0.7"
                  />
                )}

                {/* 3D Ceramic Sphere Body */}
                <circle
                  r={node.radius}
                  fill={isSelected ? 'url(#sphere-selected)' : SPHERE_GRADIENT[node.layer]}
                  stroke={isSelected ? '#2563eb' : isHovered ? '#3b82f6' : SPHERE_STROKE[node.layer]}
                  strokeWidth={isSelected ? 2.4 : isHovered ? 1.8 : 1.2}
                  filter="url(#sphere-drop)"
                />

                {/* Specular Top-Left Glint */}
                <ellipse
                  cx={-node.radius * 0.28}
                  cy={-node.radius * 0.32}
                  rx={node.radius * 0.26}
                  ry={node.radius * 0.14}
                  transform={`rotate(-25 ${-node.radius * 0.28} ${-node.radius * 0.32})`}
                  fill="#ffffff"
                  opacity="0.65"
                  pointerEvents="none"
                />

                {/* Crisp Centered Chinese Concept Label */}
                {lines.length === 1 ? (
                  <text
                    y="4"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#0f172a"
                    pointerEvents="none"
                  >
                    {lines[0]}
                  </text>
                ) : (
                  <>
                    <text
                      y="-3"
                      textAnchor="middle"
                      fontSize="10.5"
                      fontWeight="700"
                      fill="#0f172a"
                      pointerEvents="none"
                    >
                      {lines[0]}
                    </text>
                    <text
                      y="10"
                      textAnchor="middle"
                      fontSize="10.5"
                      fontWeight="700"
                      fill="#0f172a"
                      pointerEvents="none"
                    >
                      {lines[1]}
                    </text>
                  </>
                )}

                {/* Subtle URI identifier below sphere when focused or in subgraph */}
                {showUri && (
                  <text
                    y={node.radius + 14}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="'JetBrains Mono', monospace"
                    fontWeight="500"
                    fill={isSelected ? '#1d4ed8' : '#475569'}
                    stroke="#f8fafc"
                    strokeWidth="3.5"
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {prefix}:{node.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
