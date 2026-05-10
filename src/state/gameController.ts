import { TurnManager } from '../game/engine/TurnManager';
import type { EnemyScriptMode } from '../game/engine/scriptedEnemy';
import type { CrisisCorridor, NodeId, PlayerIntelState } from '../game/types';

let currentEnemyScriptMode: EnemyScriptMode = 'tutorial';
let currentEnemyScriptSeed = Date.now() % 100000;
let turnManager = new TurnManager({
  enemyScriptMode: currentEnemyScriptMode,
  enemyScriptSeed: currentEnemyScriptSeed,
});

export function initializeGame(): PlayerIntelState {
  return turnManager.getPlayerIntelState();
}

export function endTurn(): PlayerIntelState {
  return turnManager.endTurn();
}

export function blindAttack(targetNode: NodeId): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.queueBlindAttack(targetNode);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function queueAmbush(targetNode: NodeId): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.queueAmbush(targetNode);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function queueMoveUnit(sourceUnitId: string, targetNode: NodeId): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.queueMoveUnit(sourceUnitId, targetNode);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function queueCommanderRedeploy(targetNode: NodeId): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.queueCommanderRedeploy(targetNode);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function removeQueuedCommand(commandId: string): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.removeQueuedCommand(commandId);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function queueCrisisOrder(corridor: CrisisCorridor): { ok: boolean; next: PlayerIntelState } {
  const ok = turnManager.queueCrisisOrder(corridor);
  return { ok, next: turnManager.getPlayerIntelState() };
}

export function restartGame(mode?: EnemyScriptMode): PlayerIntelState {
  currentEnemyScriptMode = mode ?? currentEnemyScriptMode;
  currentEnemyScriptSeed = Date.now() % 100000;
  turnManager = new TurnManager({
    enemyScriptMode: currentEnemyScriptMode,
    enemyScriptSeed: currentEnemyScriptSeed,
  });
  return turnManager.getPlayerIntelState();
}
