import type { NodeId } from '../types';
import {
  BLUE_BASE,
  CENTRAL_PASS,
  EAST_WATCH,
  NORTH_OUTPOST,
  OLD_RELAY,
  RED_BASE,
  SOUTH_FOREST,
} from '../map/testMap7';

export type EnemyScriptMode = 'tutorial' | 'standard' | 'pressure' | 'voided_demo' | 'default';

export interface EnemyScriptScenario {
  label: string;
  brief: string;
}

export interface EnemyScriptPlan extends EnemyScriptScenario {
  mode: EnemyScriptMode;
  seed: number;
  routes: Record<string, NodeId[]>;
}

export const PLAYABLE_ENEMY_SCRIPT_MODES: EnemyScriptMode[] = ['tutorial', 'standard', 'pressure'];

export const SCRIPTED_ENEMY_SCENARIOS: Record<EnemyScriptMode, EnemyScriptScenario> = {
  default: {
    label: '教学线',
    brief: '固定骑兵穿插，强制制造一次旧照片误判。',
  },
  tutorial: {
    label: '教学线',
    brief: '固定骑兵穿插，强制制造一次旧照片误判。',
  },
  standard: {
    label: '标准线',
    brief: '骑兵和步兵分路推进，带一个种子锁定的轻分支。',
  },
  pressure: {
    label: '压力线',
    brief: '骑兵更早绕后，逼迫玩家重视主帅、防线和烽火总令。',
  },
  voided_demo: {
    label: '作废演示',
    brief: '内部测试用：验证前线单位失联导致命令作废。',
  },
};

function normalizeMode(mode: EnemyScriptMode): EnemyScriptMode {
  return mode === 'default' ? 'tutorial' : mode;
}

function route(maxTurn: number, nodes: NodeId[]): NodeId[] {
  const last = nodes[nodes.length - 1];
  return Array.from({ length: maxTurn }, (_, index) => nodes[index] ?? last);
}

function seededBranch(seed: number, salt: number): boolean {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2246822507) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489909) >>> 0;
  return ((value ^ (value >>> 16)) & 1) === 1;
}

export function createEnemyScriptPlan(
  mode: EnemyScriptMode = 'tutorial',
  seed = 1707,
  maxTurn = 10,
): EnemyScriptPlan {
  const normalized = normalizeMode(mode);
  const scenario = SCRIPTED_ENEMY_SCENARIOS[normalized];
  const commander = route(maxTurn, [BLUE_BASE]);

  if (normalized === 'voided_demo') {
    return {
      mode: normalized,
      seed,
      ...scenario,
      routes: {
        'E-CMD-1': commander,
        'E-CAV-1': route(maxTurn, [CENTRAL_PASS, SOUTH_FOREST, NORTH_OUTPOST]),
        'E-INF-1': route(maxTurn, [BLUE_BASE, CENTRAL_PASS, CENTRAL_PASS, NORTH_OUTPOST]),
      },
    };
  }

  if (normalized === 'pressure') {
    return {
      mode: normalized,
      seed,
      ...scenario,
      routes: {
        'E-CMD-1': commander,
        'E-CAV-1': route(maxTurn, [CENTRAL_PASS, OLD_RELAY, SOUTH_FOREST, RED_BASE]),
        'E-INF-1': route(maxTurn, [BLUE_BASE, CENTRAL_PASS, NORTH_OUTPOST, NORTH_OUTPOST, RED_BASE]),
      },
    };
  }

  if (normalized === 'standard') {
    const southFeint = seededBranch(seed, 0x51a7);
    return {
      mode: normalized,
      seed,
      ...scenario,
      routes: {
        'E-CMD-1': commander,
        'E-CAV-1': southFeint
          ? route(maxTurn, [CENTRAL_PASS, OLD_RELAY, EAST_WATCH, OLD_RELAY, SOUTH_FOREST, RED_BASE])
          : route(maxTurn, [NORTH_OUTPOST, CENTRAL_PASS, OLD_RELAY, SOUTH_FOREST, RED_BASE]),
        'E-INF-1': southFeint
          ? route(maxTurn, [BLUE_BASE, OLD_RELAY, OLD_RELAY, SOUTH_FOREST, SOUTH_FOREST])
          : route(maxTurn, [BLUE_BASE, BLUE_BASE, CENTRAL_PASS, NORTH_OUTPOST, NORTH_OUTPOST]),
      },
    };
  }

  return {
    mode: normalized,
    seed,
    ...scenario,
    routes: {
      'E-CMD-1': commander,
      'E-CAV-1': route(maxTurn, [NORTH_OUTPOST, CENTRAL_PASS, OLD_RELAY, SOUTH_FOREST, RED_BASE]),
      'E-INF-1': route(maxTurn, [BLUE_BASE, BLUE_BASE, CENTRAL_PASS, CENTRAL_PASS, NORTH_OUTPOST]),
    },
  };
}

export function getScriptedEnemyNodeFromPlan(plan: EnemyScriptPlan, unitId: string, turn: number): NodeId {
  const unitRoute = plan.routes[unitId] ?? plan.routes['E-CAV-1'];
  return unitRoute[Math.max(0, Math.min(turn - 1, unitRoute.length - 1))];
}

export function getScriptedEnemyNode(
  unitId: string,
  turn: number,
  mode: EnemyScriptMode = 'tutorial',
  seed = 1707,
): NodeId {
  return getScriptedEnemyNodeFromPlan(createEnemyScriptPlan(mode, seed), unitId, turn);
}
