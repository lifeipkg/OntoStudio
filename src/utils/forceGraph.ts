import type { OntologyClass, OntologyLayerId, OntologyObjectProperty } from '../types/ontology';

export interface ForceNodeState {
  id: string;
  label: string;
  name: string;
  layer: OntologyLayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
  dataPropertyCount: number;
}

export interface ForceEdge {
  id: string;
  source: string;
  target: string;
  kind: 'subClassOf' | 'objectProperty';
}

export interface ForceBounds {
  width: number;
  height: number;
}

const LAYER_RADIUS: Record<OntologyLayerId, number> = {
  upper: 34,
  domain: 31,
  constraint: 30,
  instance: 32,
};

/**
 * Splits a Chinese class label into 1 or 2 compact lines so it sits cleanly inside a sphere.
 */
export function splitSphereLabel(label: string): string[] {
  const clean = label.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (clean.length <= 4) {
    return [clean];
  }
  if (clean.length <= 8) {
    const mid = Math.ceil(clean.length / 2);
    return [clean.slice(0, mid), clean.slice(mid)];
  }
  return [clean.slice(0, 4), clean.slice(4, 9)];
}

/**
 * Seeds initial spherical node coordinates from preset layout coordinates scaled to canvas bounds.
 */
export function seedForceNodes(
  classes: OntologyClass[],
  bounds: ForceBounds,
  previousNodes?: Map<string, ForceNodeState>,
): ForceNodeState[] {
  if (classes.length === 0) return [];

  const xs = classes.map((c) => c.x);
  const ys = classes.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const padX = 56;
  const padY = 52;
  const usableW = Math.max(180, bounds.width - padX * 2);
  const usableH = Math.max(180, bounds.height - padY * 2);

  return classes.map((cls) => {
    const prev = previousNodes?.get(cls.id);
    const radius = cls.id === 'edu-entity' || cls.id === 'edu-class' ? 35 : LAYER_RADIUS[cls.layer];
    if (prev) {
      return {
        ...prev,
        label: cls.label,
        name: cls.name,
        layer: cls.layer,
        radius,
        dataPropertyCount: cls.dataProperties.length,
        x: Math.min(bounds.width - radius - 14, Math.max(radius + 14, prev.x)),
        y: Math.min(bounds.height - radius - 14, Math.max(radius + 14, prev.y)),
      };
    }

    const normX = spanX > 1 ? (cls.x - minX) / spanX : 0.5;
    const normY = spanY > 1 ? (cls.y - minY) / spanY : 0.5;

    return {
      id: cls.id,
      label: cls.label,
      name: cls.name,
      layer: cls.layer,
      x: padX + normX * usableW,
      y: padY + normY * usableH,
      vx: 0,
      vy: 0,
      radius,
      pinned: false,
      dataPropertyCount: cls.dataProperties.length,
    };
  });
}

/**
 * Builds simulation edges (inheritance + object properties) restricted to visible nodes.
 */
export function buildForceEdges(
  classes: OntologyClass[],
  objectProperties: OntologyObjectProperty[],
): ForceEdge[] {
  const visibleIds = new Set(classes.map((c) => c.id));
  const edges: ForceEdge[] = [];

  for (const cls of classes) {
    if (cls.parentId && visibleIds.has(cls.parentId)) {
      edges.push({
        id: `sub-${cls.id}`,
        source: cls.id,
        target: cls.parentId,
        kind: 'subClassOf',
      });
    }
  }

  for (const op of objectProperties) {
    if (visibleIds.has(op.domainId) && visibleIds.has(op.rangeId)) {
      edges.push({
        id: `op-${op.id}`,
        source: op.domainId,
        target: op.rangeId,
        kind: 'objectProperty',
      });
    }
  }

  return edges;
}

/**
 * Advances one frame of damped spring + repulsion + collision physics for spherical nodes.
 */
export function stepForceSimulation(
  nodes: ForceNodeState[],
  edges: ForceEdge[],
  bounds: ForceBounds,
  timeMs: number,
  options?: { ambientFloat?: boolean },
): ForceNodeState[] {
  const count = nodes.length;
  if (count === 0) return nodes;

  const next = nodes.map((n) => ({ ...n }));
  const byId = new Map(next.map((n) => [n.id, n]));
  const ambientFloat = options?.ambientFloat ?? true;

  // 1. Pairwise repulsion & sphere collision avoidance
  const extraGap = count > 14 ? 28 : 44;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const a = next[i];
      const b = next[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ux = dx / dist;
      const uy = dy / dist;

      const minSep = a.radius + b.radius + extraGap;
      let force = 3200 / (dist * dist + 240);
      if (dist < minSep) {
        force += (minSep - dist) * 0.16;
      }

      if (!a.pinned) {
        a.vx -= ux * force;
        a.vy -= uy * force;
      }
      if (!b.pinned) {
        b.vx += ux * force;
        b.vy += uy * force;
      }
    }
  }

  // 2. Spring attraction along edges
  const subRest = count > 14 ? 96 : 118;
  const relRest = count > 14 ? 124 : 156;
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const rest = edge.kind === 'subClassOf' ? subRest : relRest;
    const stiffness = edge.kind === 'subClassOf' ? 0.026 : 0.018;
    const spring = (dist - rest) * stiffness;
    const fx = (dx / dist) * spring;
    const fy = (dy / dist) * spring;

    if (!a.pinned) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.pinned) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // 3. Center gravity + gentle organic ambient float + damping + boundary clamp
  const cx = bounds.width / 2;
  const cy = bounds.height / 2;
  const damping = 0.82;
  const maxSpeed = 12;

  for (let i = 0; i < count; i++) {
    const node = next[i];
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    node.vx += (cx - node.x) * 0.0055;
    node.vy += (cy - node.y) * 0.0055;

    if (ambientFloat) {
      const phase = i * 1.37;
      node.vx += Math.sin(timeMs * 0.0014 + phase) * 0.045;
      node.vy += Math.cos(timeMs * 0.0012 + phase * 1.3) * 0.045;
    }

    node.vx *= damping;
    node.vy *= damping;

    const speed = Math.hypot(node.vx, node.vy);
    if (speed > maxSpeed) {
      node.vx = (node.vx / speed) * maxSpeed;
      node.vy = (node.vy / speed) * maxSpeed;
    }

    node.x += node.vx;
    node.y += node.vy;

    const minX = node.radius + 14;
    const maxX = Math.max(minX, bounds.width - node.radius - 14);
    const minY = node.radius + 14;
    const maxY = Math.max(minY, bounds.height - node.radius - 14);

    if (node.x < minX) {
      node.x = minX;
      node.vx *= -0.35;
    } else if (node.x > maxX) {
      node.x = maxX;
      node.vx *= -0.35;
    }

    if (node.y < minY) {
      node.y = minY;
      node.vy *= -0.35;
    } else if (node.y > maxY) {
      node.y = maxY;
      node.vy *= -0.35;
    }
  }

  return next;
}
