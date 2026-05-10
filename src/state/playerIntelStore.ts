import { create } from 'zustand';
import type { EnemyScriptMode } from '../game/engine/scriptedEnemy';
import type { CrisisCorridor, NodeId, PlayerIntelState } from '../game/types';
import {
  blindAttack,
  endTurn,
  initializeGame,
  queueAmbush,
  queueCommanderRedeploy,
  queueCrisisOrder,
  queueMoveUnit,
  restartGame,
  removeQueuedCommand,
} from './gameController';

interface PlayerIntelStoreState {
  intel: PlayerIntelState;
  selectedNodeId?: NodeId;
  selectedReportId?: string;
  reviewMode: 'intel' | 'archive';
  endTurnAction: () => void;
  selectNode: (nodeId: NodeId) => void;
  selectReport: (reportId: string, nodeId: NodeId) => void;
  clearSelection: () => void;
  attackSelectedNode: () => boolean;
  queueAmbushSelectedNode: () => boolean;
  queueMoveUnitAction: (sourceUnitId: string, targetNode: NodeId) => boolean;
  queueCommanderRedeployAction: (targetNode: NodeId) => boolean;
  queueCrisisOrderAction: (corridor: CrisisCorridor) => boolean;
  removeQueuedCommandAction: (commandId: string) => boolean;
  setReviewMode: (mode: 'intel' | 'archive') => void;
  restartGameAction: (mode?: EnemyScriptMode) => void;
  toggleReviewMode: () => void;
}

const initialIntel = initializeGame();

export const usePlayerIntelStore = create<PlayerIntelStoreState>((set, get) => ({
  intel: initialIntel,
  selectedNodeId: undefined,
  selectedReportId: undefined,
  reviewMode: 'intel',
  endTurnAction: () => {
    const next = endTurn();
    set({ intel: next, selectedNodeId: undefined, selectedReportId: undefined });
  },
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedReportId: undefined }),
  selectReport: (reportId, nodeId) => set({ selectedReportId: reportId, selectedNodeId: nodeId }),
  clearSelection: () => set({ selectedNodeId: undefined, selectedReportId: undefined }),
  attackSelectedNode: () => {
    const state = get();
    if (!state.selectedNodeId) return false;
    const { ok, next } = blindAttack(state.selectedNodeId);
    set({ intel: next });
    return ok;
  },
  queueAmbushSelectedNode: () => {
    const state = get();
    if (!state.selectedNodeId) return false;
    const { ok, next } = queueAmbush(state.selectedNodeId);
    set({ intel: next });
    return ok;
  },
  queueMoveUnitAction: (sourceUnitId, targetNode) => {
    const { ok, next } = queueMoveUnit(sourceUnitId, targetNode);
    set({ intel: next });
    return ok;
  },
  queueCommanderRedeployAction: (targetNode) => {
    const { ok, next } = queueCommanderRedeploy(targetNode);
    set({ intel: next });
    return ok;
  },
  queueCrisisOrderAction: (corridor) => {
    const { ok, next } = queueCrisisOrder(corridor);
    set({ intel: next });
    return ok;
  },
  removeQueuedCommandAction: (commandId) => {
    const { ok, next } = removeQueuedCommand(commandId);
    set({ intel: next });
    return ok;
  },
  setReviewMode: (mode) => set({ reviewMode: mode }),
  restartGameAction: (mode) => {
    const next = restartGame(mode);
    set({
      intel: next,
      reviewMode: 'intel',
      selectedNodeId: undefined,
      selectedReportId: undefined,
    });
  },
  toggleReviewMode: () =>
    set((state) => ({ reviewMode: state.reviewMode === 'intel' ? 'archive' : 'intel' })),
}));
