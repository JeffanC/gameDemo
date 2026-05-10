import type { Edge, GameNode, NodeId } from '../types';

export const RED_BASE: NodeId = 'RedBase';
export const NORTH_OUTPOST: NodeId = 'NorthOutpost';
export const CENTRAL_PASS: NodeId = 'CentralPass';
export const BLUE_BASE: NodeId = 'BlueBase';
export const SOUTH_FOREST: NodeId = 'SouthForest';
export const OLD_RELAY: NodeId = 'OldRelay';
export const EAST_WATCH: NodeId = 'EastWatch';

export const TEST_MAP_NODES: GameNode[] = [
  { id: RED_BASE, name: '红方基地', type: 'Base', neighbors: [NORTH_OUTPOST, SOUTH_FOREST] },
  { id: NORTH_OUTPOST, name: '北线前哨', type: 'Outpost', neighbors: [RED_BASE, CENTRAL_PASS] },
  { id: CENTRAL_PASS, name: '中央隘口', type: 'Pass', neighbors: [NORTH_OUTPOST, BLUE_BASE] },
  { id: BLUE_BASE, name: '蓝方基地', type: 'Base', neighbors: [CENTRAL_PASS, OLD_RELAY] },
  { id: SOUTH_FOREST, name: '南线林地', type: 'Forest', neighbors: [RED_BASE, OLD_RELAY] },
  { id: OLD_RELAY, name: '旧中继站', type: 'Relay', neighbors: [SOUTH_FOREST, BLUE_BASE, EAST_WATCH] },
  { id: EAST_WATCH, name: '东侧瞭望', type: 'Outpost', neighbors: [OLD_RELAY] },
];

export const TEST_MAP_EDGES: Edge[] = [
  { from: RED_BASE, to: NORTH_OUTPOST, move_cost: 1, intel_resistance: 1 },
  { from: NORTH_OUTPOST, to: CENTRAL_PASS, move_cost: 1, intel_resistance: 1 },
  { from: CENTRAL_PASS, to: BLUE_BASE, move_cost: 1, intel_resistance: 2 },
  { from: RED_BASE, to: SOUTH_FOREST, move_cost: 1, intel_resistance: 2 },
  { from: SOUTH_FOREST, to: OLD_RELAY, move_cost: 1, intel_resistance: 1 },
  { from: OLD_RELAY, to: BLUE_BASE, move_cost: 1, intel_resistance: 1 },
  { from: OLD_RELAY, to: EAST_WATCH, move_cost: 1, intel_resistance: 1 },
];
