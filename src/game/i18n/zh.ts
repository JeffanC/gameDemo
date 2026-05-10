import type { CrisisCorridor, GameCommand, GameNode, NodeId } from '../types';

/** 节点 ID → 界面展示名（逻辑 ID 仍为英文） */
export const NODE_DISPLAY: Record<string, string> = {
  RedBase: '红方基地',
  NorthOutpost: '北线前哨',
  CentralPass: '中央隘口',
  BlueBase: '蓝方基地',
  SouthForest: '南线林地',
  OldRelay: '旧中继站',
  EastWatch: '东侧瞭望',
};

export function formatNode(nodeId: NodeId): string {
  return NODE_DISPLAY[nodeId] ?? nodeId;
}

export function formatUnitType(t: string): string {
  const map: Record<string, string> = {
    commander: '主帅',
    infantry: '步兵',
    cavalry: '骑兵',
    artillery: '炮兵',
    scout: '侦察哨',
  };
  return map[t] ?? t;
}

export function formatCommandType(t: GameCommand['type']): string {
  const map: Record<GameCommand['type'], string> = {
    MOVE: '移动',
    BLIND_STRIKE: '盲打',
    INTERCEPT: '拦截',
    AMBUSH: '设伏',
    SCOUT: '侦察',
    CRISIS_ORDER: '烽火总令',
  };
  return map[t] ?? t;
}

export function formatCorridor(c: CrisisCorridor): string {
  return c === 'north' ? '北线' : '南线';
}

export function formatConfidence(c: 'high' | 'medium' | 'low'): string {
  const map = { high: '高', medium: '中', low: '低' } as const;
  return map[c];
}

export function formatOutcome(o: 'executed' | 'failed' | 'voided'): string {
  const map = { executed: '已执行', failed: '未达成', voided: '已作废' } as const;
  return map[o];
}

export function formatTerrainType(t: GameNode['type']): string {
  const map: Record<GameNode['type'], string> = {
    Base: '基地',
    Outpost: '前哨',
    Pass: '隘口',
    Forest: '林地',
    Relay: '中继站',
  };
  return map[t] ?? t;
}

export function formatAnomalyFlag(flag: string): string {
  const map: Record<string, string> = {
    comm_lost: '通讯中断',
    source_unavailable: '单位不可用',
    stale_intel_possible: '情报可能过期',
    crisis_overdrive: '危机情报过载',
    signal_shadow: '信号阴影',
    route_blocked: '路线受阻',
    screening_lost: '护卫点失联',
    meeting_engagement: '遭遇战',
  };
  return map[flag] ?? flag;
}
