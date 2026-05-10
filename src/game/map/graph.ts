import type { Edge, NodeId } from '../types';
import { RED_BASE } from './testMap7';

interface QueueItem {
  node: NodeId;
  cost: number;
}

export function getIntelDelayToPlayerBase(edges: Edge[], targetNode: NodeId): number {
  if (targetNode === RED_BASE) {
    return 0;
  }

  const adjacency = new Map<NodeId, Array<{ to: NodeId; resistance: number }>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push({ to: edge.to, resistance: edge.intel_resistance });
    adjacency.get(edge.to)!.push({ to: edge.from, resistance: edge.intel_resistance });
  }

  const distances = new Map<NodeId, number>([[targetNode, 0]]);
  const queue: QueueItem[] = [{ node: targetNode, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (current.node === RED_BASE) {
      return Math.max(1, current.cost);
    }
    const nextEdges = adjacency.get(current.node) ?? [];
    for (const next of nextEdges) {
      const newCost = current.cost + next.resistance;
      const oldCost = distances.get(next.to);
      if (oldCost === undefined || newCost < oldCost) {
        distances.set(next.to, newCost);
        queue.push({ node: next.to, cost: newCost });
      }
    }
  }

  return 2;
}

export function getNodeHopDistance(edges: Edge[], fromNode: NodeId, toNode: NodeId): number {
  if (fromNode === toNode) return 0;

  const adjacency = new Map<NodeId, NodeId[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
  }

  const visited = new Set<NodeId>([fromNode]);
  const queue: QueueItem[] = [{ node: fromNode, cost: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current.node) ?? []) {
      if (visited.has(next)) continue;
      const cost = current.cost + 1;
      if (next === toNode) return cost;
      visited.add(next);
      queue.push({ node: next, cost });
    }
  }

  return 4;
}

export function getIntelDelayToCommander(edges: Edge[], targetNode: NodeId, commanderNode: NodeId): number {
  return getNodeHopDistance(edges, targetNode, commanderNode);
}
