import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  playCommit,
  playIntelChime,
  playTension,
  playTurnResolve,
  playUiTick,
  setAmbientEnabled,
  unlockAudio,
} from './atmosphere/sfx';
import {
  PLAYABLE_ENEMY_SCRIPT_MODES,
  SCRIPTED_ENEMY_SCENARIOS,
  type EnemyScriptMode,
} from './game/engine/scriptedEnemy';
import {
  formatAnomalyFlag,
  formatCommandType,
  formatConfidence,
  formatCorridor,
  formatNode,
  formatOutcome,
  formatTerrainType,
  formatUnitType,
} from './game/i18n/zh';
import { BLUE_BASE, EAST_WATCH, TEST_MAP_EDGES, TEST_MAP_NODES } from './game/map/testMap7';
import { TEST_MAP_LAYOUT } from './game/map/layout';
import { getNodeHopDistance } from './game/map/graph';
import { usePlayerIntelStore } from './state/playerIntelStore';
import type { AuditEntry, CrisisCorridor, FriendlyUnitIntel, IntelReport, NodeSignalIntel, PlayerIntelState } from './game/types';

/** 地图氛围：偏上 cold = 敌方压力，偏下 warm = 我方核心区，其余为 contested */
const ENEMY_ZONE = new Set(['BlueBase', 'CentralPass', 'EastWatch', 'OldRelay']);
const HOME_ZONE = new Set(['RedBase', 'SouthForest']);
const ARTILLERY_RANGE_HOPS = 2;

interface TimelineItem {
  key: string;
  turn: number;
  phase: string;
  eventType: AuditEntry['event_type'];
  title: string;
  body: string;
  tone: string;
  count: number;
}

interface AdvisorMessage {
  key: string;
  speaker: 'zero7' | 'sergeant';
  title: string;
  text: string;
}

interface ActionHint {
  title: string;
  body: string;
  tone: string;
}

function mapNodeButtonClass(nodeId: string, selected: boolean): string {
  const base =
    'touch-target absolute h-[4.65rem] w-[6.05rem] max-w-[42vw] -translate-x-1/2 -translate-y-1/2 rounded border px-1 text-center text-[10px] leading-tight transition-all duration-200 md:h-[5.35rem] md:w-[7rem] md:text-[11px] ';
  const zone = HOME_ZONE.has(nodeId)
    ? 'border-emerald-800/90 bg-emerald-950/50 shadow-[inset_0_0_24px_rgba(16,185,129,0.12)] '
    : ENEMY_ZONE.has(nodeId)
      ? 'border-sky-800/80 bg-slate-950/60 shadow-[inset_0_0_24px_rgba(14,165,233,0.1)] '
      : 'border-amber-800/60 bg-slate-900/85 shadow-[inset_0_0_18px_rgba(245,158,11,0.08)] ';
  const sel = selected
    ? 'war-node-selected z-10 border-amber-300 bg-slate-700/95 ring-2 ring-amber-400/40 '
    : 'hover:border-slate-300 hover:brightness-110 active:scale-[0.96] ';
  return base + zone + sel;
}

function signalNodeOverlayClass(signal?: NodeSignalIntel): string {
  if (signal?.state === 'contested') {
    return 'war-node-contested border-rose-500/90 bg-rose-950/45 shadow-[inset_0_0_28px_rgba(244,63,94,0.18),0_0_22px_rgba(244,63,94,0.18)] ';
  }
  if (signal?.state === 'jammed') {
    return 'war-node-jammed border-fuchsia-900/70 bg-slate-950/75 grayscale-[0.35] opacity-80 ';
  }
  return '';
}

export default function App() {
  const edgeGlowFilterId = useId().replace(/:/g, '');
  const intel = usePlayerIntelStore((s) => s.intel);
  const selectedNodeId = usePlayerIntelStore((s) => s.selectedNodeId);
  const selectedReportId = usePlayerIntelStore((s) => s.selectedReportId);
  const reviewMode = usePlayerIntelStore((s) => s.reviewMode);
  const endTurnAction = usePlayerIntelStore((s) => s.endTurnAction);
  const selectNode = usePlayerIntelStore((s) => s.selectNode);
  const selectReport = usePlayerIntelStore((s) => s.selectReport);
  const attackSelectedNode = usePlayerIntelStore((s) => s.attackSelectedNode);
  const queueAmbushSelectedNode = usePlayerIntelStore((s) => s.queueAmbushSelectedNode);
  const queueMoveUnitAction = usePlayerIntelStore((s) => s.queueMoveUnitAction);
  const queueCommanderRedeployAction = usePlayerIntelStore((s) => s.queueCommanderRedeployAction);
  const queueCrisisOrderAction = usePlayerIntelStore((s) => s.queueCrisisOrderAction);
  const removeQueuedCommandAction = usePlayerIntelStore((s) => s.removeQueuedCommandAction);
  const setReviewMode = usePlayerIntelStore((s) => s.setReviewMode);
  const restartGameAction = usePlayerIntelStore((s) => s.restartGameAction);
  const toggleReviewMode = usePlayerIntelStore((s) => s.toggleReviewMode);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  const [crisisModalOpen, setCrisisModalOpen] = useState(false);
  const [crisisCorridor, setCrisisCorridor] = useState<CrisisCorridor>('north');
  const [gameOverOverlayOpen, setGameOverOverlayOpen] = useState(false);
  const [signalDrawerOpen, setSignalDrawerOpen] = useState(false);
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false);
  const [sfxOn, setSfxOn] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('war_sfx') === '1' : false,
  );
  const [ambientOn, setAmbientOn] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('war_ambient') === '1' : false,
  );
  const [turnResolving, setTurnResolving] = useState(false);
  const [advisorText, setAdvisorText] = useState('');
  const [selectedFriendlyUnitId, setSelectedFriendlyUnitId] = useState('P-INF-1');

  const intelInitRef = useRef(false);
  const prevIntelLenRef = useRef(0);
  const prevTurnForResetRef = useRef(intel.visible_turn);
  const terminalScrollRef = useRef<HTMLElement | null>(null);

  const selectedReport = intel.visible_reports.find((r) => r.report_id === selectedReportId);
  const commander = intel.friendly_units.find((u) => u.unit_type === 'commander');
  const commanderNode = commander?.position_node ?? 'RedBase';
  const artillery = intel.friendly_units.find((u) => u.unit_type === 'artillery');
  const cavalry = intel.friendly_units.find((u) => u.unit_id === 'P-CAV-1');
  const activeFriendlyUnits = useMemo(() => intel.friendly_units.filter((u) => u.hp > 0), [intel.friendly_units]);
  const projectedFriendlyPositions = useMemo(() => {
    const projected = new Map(activeFriendlyUnits.map((unit) => [unit.unit_id, unit.position_node]));
    for (const command of intel.queued_commands) {
      if (command.type === 'MOVE' && command.source_unit && command.source_unit !== 'P-CMD-1') {
        projected.set(command.source_unit, command.target_node);
      }
    }
    return projected;
  }, [activeFriendlyUnits, intel.queued_commands]);
  const selectedFriendlyUnit =
    activeFriendlyUnits.find((u) => u.unit_id === selectedFriendlyUnitId) ??
    activeFriendlyUnits.find((u) => u.unit_type !== 'commander') ??
    activeFriendlyUnits[0];
  const selectedNodeIntelDelay = selectedNodeId
    ? getNodeHopDistance(TEST_MAP_EDGES, selectedNodeId, commanderNode)
    : undefined;
  const selectedUnitMoveDistance =
    selectedNodeId && selectedFriendlyUnit
      ? getNodeHopDistance(TEST_MAP_EDGES, selectedFriendlyUnit.position_node, selectedNodeId)
      : undefined;
  const selectedUnitPendingMove = Boolean(
    selectedFriendlyUnit &&
      intel.queued_commands.some((cmd) => cmd.source_unit === selectedFriendlyUnit.unit_id),
  );
  const canMoveSelectedUnit = Boolean(
    selectedFriendlyUnit &&
      selectedFriendlyUnit.unit_type !== 'commander' &&
      selectedNodeId &&
      selectedUnitMoveDistance === 1 &&
      intel.current_cp >= 1 &&
      intel.game_status === 'ONGOING' &&
      !selectedUnitPendingMove,
  );
  const commanderMoveDistance =
    selectedNodeId && commander ? getNodeHopDistance(TEST_MAP_EDGES, commander.position_node, selectedNodeId) : undefined;
  const commanderTargetScreened = Boolean(
    selectedNodeId &&
      activeFriendlyUnits.some(
        (unit) => unit.unit_type !== 'commander' && projectedFriendlyPositions.get(unit.unit_id) === selectedNodeId,
      ),
  );
  const commanderPendingMove = Boolean(
    commander && intel.queued_commands.some((cmd) => cmd.source_unit === commander.unit_id),
  );
  const canRedeployCommander = Boolean(
    commander &&
      selectedNodeId &&
      commanderMoveDistance === 1 &&
      commanderTargetScreened &&
      intel.current_cp >= 2 &&
      intel.game_status === 'ONGOING' &&
      !commanderPendingMove,
  );
  const selectedNodeArtilleryRange =
    selectedNodeId && artillery ? getNodeHopDistance(TEST_MAP_EDGES, artillery.position_node, selectedNodeId) : undefined;
  const artilleryCanStrike =
    Boolean(artillery && artillery.hp > 0) &&
    selectedNodeArtilleryRange !== undefined &&
    selectedNodeArtilleryRange <= ARTILLERY_RANGE_HOPS;
  const artilleryPendingCommand = Boolean(
    artillery && intel.queued_commands.some((cmd) => cmd.source_unit === artillery.unit_id),
  );
  const cavalryPendingCommand = Boolean(cavalry && intel.queued_commands.some((cmd) => cmd.source_unit === cavalry.unit_id));
  const cavalryCanAmbush = Boolean(cavalry && cavalry.hp > 0 && !cavalryPendingCommand);
  const selectedMoveTargetIds = useMemo(() => {
    if (!selectedFriendlyUnit || selectedFriendlyUnit.unit_type === 'commander' || selectedUnitPendingMove) return new Set<string>();
    return new Set(
      TEST_MAP_NODES.filter(
        (node) => getNodeHopDistance(TEST_MAP_EDGES, selectedFriendlyUnit.position_node, node.id) === 1,
      ).map((node) => node.id),
    );
  }, [selectedFriendlyUnit, selectedUnitPendingMove]);
  const commanderRedeployTargetIds = useMemo(() => {
    if (!commander || commanderPendingMove) return new Set<string>();
    return new Set(
      TEST_MAP_NODES.filter((node) => {
        const adjacent = getNodeHopDistance(TEST_MAP_EDGES, commander.position_node, node.id) === 1;
        const screened = activeFriendlyUnits.some(
          (unit) => unit.unit_type !== 'commander' && projectedFriendlyPositions.get(unit.unit_id) === node.id,
        );
        return adjacent && screened;
      }).map((node) => node.id),
    );
  }, [activeFriendlyUnits, commander, commanderPendingMove, projectedFriendlyPositions]);
  const queuedMoveVectors = useMemo(() => {
    return intel.queued_commands
      .filter((cmd) => cmd.type === 'MOVE' && cmd.source_unit)
      .map((cmd) => {
        const unit = intel.friendly_units.find((item) => item.unit_id === cmd.source_unit);
        if (!unit) return undefined;
        return {
          id: cmd.command_id,
          from: unit.position_node,
          to: cmd.target_node,
          unitType: unit.unit_type,
        };
      })
      .filter((item): item is { id: string; from: string; to: string; unitType: FriendlyUnitIntel['unit_type'] } =>
        Boolean(item),
      );
  }, [intel.friendly_units, intel.queued_commands]);
  const selectedMovePreview = useMemo(() => {
    if (!selectedNodeId || !selectedFriendlyUnit) return undefined;
    if (selectedFriendlyUnit.unit_type !== 'commander' && selectedUnitMoveDistance === 1) {
      return {
        id: `preview-${selectedFriendlyUnit.unit_id}-${selectedNodeId}`,
        from: selectedFriendlyUnit.position_node,
        to: selectedNodeId,
        unitType: selectedFriendlyUnit.unit_type,
      };
    }
    if (commander && commanderMoveDistance === 1 && commanderTargetScreened) {
      return {
        id: `preview-${commander.unit_id}-${selectedNodeId}`,
        from: commander.position_node,
        to: selectedNodeId,
        unitType: commander.unit_type,
      };
    }
    return undefined;
  }, [commander, commanderMoveDistance, commanderTargetScreened, selectedFriendlyUnit, selectedNodeId, selectedUnitMoveDistance]);
  const signalByNode = useMemo(
    () => new Map(intel.signal_nodes.map((node) => [node.node_id, node])),
    [intel.signal_nodes],
  );
  const selectedNodeSignal = selectedNodeId ? signalByNode.get(selectedNodeId) : undefined;
  const jammedNodeCount = useMemo(
    () => intel.signal_nodes.filter((node) => node.state === 'jammed').length,
    [intel.signal_nodes],
  );
  const contestedNodeCount = useMemo(
    () => intel.signal_nodes.filter((node) => node.state === 'contested').length,
    [intel.signal_nodes],
  );
  const committedCp = useMemo(
    () => intel.queued_commands.reduce((sum, cmd) => sum + cmd.cp_cost, 0),
    [intel.queued_commands],
  );
  const turnPreview = useMemo(() => buildTurnPreview(intel), [intel]);
  const moveButtonHelp = useMemo(
    () =>
      buildMoveButtonHelp({
        selectedNodeId,
        selectedUnit: selectedFriendlyUnit,
        distance: selectedUnitMoveDistance,
        currentCp: intel.current_cp,
        gameStatus: intel.game_status,
        pendingMove: selectedUnitPendingMove,
      }),
    [intel.current_cp, intel.game_status, selectedFriendlyUnit, selectedNodeId, selectedUnitMoveDistance, selectedUnitPendingMove],
  );
  const commanderMoveHelp = useMemo(
    () =>
      buildCommanderMoveHelp({
        selectedNodeId,
        commander,
        distance: commanderMoveDistance,
        currentCp: intel.current_cp,
        gameStatus: intel.game_status,
        targetScreened: commanderTargetScreened,
        pendingMove: commanderPendingMove,
      }),
    [
      commander,
      commanderMoveDistance,
      commanderPendingMove,
      commanderTargetScreened,
      intel.current_cp,
      intel.game_status,
      selectedNodeId,
    ],
  );
  const artilleryButtonHelp = useMemo(
    () =>
      buildCommandButtonHelp({
        command: 'artillery',
        selectedNodeId,
        currentCp: intel.current_cp,
        gameStatus: intel.game_status,
        canUse: artilleryCanStrike,
        range: selectedNodeArtilleryRange,
        pendingSourceCommand: artilleryPendingCommand,
      }),
    [artilleryCanStrike, artilleryPendingCommand, intel.current_cp, intel.game_status, selectedNodeArtilleryRange, selectedNodeId],
  );
  const ambushButtonHelp = useMemo(
    () =>
      buildCommandButtonHelp({
        command: 'ambush',
        selectedNodeId,
        currentCp: intel.current_cp,
        gameStatus: intel.game_status,
        canUse: cavalryCanAmbush,
        pendingSourceCommand: cavalryPendingCommand,
      }),
    [cavalryCanAmbush, cavalryPendingCommand, intel.current_cp, intel.game_status, selectedNodeId],
  );

  const uniqueEdges = useMemo(() => {
    const seen = new Set<string>();
    return TEST_MAP_EDGES.filter((edge) => {
      const key = [edge.from, edge.to].sort().join('__');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const visibleReportRoutes = useMemo(() => {
    const byUnit = new Map<string, IntelReport[]>();
    for (const report of intel.visible_reports) {
      const unitKey = report.observed_unit_id ?? `${report.observed_unit_type}-${report.report_id}`;
      if (!byUnit.has(unitKey)) byUnit.set(unitKey, []);
      byUnit.get(unitKey)!.push(report);
    }
    const routes: Array<{ id: string; from: string; to: string; unitType: string; age: number }> = [];
    for (const [unitId, reports] of byUnit) {
      const sorted = [...reports].sort((a, b) => a.observed_turn - b.observed_turn);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous.observed_position === current.observed_position) continue;
        routes.push({
          id: `${unitId}-${previous.report_id}-${current.report_id}`,
          from: previous.observed_position,
          to: current.observed_position,
          unitType: current.observed_unit_type,
          age: intel.visible_turn - current.observed_turn,
        });
      }
    }
    return routes;
  }, [intel.visible_reports, intel.visible_turn]);

  const recentBattleByNode = useMemo(() => {
    const map = new Map<string, { result: string; summary: string }>();
    for (const report of intel.resolved_battle_reports.slice(0, 5)) {
      map.set(report.location, { result: report.real_result, summary: report.public_summary });
    }
    return map;
  }, [intel.resolved_battle_reports]);

  const latencyStats = useMemo(() => {
    let fresh = 0;
    let stale = 0;
    let oldest = 0;
    for (const report of intel.visible_reports) {
      const age = Math.max(0, intel.visible_turn - report.observed_turn);
      if (age <= 1) fresh += 1;
      if (age >= 3) stale += 1;
      oldest = Math.max(oldest, age);
    }
    return { fresh, stale, oldest, total: intel.visible_reports.length };
  }, [intel.visible_reports, intel.visible_turn]);

  const latestSignalSummary = useMemo(() => {
    const latestBattle = intel.resolved_battle_reports[0]?.public_summary;
    if (latestBattle) return latestBattle;
    const pending = intel.pending_battle_reports[0];
    if (pending) {
      const turnsLeft = Math.max(0, pending.reveal_turn - intel.visible_turn);
      return `${formatNode(pending.location)} 坐标包回传中，预计 ${turnsLeft} 回合后解码`;
    }
    const latestResolution = intel.resolved_command_resolutions[0];
    if (latestResolution) return latestResolution.public_summary;
    return '信道静默，没有战果回执在路上。';
  }, [intel.pending_battle_reports, intel.resolved_battle_reports, intel.resolved_command_resolutions, intel.visible_turn]);

  const actionHint = useMemo(
    () =>
      buildActionHint({
        selectedNodeId,
        selectedReport,
        selectedNodeSignal,
        selectedNodeIntelDelay,
        selectedNodeArtilleryRange,
        selectedFriendlyUnit,
        selectedUnitCanMove: canMoveSelectedUnit,
        commanderCanRedeploy: canRedeployCommander,
        artilleryCanStrike,
        currentCp: intel.current_cp,
        visibleTurn: intel.visible_turn,
        queuedCount: intel.queued_commands.length,
        gameStatus: intel.game_status,
      }),
    [
      artilleryCanStrike,
      intel.current_cp,
      intel.game_status,
      intel.visible_turn,
      intel.queued_commands.length,
      selectedNodeArtilleryRange,
      selectedNodeId,
      selectedNodeIntelDelay,
      selectedNodeSignal,
      selectedReport,
      selectedFriendlyUnit,
      canMoveSelectedUnit,
      canRedeployCommander,
    ],
  );

  const advisorMessage = useMemo(
    () =>
      buildAdvisorMessage({
        intel,
        selectedNodeId,
        selectedReport,
        selectedNodeSignal,
        artilleryCanStrike,
        selectedNodeArtilleryRange,
        latestSignalSummary,
      }),
    [
      artilleryCanStrike,
      intel,
      latestSignalSummary,
      selectedNodeArtilleryRange,
      selectedNodeId,
      selectedNodeSignal,
      selectedReport,
    ],
  );

  const intelFeedTimeline = useMemo(
    () => buildTimelineItems(intel.audit_entries.filter((entry) => entry.track === '玩家')).reverse(),
    [intel.audit_entries],
  );

  const groupedArchiveTurns = useMemo(() => {
    const grouped = new Map<number, TimelineItem[]>();
    for (const item of buildTimelineItems(intel.audit_entries)) {
      if (!grouped.has(item.turn)) grouped.set(item.turn, []);
      grouped.get(item.turn)!.push(item);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  }, [intel.audit_entries]);

  const aarAnchorTurn = useMemo(() => {
    return (
      groupedArchiveTurns.find(([, entries]) =>
        entries.some((entry) => entry.eventType === 'COMMAND_VOID' || entry.eventType === 'CRISIS_ORDER'),
      )?.[0] ?? groupedArchiveTurns[0]?.[0]
    );
  }, [groupedArchiveTurns]);

  const gameOverHighlights = useMemo(() => {
    const timeline = [...intel.audit_entries].reverse();
    const pickLatest = (type: AuditEntry['event_type']) => timeline.find((entry) => entry.event_type === type);

    const selected: AuditEntry[] = [];
    const add = (entry: AuditEntry | undefined) => {
      if (!entry) return;
      if (selected.some((item) => item.turn === entry.turn && item.event_type === entry.event_type && item.message === entry.message)) return;
      selected.push(entry);
    };

    if (intel.game_status === 'DEFEAT') {
      add(timeline.find((entry) => entry.event_type === 'COMBAT' && entry.message.includes('红方基地')));
      add(pickLatest('COMMAND_VOID'));
      add(pickLatest('CRISIS_ORDER'));
    } else {
      add(pickLatest('COMBAT'));
      add(pickLatest('COMMAND_OK'));
      add(pickLatest('CRISIS_ORDER'));
    }

    if (selected.length < 3) {
      for (const item of timeline) {
        if (selected.some((s) => s.turn === item.turn && s.message === item.message)) continue;
        selected.push(item);
        if (selected.length >= 3) break;
      }
    }
    return selected.slice(0, 3);
  }, [intel.audit_entries]);

  useEffect(() => {
    if (activeFriendlyUnits.length === 0) return;
    if (activeFriendlyUnits.some((unit) => unit.unit_id === selectedFriendlyUnitId)) return;
    setSelectedFriendlyUnitId(
      activeFriendlyUnits.find((unit) => unit.unit_type !== 'commander')?.unit_id ?? activeFriendlyUnits[0].unit_id,
    );
  }, [activeFriendlyUnits, selectedFriendlyUnitId]);

  useEffect(() => {
    terminalScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedNodeId, selectedReportId]);

  useEffect(() => {
    if (reviewMode !== 'archive') return;
    const conflictTurn =
      groupedArchiveTurns.find(([, entries]) =>
        entries.some((entry) => entry.eventType === 'COMMAND_VOID'),
      )?.[0] ?? groupedArchiveTurns[0]?.[0];
    if (conflictTurn === undefined) return;
    setExpandedTurns(new Set([conflictTurn]));
  }, [reviewMode, groupedArchiveTurns]);

  useEffect(() => {
    if (intel.game_status !== 'ONGOING') {
      setGameOverOverlayOpen(true);
    }
  }, [intel.game_status]);

  useEffect(() => {
    if (intel.visible_turn < prevTurnForResetRef.current) {
      intelInitRef.current = false;
      prevIntelLenRef.current = 0;
    }
    prevTurnForResetRef.current = intel.visible_turn;

    const n = intel.visible_reports.length;
    if (!intelInitRef.current) {
      intelInitRef.current = true;
      prevIntelLenRef.current = n;
      return;
    }
    if (sfxOn && n > prevIntelLenRef.current) {
      void unlockAudio().then(() => playIntelChime());
    }
    prevIntelLenRef.current = n;
  }, [intel.visible_reports.length, intel.visible_turn, sfxOn]);

  useEffect(() => {
    void unlockAudio().then(() => {
      setAmbientEnabled(Boolean(sfxOn && ambientOn));
    });
    return () => setAmbientEnabled(false);
  }, [sfxOn, ambientOn]);

  useEffect(() => {
    if (!crisisModalOpen || !sfxOn) return;
    void unlockAudio().then(() => playTension());
  }, [crisisModalOpen, sfxOn]);

  useEffect(() => {
    setAdvisorText('');
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setAdvisorText(advisorMessage.text.slice(0, index));
      if (index >= advisorMessage.text.length) {
        window.clearInterval(timer);
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [advisorMessage.key, advisorMessage.text]);

  const toggleSfx = useCallback(() => {
    setSfxOn((v) => {
      const next = !v;
      localStorage.setItem('war_sfx', next ? '1' : '0');
      if (next) void unlockAudio().then(() => playUiTick());
      else {
        setAmbientOn(false);
        localStorage.setItem('war_ambient', '0');
        setAmbientEnabled(false);
      }
      return next;
    });
  }, []);

  const toggleAmbient = useCallback(() => {
    setAmbientOn((v) => {
      const next = !v;
      localStorage.setItem('war_ambient', next ? '1' : '0');
      return next;
    });
  }, []);

  const handleEndTurn = useCallback(() => {
    if (intel.game_status !== 'ONGOING' || turnResolving) return;
    setTurnResolving(true);
    if (sfxOn) {
      void unlockAudio().then(() => playTurnResolve());
    }
    window.setTimeout(() => {
      endTurnAction();
      setTurnResolving(false);
    }, 560);
  }, [endTurnAction, intel.game_status, sfxOn, turnResolving]);

  const pulse = sfxOn ? () => void unlockAudio().then(() => playUiTick()) : () => {};

  const selectedCommandDeck = selectedNodeId ? (
    <div className="hidden rounded border border-emerald-800/50 bg-slate-950/80 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.2)] md:block">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-emerald-100">命令区</div>
          <div className="text-[10px] leading-snug text-slate-500">
            已选 {selectedFriendlyUnit ? `${unitShortName(selectedFriendlyUnit.unit_type)} ${selectedFriendlyUnit.unit_id}` : '无单位'}
          </div>
        </div>
        <div className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 font-mono text-[10px] text-slate-300">
          CP {intel.current_cp}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          className="rounded border border-emerald-500/60 bg-emerald-950/20 px-2 py-2 text-[11px] text-emerald-100 transition-transform active:scale-95 hover:bg-emerald-900/35 disabled:opacity-40"
          disabled={!canMoveSelectedUnit}
          title={moveButtonHelp}
          onClick={() => {
            if (!selectedFriendlyUnit || !selectedNodeId) return;
            const ok = queueMoveUnitAction(selectedFriendlyUnit.unit_id, selectedNodeId);
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(12);
            }
          }}
        >
          节点调动
          <span className="block font-mono text-[9px] text-emerald-300/80">1 CP</span>
        </button>
        <button
          type="button"
          className="rounded border border-sky-500/60 bg-sky-950/20 px-2 py-2 text-[11px] text-sky-100 transition-transform active:scale-95 hover:bg-sky-900/35 disabled:opacity-40"
          disabled={!canRedeployCommander}
          title={commanderMoveHelp}
          onClick={() => {
            if (!selectedNodeId) return;
            const ok = queueCommanderRedeployAction(selectedNodeId);
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(20);
            }
          }}
        >
          主帅移营
          <span className="block font-mono text-[9px] text-sky-300/80">2 CP</span>
        </button>
        <button
          type="button"
          className="rounded border border-amber-400/60 bg-amber-950/20 px-2 py-2 text-[11px] text-amber-100 transition-transform active:scale-95 hover:bg-amber-900/35 disabled:opacity-40"
          disabled={intel.current_cp < 1 || intel.game_status !== 'ONGOING' || !artilleryCanStrike || artilleryPendingCommand}
          title={artilleryButtonHelp}
          onClick={() => {
            const ok = attackSelectedNode();
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(15);
            }
          }}
        >
          炮兵盲打
          <span className="block font-mono text-[9px] text-amber-300/80">1 CP</span>
        </button>
        <button
          type="button"
          className="rounded border border-cyan-500/50 bg-cyan-950/20 px-2 py-2 text-[11px] text-cyan-100 transition-transform active:scale-95 hover:bg-cyan-900/30 disabled:opacity-40"
          disabled={intel.current_cp < 2 || intel.game_status !== 'ONGOING' || !cavalryCanAmbush}
          title={ambushButtonHelp}
          onClick={() => {
            const ok = queueAmbushSelectedNode();
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(18);
            }
          }}
        >
          骑兵设伏
          <span className="block font-mono text-[9px] text-cyan-300/80">2 CP</span>
        </button>
      </div>
      <div className="mt-2 text-[10px] leading-snug text-slate-400">
        {canMoveSelectedUnit
          ? moveButtonHelp
          : canRedeployCommander
            ? commanderMoveHelp
            : artilleryCanStrike && !artilleryPendingCommand
              ? artilleryButtonHelp
              : ambushButtonHelp}
      </div>
    </div>
  ) : null;

  const mobileUnitRail = (
    <div className="md:hidden">
      <div className="mb-1 flex items-center justify-between px-0.5 text-[10px] text-slate-500">
        <span>选择单位</span>
        <span>{selectedFriendlyUnit ? `${unitShortName(selectedFriendlyUnit.unit_type)} · ${formatNode(selectedFriendlyUnit.position_node)}` : '无可用单位'}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {activeFriendlyUnits.map((unit) => (
          <button
            key={unit.unit_id}
            type="button"
            className={`min-h-11 min-w-[4.9rem] rounded border px-2 py-1.5 text-left transition-transform active:scale-95 ${
              selectedFriendlyUnitId === unit.unit_id
                ? 'border-emerald-300 bg-emerald-950/55 text-emerald-100'
                : 'border-slate-700 bg-slate-950/70 text-slate-300'
            }`}
            onClick={() => setSelectedFriendlyUnitId(unit.unit_id)}
          >
            <span className="block text-sm font-semibold leading-none">
              {unitMarkerGlyph(unit.unit_type)} {unitShortName(unit.unit_type)}
            </span>
            <span className="mt-1 block truncate font-mono text-[9px] text-slate-400">HP {unit.hp}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const mobileCommandDock = selectedNodeId ? (
    <div className="mobile-command-dock fixed inset-x-2 z-[22] rounded-lg border border-emerald-700/80 bg-slate-950/95 p-2 shadow-[0_-14px_40px_rgba(0,0,0,0.55)] backdrop-blur-md md:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-100">{formatNode(selectedNodeId)}</div>
          <div className="truncate text-[10px] text-slate-500">
            {selectedFriendlyUnit ? `${unitShortName(selectedFriendlyUnit.unit_type)} ${selectedFriendlyUnit.unit_id}` : '未选单位'} · CP {intel.current_cp}
          </div>
        </div>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded border border-amber-500/70 bg-amber-950/35 px-3 text-xs font-semibold text-amber-100 active:scale-95 disabled:opacity-40"
          onClick={handleEndTurn}
          disabled={intel.game_status !== 'ONGOING' || turnResolving}
        >
          {turnResolving ? '结算…' : '推进'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          type="button"
          className="min-h-12 rounded border border-emerald-500/60 bg-emerald-950/25 px-1 text-[10px] leading-tight text-emerald-100 active:scale-95 disabled:opacity-35"
          disabled={!canMoveSelectedUnit}
          title={moveButtonHelp}
          onClick={() => {
            if (!selectedFriendlyUnit || !selectedNodeId) return;
            const ok = queueMoveUnitAction(selectedFriendlyUnit.unit_id, selectedNodeId);
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(12);
            }
          }}
        >
          调动
          <span className="block font-mono text-[9px] opacity-80">1</span>
        </button>
        <button
          type="button"
          className="min-h-12 rounded border border-sky-500/60 bg-sky-950/25 px-1 text-[10px] leading-tight text-sky-100 active:scale-95 disabled:opacity-35"
          disabled={!canRedeployCommander}
          title={commanderMoveHelp}
          onClick={() => {
            if (!selectedNodeId) return;
            const ok = queueCommanderRedeployAction(selectedNodeId);
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(20);
            }
          }}
        >
          移营
          <span className="block font-mono text-[9px] opacity-80">2</span>
        </button>
        <button
          type="button"
          className="min-h-12 rounded border border-amber-400/60 bg-amber-950/25 px-1 text-[10px] leading-tight text-amber-100 active:scale-95 disabled:opacity-35"
          disabled={intel.current_cp < 1 || intel.game_status !== 'ONGOING' || !artilleryCanStrike || artilleryPendingCommand}
          title={artilleryButtonHelp}
          onClick={() => {
            const ok = attackSelectedNode();
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(15);
            }
          }}
        >
          盲打
          <span className="block font-mono text-[9px] opacity-80">1</span>
        </button>
        <button
          type="button"
          className="min-h-12 rounded border border-cyan-500/60 bg-cyan-950/25 px-1 text-[10px] leading-tight text-cyan-100 active:scale-95 disabled:opacity-35"
          disabled={intel.current_cp < 2 || intel.game_status !== 'ONGOING' || !cavalryCanAmbush}
          title={ambushButtonHelp}
          onClick={() => {
            const ok = queueAmbushSelectedNode();
            if (ok) {
              if (sfxOn) void unlockAudio().then(() => playCommit());
              if ('vibrate' in navigator) navigator.vibrate(18);
            }
          }}
        >
          设伏
          <span className="block font-mono text-[9px] opacity-80">2</span>
        </button>
      </div>
      <div className="mt-1 truncate text-[10px] text-slate-400">
        {canMoveSelectedUnit
          ? moveButtonHelp
          : canRedeployCommander
            ? commanderMoveHelp
            : artilleryCanStrike && !artilleryPendingCommand
              ? artilleryButtonHelp
              : ambushButtonHelp}
      </div>
    </div>
  ) : null;

  return (
    <div className="relative mx-auto flex h-screen max-w-6xl flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-[#0a1628] to-slate-950 text-slate-100">
      <div className="war-vignette pointer-events-none fixed inset-0 z-[5]" aria-hidden />
      {mobileCommandDock}
      {turnResolving && (
        <div
          className="war-turn-overlay pointer-events-none fixed inset-0 z-[25] bg-gradient-to-b from-emerald-500/10 via-transparent to-amber-500/10"
          aria-hidden
        />
      )}

      <header className="relative z-10 border-b border-emerald-900/30 bg-slate-950/80 px-2 py-1.5 shadow-[0_0_40px_rgba(0,0,0,0.45)] backdrop-blur-sm md:px-4 md:py-3">
        <div className="mb-1 flex flex-col gap-1 border-b border-slate-800/80 pb-1.5 md:mb-2 md:flex-row md:items-end md:justify-between md:pb-2">
          <div>
            <div className="hidden font-mono text-[10px] tracking-[0.15em] text-emerald-500/90 sm:block">加密链路 · 战术段</div>
            <div className="text-sm font-semibold tracking-wide text-slate-100 md:text-lg">第七战区 · 前沿指挥舱</div>
            <div className="mt-0.5 hidden max-w-md text-[11px] leading-snug text-slate-400 sm:block">
              短波残影滞后到达；你看到的永远是「当时」的影子。守住下方基地，在噪声里下注。
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              <span className="hidden sm:inline">敌情剧本</span>
              <select
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                value={intel.enemy_script.mode}
                onChange={(event) => {
                  restartGameAction(event.target.value as EnemyScriptMode);
                  setExpandedTurns(new Set());
                  setGameOverOverlayOpen(false);
                  setSignalDrawerOpen(false);
                }}
              >
                {PLAYABLE_ENEMY_SCRIPT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SCRIPTED_ENEMY_SCENARIOS[mode].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setRulesPanelOpen(true)}
              className="rounded border border-sky-600/70 bg-sky-950/30 px-2 py-1 text-[11px] text-sky-100 transition-transform active:scale-95 hover:bg-sky-900/35"
            >
              任务简报
            </button>
            <button
              type="button"
              onClick={toggleSfx}
              className={`hidden rounded border px-2 py-1 text-[11px] transition-transform active:scale-95 sm:inline-block ${
                sfxOn ? 'border-emerald-600 bg-emerald-950/50 text-emerald-200' : 'border-slate-600 text-slate-400'
              }`}
            >
              音效{sfxOn ? '开' : '关'}
            </button>
            <button
              type="button"
              disabled={!sfxOn}
              onClick={toggleAmbient}
              className={`hidden rounded border px-2 py-1 text-[11px] transition-transform active:scale-95 disabled:opacity-40 sm:inline-block ${
                ambientOn ? 'border-sky-700 bg-sky-950/40 text-sky-200' : 'border-slate-600 text-slate-400'
              }`}
            >
              底噪{ambientOn ? '开' : '关'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] md:gap-2 md:text-sm">
          <div className="font-mono text-amber-100/90">
            回合 <span className="text-base font-semibold tabular-nums md:text-lg">{intel.visible_turn}</span>
            <span className="text-slate-500">/{intel.max_turn}</span>
          </div>
          <div className="text-emerald-200/90">
            指挥点 <span className="tabular-nums font-semibold">{intel.current_cp}</span>/{intel.max_cp}
          </div>
          <div className="hidden text-rose-200/80 sm:block">债务 {intel.cp_debt}</div>
          <div className={commander?.hp && commander.hp > 0 ? 'text-emerald-300' : 'text-rose-400'}>
            主帅 {commander?.hp && commander.hp > 0 ? '在线' : '失联'}
          </div>
          <div className="text-slate-300">战局 {statusLabel(intel.game_status)}</div>
          <button
            className="hidden rounded border border-amber-600/80 bg-amber-950/30 px-3 py-1.5 text-xs font-medium text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)] transition-transform active:scale-95 hover:bg-amber-900/40 disabled:opacity-40 sm:inline-block md:text-sm"
            onClick={handleEndTurn}
            disabled={intel.game_status !== 'ONGOING' || turnResolving}
          >
            {turnResolving ? '战况结算中…' : '推进回合'}
          </button>
        </div>
      </header>
      <div className="relative z-10 border-b border-slate-800/90 bg-slate-950/60 px-2 py-1.5 md:px-4 md:py-2">
        <div className="mb-1 rounded border border-sky-900/50 bg-sky-950/20 px-2 py-1 text-[10px] leading-snug text-slate-300 md:hidden">
          <span className="font-semibold text-emerald-200">胜利：</span>占领蓝方基地/消灭敌军。
          <span className="ml-2 font-semibold text-rose-200">失败：</span>基地被破/主帅失联。
        </div>
        <div className="mb-2 hidden gap-1 rounded border border-sky-900/50 bg-sky-950/20 px-2 py-1.5 text-[11px] leading-snug text-slate-300 md:grid md:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div>
            <span className="font-semibold text-sky-100">任务：</span>守住红方基地，阻断敌方穿插。
          </div>
          <div>
            <span className="font-semibold text-emerald-200">胜利：</span>占领蓝方基地、消灭敌军，或第 10 回合关键点占优。
          </div>
          <div>
            <span className="font-semibold text-rose-200">失败：</span>敌军进入红方基地，或主帅失联。
          </div>
          <div>
            <span className="font-semibold text-amber-200">情报：</span>以主帅为中心，距 {formatNode(commanderNode)} 越远越慢。
          </div>
        </div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono tracking-wide text-emerald-600/90">带宽占用</span>
          <span>
            可用 {intel.current_cp}/{intel.max_cp} · 已预约 {committedCp} · 烽火 {intel.crisis_available ? '待命' : '已用尽'}
          </span>
        </div>
        <CPBudgetBar max={intel.max_cp} available={intel.current_cp} committed={committedCp} previewCost={0} />
        <div className="mt-1 hidden flex-wrap gap-2 font-mono text-[10px] text-slate-500 sm:flex">
          <span className="text-sky-300/80">
            剧本 {intel.enemy_script.label} #{intel.enemy_script.seed}
          </span>
          <span>敌情残影 {latencyStats.total}</span>
          <span className="text-rose-300/80">热残影 {latencyStats.fresh}</span>
          <span className="text-amber-300/80">过期风险 {latencyStats.stale}</span>
          <span>最旧延迟 {latencyStats.oldest} 回合</span>
          <span className="text-rose-300/80">争夺节点 {contestedNodeCount}</span>
          <span className="text-fuchsia-300/80">信号阴影 {jammedNodeCount}</span>
        </div>
        <div className="mt-1 rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[10px] leading-snug text-slate-300 md:mt-2 md:py-1.5 md:text-[11px]">
          <span className="font-semibold text-slate-100">推进预览：</span>
          {turnPreview}
        </div>
      </div>

      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2 pb-48 md:grid-cols-[minmax(0,1fr)_300px] md:gap-3 md:overflow-hidden md:p-3 md:pb-14">
        {mobileUnitRail}
        <section className="relative min-h-[min(500px,64svh)] shrink-0 overflow-hidden rounded-lg border border-emerald-900/35 bg-gradient-to-b from-slate-950 via-slate-900/95 to-emerald-950/25 p-2 shadow-[inset_0_0_60px_rgba(0,0,0,0.35)] md:h-full md:min-h-0 md:p-3">
          <div className="war-scanlines absolute inset-0 z-[1] opacity-50" aria-hidden />
          <div
            className="pointer-events-none absolute left-1/2 top-2 z-[2] hidden -translate-x-1/2 rounded-full border border-sky-500/25 bg-sky-950/40 px-2 py-0.5 font-mono text-[10px] text-sky-200/90 sm:block"
            aria-hidden
          >
            ▲ 敌方压力轴
          </div>
          <div
            className="pointer-events-none absolute bottom-2 left-1/2 z-[2] hidden -translate-x-1/2 rounded-full border border-emerald-600/30 bg-emerald-950/50 px-2 py-0.5 font-mono text-[10px] text-emerald-200/90 sm:block"
            aria-hidden
          >
            ▼ 我方责任区
          </div>
          <div
            className="pointer-events-none absolute right-2 top-2 z-[2] hidden rounded border border-slate-700/80 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-300 sm:block"
            aria-hidden
          >
            <span className="mr-2 text-rose-300">● 骑兵残影</span>
            <span className="text-amber-300">◆ 步兵残影</span>
          </div>
          <svg className="absolute inset-0 z-0 h-full w-full opacity-90" aria-hidden>
            <defs>
              <filter id={edgeGlowFilterId} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker id={`${edgeGlowFilterId}-move-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#34d399" />
              </marker>
              <marker id={`${edgeGlowFilterId}-commander-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#38bdf8" />
              </marker>
            </defs>
            {uniqueEdges.map((edge) => {
              const from = positionToPercent(edge.from);
              const to = positionToPercent(edge.to);
              const fromSignal = signalByNode.get(edge.from);
              const toSignal = signalByNode.get(edge.to);
              const disrupted =
                fromSignal?.state === 'contested' ||
                toSignal?.state === 'contested' ||
                fromSignal?.state === 'jammed' ||
                toSignal?.state === 'jammed';
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  className={disrupted ? 'war-signal-break' : undefined}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={disrupted ? '#fb7185' : edge.to === EAST_WATCH || edge.from === EAST_WATCH ? '#475569' : '#334155'}
                  strokeWidth={disrupted ? 2.8 : edge.to === EAST_WATCH || edge.from === EAST_WATCH ? 1.5 : 2.2}
                  strokeOpacity={disrupted ? 0.8 : 0.85}
                  strokeDasharray={disrupted ? '5 7' : edge.to === EAST_WATCH || edge.from === EAST_WATCH ? '6 4' : '0'}
                  filter={`url(#${edgeGlowFilterId})`}
                />
              );
            })}
            {visibleReportRoutes.map((route) => {
              const from = positionToPercent(route.from);
              const to = positionToPercent(route.to);
              return (
                <line
                  key={route.id}
                  className="war-ghost-route"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={route.unitType.includes('骑') ? '#fb7185' : '#f59e0b'}
                  strokeWidth={route.unitType.includes('骑') ? 3 : 2.2}
                  strokeOpacity={route.age <= 1 ? 0.75 : 0.45}
                  strokeDasharray={route.unitType.includes('骑') ? '2 8' : '8 5'}
                  strokeLinecap="round"
                />
              );
            })}
            {queuedMoveVectors.map((route) => {
              const from = positionToPercent(route.from);
              const to = positionToPercent(route.to);
              const commanderRoute = route.unitType === 'commander';
              return (
                <line
                  key={route.id}
                  className="war-friendly-move-route"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={commanderRoute ? '#38bdf8' : '#34d399'}
                  strokeWidth={commanderRoute ? 4 : 3.2}
                  strokeOpacity={0.88}
                  strokeDasharray="8 5"
                  strokeLinecap="round"
                  markerEnd={`url(#${commanderRoute ? `${edgeGlowFilterId}-commander-arrow` : `${edgeGlowFilterId}-move-arrow`})`}
                />
              );
            })}
            {selectedMovePreview && (
              <line
                className="war-friendly-move-preview"
                x1={positionToPercent(selectedMovePreview.from).x}
                y1={positionToPercent(selectedMovePreview.from).y}
                x2={positionToPercent(selectedMovePreview.to).x}
                y2={positionToPercent(selectedMovePreview.to).y}
                stroke={selectedMovePreview.unitType === 'commander' ? '#38bdf8' : '#6ee7b7'}
                strokeWidth={selectedMovePreview.unitType === 'commander' ? 3.4 : 2.8}
                strokeOpacity={0.72}
                strokeDasharray="4 4"
                strokeLinecap="round"
                markerEnd={`url(#${
                  selectedMovePreview.unitType === 'commander'
                    ? `${edgeGlowFilterId}-commander-arrow`
                    : `${edgeGlowFilterId}-move-arrow`
                })`}
              />
            )}
          </svg>

          {TEST_MAP_NODES.map((node) => {
            const ghostReports = intel.visible_reports.filter((r) => r.observed_position === node.id);
            const visibleGhostReports = [...ghostReports]
              .sort((a, b) => b.observed_turn - a.observed_turn || b.reveal_turn - a.reveal_turn)
              .slice(0, 3);
            const hiddenGhostCount = Math.max(0, ghostReports.length - visibleGhostReports.length);
            const ownUnits = intel.friendly_units.filter((u) => u.position_node === node.id);
            const visibleOwnUnits = ownUnits.slice(0, 3);
            const hiddenOwnCount = Math.max(0, ownUnits.length - visibleOwnUnits.length);
            const nodeBattle = recentBattleByNode.get(node.id);
            const nodeSignal = signalByNode.get(node.id);
            const ghostSummary = buildGhostNodeSummary(ghostReports, intel.visible_turn, nodeSignal);
            const moveHintClass = selectedMoveTargetIds.has(node.id)
              ? 'war-node-move-target border-emerald-300/90 ring-1 ring-emerald-300/55 '
              : '';
            const commanderHintClass = commanderRedeployTargetIds.has(node.id)
              ? 'war-node-command-target border-sky-300/90 ring-1 ring-sky-300/55 '
              : '';
            return (
              <button
                key={node.id}
                type="button"
                style={{ left: TEST_MAP_LAYOUT[node.id].x, top: TEST_MAP_LAYOUT[node.id].y }}
                className={`z-[3] ${mapNodeButtonClass(node.id, selectedNodeId === node.id)} ${signalNodeOverlayClass(nodeSignal)} ${moveHintClass} ${commanderHintClass}`}
                onClick={() => {
                  pulse();
                  selectNode(node.id);
                }}
              >
                {nodeSignal?.state === 'jammed' && <span className="war-static-noise pointer-events-none absolute inset-0 rounded" aria-hidden />}
                {nodeSignal?.state === 'contested' && (
                  <span className="absolute -left-1 -top-2 z-10 rounded border border-rose-300 bg-rose-950/90 px-1 py-0.5 font-mono text-[9px] text-rose-100">
                    CONTACT
                  </span>
                )}
                {nodeSignal?.state === 'jammed' && (
                  <span className="absolute -left-1 -top-2 z-10 rounded border border-fuchsia-400/80 bg-slate-950/90 px-1 py-0.5 font-mono text-[9px] text-fuchsia-100">
                    盲区
                  </span>
                )}
                {nodeBattle && (
                  <span className={battleFeedbackClass(nodeBattle.result)} title={nodeBattle.summary}>
                    {battleFeedbackLabel(nodeBattle.result)}
                  </span>
                )}
                <div className="font-medium text-slate-100">{node.name}</div>
                <div className="text-[10px] text-slate-400/90">{formatTerrainType(node.type)}</div>
                <div className="mt-1 flex min-h-5 items-center justify-center gap-1">
                  {visibleOwnUnits.map((u) => (
                    <span
                      key={u.unit_id}
                      className={`${unitMarkerClass(u.unit_type, u.hp <= 0)} ${
                        selectedFriendlyUnitId === u.unit_id ? 'ring-2 ring-emerald-200 ring-offset-1 ring-offset-slate-950' : ''
                      }`}
                      title={`${unitShortName(u.unit_type)} ${u.unit_id} HP ${u.hp}`}
                    >
                      {unitMarkerGlyph(u.unit_type)}
                    </span>
                  ))}
                  {hiddenOwnCount > 0 && <span className="rounded bg-emerald-950 px-1 text-[9px] text-emerald-100">+{hiddenOwnCount}</span>}
                  {visibleGhostReports.map((report) => (
                    <span
                      key={report.report_id}
                      className={intelReportMarkerClass(report, intel.visible_turn, nodeSignal)}
                      onClick={(event) => {
                        event.stopPropagation();
                        pulse();
                        selectReport(report.report_id, node.id);
                      }}
                      title={`${intel.visible_turn - report.observed_turn} 回合前`}
                    />
                  ))}
                  {hiddenGhostCount > 0 && <span className="rounded bg-rose-950 px-1 text-[9px] text-rose-100">+{hiddenGhostCount}</span>}
                </div>
                {ownUnits.length > 0 && (
                  <div className="mt-1 truncate text-[9px] text-emerald-100">
                    我方 {ownUnits.map((unit) => unitMarkerGlyph(unit.unit_type)).join(' ')}
                  </div>
                )}
                {ghostSummary && (
                  <div className={ghostSummary.className} title={ghostSummary.title}>
                    {ghostSummary.label}
                  </div>
                )}
              </button>
            );
          })}
        </section>

        <aside
          ref={terminalScrollRef}
          className="min-h-[340px] overflow-y-auto rounded-lg border border-emerald-900/25 bg-slate-950/90 p-3 text-sm shadow-[inset_0_0_40px_rgba(0,0,0,0.25)] md:h-full md:min-h-0"
        >
          <div className="mb-3 rounded border border-slate-700/80 bg-slate-900/80 p-2">
            <div className="mb-2 flex items-center gap-2">
              <div className={`war-pixel-portrait ${advisorMessage.speaker === 'sergeant' ? 'war-pixel-sergeant' : ''}`} aria-hidden>
                <span />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-[10px] tracking-wider text-emerald-500/90">
                    无线电 / {advisorMessage.title}
                  </div>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      advisorMessage.speaker === 'sergeant' ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.8)]' : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]'
                    }`}
                    aria-hidden
                  />
                </div>
                <div className="mt-1 min-h-[2.6rem] text-[11px] leading-relaxed text-slate-200">
                  {advisorText}
                  <span className="war-type-cursor" aria-hidden />
                </div>
              </div>
            </div>
          </div>
          <div className="mb-1 font-mono text-[10px] tracking-wider text-emerald-600/80">TACTICAL UPLINK / 延迟链路</div>
          <div className="mb-2 text-base font-semibold text-slate-100">战术终端</div>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            红色标记不是敌人本体，是刚送达的旧照片。先读年龄，再下注；命中和踩空都会晚一拍回传。
          </p>
          <div className="mb-3 rounded border border-emerald-900/45 bg-emerald-950/15 p-2 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-emerald-100">本方部署</span>
              <span className="font-mono text-[10px] text-emerald-300/80">
                可战斗 {activeFriendlyUnits.length}/{intel.friendly_units.length}
              </span>
            </div>
            <div className="space-y-1">
              {intel.friendly_units.map((unit) => (
                <button
                  key={unit.unit_id}
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left transition-colors ${
                    selectedFriendlyUnitId === unit.unit_id
                      ? 'border-emerald-400/80 bg-emerald-950/45'
                      : 'border-transparent bg-slate-950/45 hover:border-emerald-800/70'
                  } ${unit.hp > 0 ? '' : 'opacity-55'}`}
                  disabled={unit.hp <= 0}
                  onClick={() => setSelectedFriendlyUnitId(unit.unit_id)}
                >
                  <span className={unit.hp > 0 ? 'text-slate-200' : 'text-slate-500'}>
                    {unitShortName(unit.unit_type)} {unit.unit_id}
                    {unit.unit_type === 'commander' ? ' · 情报中心' : ''}
                  </span>
                  <span className={unit.hp > 0 ? 'text-emerald-200' : 'text-rose-300'}>
                    {formatNode(unit.position_node)} · {unit.hp > 0 ? `HP ${unit.hp}` : '失联'}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
              {activeFriendlyUnits.map((unit) => `${unitShortName(unit.unit_type)}：${unitRoleDescription(unit.unit_type)}`).join(' · ')}
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
              敌情延迟按距离主帅计算：距离主帅 1 格慢 1 回合，2 格慢 2 回合。
            </div>
          </div>
          {selectedNodeId ? (
            <div className="space-y-2">
              <div>目标节点：{formatNode(selectedNodeId)}</div>
              <div className={`rounded border px-2 py-1.5 text-[11px] leading-relaxed ${actionHint.tone}`}>
                <div className="font-semibold">{actionHint.title}</div>
                <div>{actionHint.body}</div>
              </div>
              {selectedCommandDeck}
              {selectedNodeIntelDelay !== undefined && (
                <div className="rounded border border-slate-700/80 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300">
                  此节点距我方主帅 {selectedNodeIntelDelay} 格；常规敌情约延迟 {selectedNodeIntelDelay} 回合。
                </div>
              )}
              {selectedNodeSignal?.state !== undefined && selectedNodeSignal.state !== 'clear' && (
                <div
                  className={`rounded border px-2 py-1 text-[11px] ${
                    selectedNodeSignal.state === 'contested'
                      ? 'border-rose-700 bg-rose-950/25 text-rose-100'
                      : 'border-fuchsia-800 bg-fuchsia-950/20 text-fuchsia-100'
                  }`}
                >
                  {selectedNodeSignal.state === 'contested'
                    ? '节点接敌：这里正在争夺，只报告战斗，不转发视野。'
                    : `信号阴影：上游 ${selectedNodeSignal.cause_node ? formatNode(selectedNodeSignal.cause_node) : '节点'} 受干扰，敌情不可完全信任。`}
                </div>
              )}
              {selectedNodeArtilleryRange !== undefined && (
                <div
                  className={`rounded border px-2 py-1 text-[11px] ${
                    artilleryCanStrike
                      ? 'border-amber-800/70 bg-amber-950/20 text-amber-100'
                      : 'border-rose-900/60 bg-rose-950/20 text-rose-200'
                  }`}
                >
                  炮兵射程 {ARTILLERY_RANGE_HOPS} 格；当前目标距炮兵 {selectedNodeArtilleryRange} 格
                  {artilleryCanStrike ? '，可盲打。' : '，超出射程。'}
                </div>
              )}
              {selectedReport ? (
                <>
                  <div className="rounded border border-rose-900/40 bg-rose-950/20 px-2 py-2">
                    <div className="font-mono text-[10px] text-rose-300/80">截获残影</div>
                    <div className="mt-0.5 text-slate-100">
                      {selectedReport.observed_unit_type}
                      {selectedReport.observed_unit_id ? ` / ${selectedReport.observed_unit_id}` : ''}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-300">
                      {formatNode(selectedReport.observed_position)}，
                      {selectedNodeSignal?.state === 'jammed' ? '信号阴影内的失真残影' : intelAgeText(selectedReport, intel.visible_turn)}
                      ，可信度{formatConfidence(selectedReport.confidence)}。
                      {selectedNodeSignal?.state === 'jammed'
                        ? '该区域链路受干扰，残影可能比标注更旧。'
                        : intelRiskText(selectedReport, intel.visible_turn)}
                    </div>
                  </div>
                  <div>
                    异常标记：
                    {selectedReport.anomaly_flags.length
                      ? selectedReport.anomaly_flags.map((f) => formatAnomalyFlag(f)).join('、')
                      : '无'}
                  </div>
                </>
              ) : (
                <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                  <p>
                    此格当前<strong className="text-slate-300">没有锁定残影</strong>。盲打会直接轰击这个坐标；如果敌军已经离开，回执只会告诉你“坐标清空”。
                  </p>
                  {selectedNodeId === BLUE_BASE && (
                    <p className="rounded border border-amber-900/40 bg-amber-950/25 px-2 py-1.5 text-amber-100/90">
                      蓝方基地超出红方炮兵初始射程，不能开局直接斩首。先压中央隘口或旧中继站，等战线推进后再威胁敌方主帅。
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px] leading-snug text-slate-500">
                <div className="rounded border border-amber-900/30 bg-amber-950/10 px-2 py-1">
                  炮兵：远程盲打，命中造成高损伤。
                </div>
                <div className="rounded border border-cyan-900/30 bg-cyan-950/10 px-2 py-1">
                  骑兵：机动设伏，专门截穿插目标。
                </div>
              </div>
              <div className="pt-2">
                <div className="mb-1 text-xs font-mono text-slate-400">待发指令（未锁定可撤）</div>
                <ul className="space-y-1">
                  {intel.queued_commands.length === 0 && <li className="text-xs text-slate-500">暂无已入队指令</li>}
                  {intel.queued_commands.map((cmd) => (
                    <li key={cmd.command_id} className="flex items-center justify-between rounded border border-slate-700 px-2 py-1 text-xs">
                      <span>
                        {formatCommandType(cmd.type)}
                        {cmd.crisis_corridor ? `（${formatCorridor(cmd.crisis_corridor)}）` : ''} → {formatNode(cmd.target_node)} ［
                        {cmd.cp_cost} 指挥点］
                        {cmd.source_unit ? ` · ${cmd.source_unit}` : ''}
                        {cmd.locked ? ' 🔒' : ''}
                      </span>
                      <button
                        type="button"
                        className="rounded border border-rose-400 px-1 py-0.5 text-rose-300 transition-transform active:scale-95 hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={cmd.locked}
                        onClick={() => {
                          const ok = removeQueuedCommandAction(cmd.command_id);
                          if (ok) {
                            pulse();
                            if ('vibrate' in navigator) navigator.vibrate(8);
                          }
                        }}
                      >
                        撤销
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                className="w-full rounded border border-rose-400 px-2 py-1 text-rose-300 transition-transform active:scale-95 hover:bg-rose-900/20 disabled:opacity-40"
                disabled={!intel.crisis_available || intel.game_status !== 'ONGOING'}
                onClick={() => {
                  pulse();
                  setCrisisModalOpen(true);
                  setCrisisCorridor('north');
                }}
              >
                烽火总令
              </button>
            </div>
          ) : (
            <div className="space-y-2 text-slate-500">
              <div className={`rounded border px-2 py-1.5 text-[11px] leading-relaxed ${actionHint.tone}`}>
                <div className="font-semibold">{actionHint.title}</div>
                <div>{actionHint.body}</div>
              </div>
              <div>
                在沙盘上点选节点或敌情残影。噪声里，犹豫也会耗带宽。
              </div>
            </div>
          )}
        </aside>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-[18] mx-auto max-w-6xl border-t border-slate-800 bg-slate-950/95 text-xs shadow-[0_-12px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
        <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-slate-200">战场信道</span>
              <span className="font-mono text-[10px] text-slate-500">DELAYED RECEIPTS / 非实时链路</span>
              <span className="text-[10px] text-slate-500">
                回传 {intel.pending_battle_reports.length} · 战报 {intel.resolved_battle_reports.length} · 审计 {intel.audit_entries.length}
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-300">{latestSignalSummary}</div>
          </div>
          <button
            type="button"
            aria-expanded={signalDrawerOpen}
            onClick={() => setSignalDrawerOpen((open) => !open)}
            className="shrink-0 rounded border border-emerald-600/70 bg-emerald-950/30 px-2 py-1 text-[11px] text-emerald-200 transition-transform active:scale-95 hover:bg-emerald-900/35"
          >
            {signalDrawerOpen ? '收起' : '展开信道'}
          </button>
        </div>
        {signalDrawerOpen && (
          <div className="max-h-[46svh] overflow-y-auto border-t border-slate-800 px-3 py-2">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                <div className="text-slate-300">正在回传</div>
                <ul className="space-y-1 text-slate-400">
                  {intel.pending_battle_reports.length === 0 && <li>信道静默，没有战果回执在路上。</li>}
                  {intel.pending_battle_reports.map((report) => (
                    <li key={report.event_id}>
                      {formatNode(report.location)} 坐标包已离线缓存，预计 {Math.max(0, report.reveal_turn - intel.visible_turn)} 回合后解码
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                <div className="text-slate-300">已解码战报</div>
                <ul className="space-y-1 text-slate-200">
                  {intel.resolved_battle_reports.length === 0 && <li>没有确认命中记录。</li>}
                  {intel.resolved_battle_reports.map((report) => (
                    <li key={report.event_id}>{report.public_summary}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-2 rounded border border-slate-800 bg-slate-950/70 p-2">
              <div className="text-slate-300">指令回执</div>
              <ul className="space-y-1 text-slate-200">
                {intel.resolved_command_resolutions.length === 0 && <li>暂无回执。已发指令会在下一回合进入解码队列。</li>}
                {intel.resolved_command_resolutions.slice(0, 3).map((resolution) => (
                  <li key={resolution.command_id}>
                    ［{formatOutcome(resolution.outcome)}］{resolution.public_summary}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-2 rounded border border-slate-700 bg-slate-950/70 p-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-slate-200">时间轴 · 审计副本</div>
                <button
                  type="button"
                  onClick={toggleReviewMode}
                  className={`rounded border px-2 py-0.5 text-[11px] transition-transform active:scale-95 ${
                    reviewMode === 'archive'
                      ? 'border-rose-500 text-rose-300 hover:bg-rose-900/30'
                      : 'border-emerald-500 text-emerald-300 hover:bg-emerald-900/30'
                  }`}
                >
                  {reviewMode === 'archive' ? '模式：解密档案' : '模式：情报终端'}
                </button>
              </div>
              {reviewMode === 'intel' ? (
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {intelFeedTimeline.length === 0 && <div className="text-slate-500">暂无可显示时间轴记录</div>}
                  {intelFeedTimeline.slice(0, 30).map((item) => (
                    <div key={item.key} className={`rounded px-2 py-1 ${item.tone}`}>
                      <div className="text-[10px] text-slate-500">
                        第 {item.turn} 回合 | {item.phase}
                      </div>
                      <div className="font-semibold text-slate-100">
                        {item.title}
                        {item.count > 1 ? ` ×${item.count}` : ''}
                      </div>
                      <div className="text-slate-300">{item.body}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                  {groupedArchiveTurns.length === 0 && <div className="text-slate-500">暂无可显示时间轴记录</div>}
                  {groupedArchiveTurns.map(([turn, entries]) => {
                    const isOpen = expandedTurns.has(turn);
                    const combatCount = entries.reduce((sum, entry) => sum + (entry.eventType === 'COMBAT' ? entry.count : 0), 0);
                    const voidedCount = entries.reduce((sum, entry) => sum + (entry.eventType === 'COMMAND_VOID' ? entry.count : 0), 0);
                    const crisisCount = entries.reduce((sum, entry) => sum + (entry.eventType === 'CRISIS_ORDER' ? entry.count : 0), 0);

                    return (
                      <div id={`aar-turn-${turn}`} key={turn} className="rounded border border-slate-700">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-2 py-1 text-left transition-transform active:scale-[0.99] hover:bg-slate-800/70"
                          onClick={() =>
                            setExpandedTurns((prev) => {
                              const next = new Set(prev);
                              if (next.has(turn)) next.delete(turn);
                              else next.add(turn);
                              return next;
                            })
                          }
                        >
                          <span className="text-slate-200">
                            {isOpen ? '▼' : '▶'} 第 {turn} 回合
                          </span>
                          <span className="flex items-center gap-1 text-[10px]">
                            <span className="rounded bg-slate-700 px-1 py-0.5 text-slate-200">交战 {combatCount}</span>
                            <span className="rounded bg-amber-900/40 px-1 py-0.5 text-amber-300">作废 {voidedCount}</span>
                            <span className="rounded bg-rose-900/40 px-1 py-0.5 text-rose-300">危机令 {crisisCount}</span>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="space-y-1 border-t border-slate-700 px-2 py-1">
                            {entries.map((item) => (
                              <div key={item.key} className={`rounded px-2 py-1 ${item.tone}`}>
                                <div className="text-[10px] text-slate-500">{item.phase}</div>
                                <div className="font-semibold text-slate-100">
                                  {item.title}
                                  {item.count > 1 ? ` ×${item.count}` : ''}
                                </div>
                                <div className="text-slate-300">{item.body}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </footer>
      {rulesPanelOpen && (
        <div className="fixed inset-0 z-[24] flex items-center justify-center bg-black/65 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-sky-700/80 bg-slate-950 text-sm shadow-[0_0_80px_rgba(0,0,0,0.65)]">
            <div className="border-b border-slate-800 px-4 py-3">
              <div className="font-mono text-[10px] tracking-widest text-sky-400/80">MISSION BRIEF</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">任务简报</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                这不是实时战场。你知道自己的部署；敌情则以我方主帅为情报中心，按距离延迟送达。
              </div>
              <div className="mt-2 rounded border border-sky-900/50 bg-sky-950/20 px-2 py-1.5 text-xs text-sky-100">
                当前敌情剧本：{intel.enemy_script.label} #{intel.enemy_script.seed} · {intel.enemy_script.brief}
              </div>
            </div>
            <div className="max-h-[72svh] space-y-3 overflow-y-auto px-4 py-3">
              <div className="grid gap-2 md:grid-cols-3">
                {PLAYABLE_ENEMY_SCRIPT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`rounded border p-2 text-left text-xs transition-transform active:scale-[0.98] ${
                      intel.enemy_script.mode === mode
                        ? 'border-sky-400 bg-sky-950/45 text-sky-100'
                        : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-sky-700'
                    }`}
                    onClick={() => {
                      restartGameAction(mode);
                      setExpandedTurns(new Set());
                      setGameOverOverlayOpen(false);
                      setSignalDrawerOpen(false);
                    }}
                  >
                    <div className="font-semibold">{SCRIPTED_ENEMY_SCENARIOS[mode].label}</div>
                    <div className="mt-1 leading-relaxed">{SCRIPTED_ENEMY_SCENARIOS[mode].brief}</div>
                  </button>
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded border border-emerald-800/70 bg-emerald-950/20 p-2">
                  <div className="font-semibold text-emerald-100">怎么赢</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-300">
                    任意存活我方单位进入蓝方基地会立刻胜利；消灭全部敌军也会胜利；如果撑到第 10 回合，则比较关键点控制数。
                  </div>
                </div>
                <div className="rounded border border-rose-800/70 bg-rose-950/20 p-2">
                  <div className="font-semibold text-rose-100">怎么输</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-300">
                    敌军进入红方基地，或我方主帅失去战斗力。敌我都有主帅，主帅阵亡会直接决定战役。
                  </div>
                </div>
                <div className="rounded border border-amber-800/70 bg-amber-950/20 p-2">
                  <div className="font-semibold text-amber-100">你在赌什么</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-300">
                    红色/琥珀标记是旧情报，不是敌军当前位置。目标距我方主帅几格，常规情报就慢几回合。
                  </div>
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                <div className="mb-2 font-semibold text-slate-100">每回合发生顺序</div>
                <ol className="space-y-1 text-xs leading-relaxed text-slate-300">
                  <li>1. 你在本回合花指挥点，把调动、移营、盲打、设伏或烽火总令加入队列。</li>
                  <li>2. 点击推进回合后，敌军先按真实路线机动并处理接敌。</li>
                  <li>3. 你的队列命令再按结算时的真实坐标判定命中、落空或作废。</li>
                  <li>4. 我方部署始终可见；敌情和战果回执延迟送达，地图上的残影路径会帮助你推断下一跳。</li>
                </ol>
              </div>
              <div className="rounded border border-fuchsia-900/60 bg-fuchsia-950/15 p-3">
                <div className="mb-2 font-semibold text-fuchsia-100">认知迷雾</div>
                <div className="space-y-1 text-xs leading-relaxed text-slate-300">
                  <div>争夺节点只报告战斗，不再转发视野。</div>
                  <div>争夺节点背后的区域会进入信号阴影：残影变脏，可信度下降，延迟可能更久。</div>
                  <div>这不是看不见，而是不敢信。</div>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="mb-2 font-semibold text-slate-100">敌军特征</div>
                  <div className="space-y-1 text-xs leading-relaxed text-slate-300">
                    <div>主帅：通常在蓝方基地；击杀敌方主帅可以直接结束战役。</div>
                    <div>骑兵：移动快，会绕线冲基地；适合用设伏提前截。</div>
                    <div>步兵：推进慢，常占关键点；盲打和持续压制更有效。</div>
                  </div>
                </div>
                <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                  <div className="mb-2 font-semibold text-slate-100">本方兵种与命令</div>
                  <div className="space-y-1 text-xs leading-relaxed text-slate-300">
                    <div>主帅：情报中心；距离主帅越远，敌情越慢。</div>
                    <div>节点调动：普通单位向相邻节点推进，1 指挥点。</div>
                    <div>主帅移营：主帅移至相邻且有我方护卫的节点，2 指挥点，会重塑情报网。</div>
                    <div>炮兵：执行炮兵盲打，1 指挥点，射程 2 格，命中造成高损伤。</div>
                    <div>骑兵：执行骑兵设伏，2 指挥点，对敌骑兵截击效果最好。</div>
                    <div>步兵：前沿占点，容易挡住敌军但也最容易被突击打掉。</div>
                    <div>侦察哨：前出观察位，帮助你在地图上理解自己不是光杆司令。</div>
                    <div>烽火总令：立刻揭示一条走廊真实敌情，但下回合少 2 指挥点。</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">
              <button
                type="button"
                className="rounded border border-sky-500 px-3 py-1.5 text-sky-100 transition-transform active:scale-95 hover:bg-sky-900/30"
                onClick={() => setRulesPanelOpen(false)}
              >
                开始指挥
              </button>
            </div>
          </div>
        </div>
      )}
      {crisisModalOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md overflow-y-auto rounded border border-rose-600 bg-slate-950 p-4 text-sm max-h-[85svh]">
            <div className="mb-2 font-semibold text-rose-300">🚨 烽火总令</div>
            <div className="mb-3 text-xs text-slate-300">
              将对选定走廊执行情报过载：本回合强制揭示敌军真实位置，并在下回合产生 2 点指挥点债务。指令<strong className="text-rose-200">锁定</strong>
              ，入队后不可撤销。
            </div>
            <label className="mb-4 block text-xs text-slate-300">
              走廊选择
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={crisisCorridor}
                onChange={(e) => setCrisisCorridor(e.target.value as CrisisCorridor)}
              >
                <option value="north">北线走廊</option>
                <option value="south">南线走廊</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-slate-300 transition-transform active:scale-95 hover:bg-slate-800"
                onClick={() => setCrisisModalOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded border border-rose-500 px-2 py-1 text-rose-200 transition-transform active:scale-95 hover:bg-rose-900/30 disabled:opacity-40"
                onClick={() => {
                  const ok = queueCrisisOrderAction(crisisCorridor);
                  if (ok) {
                    if (sfxOn) void unlockAudio().then(() => playCommit());
                    if ('vibrate' in navigator) {
                      navigator.vibrate(50);
                    }
                    setCrisisModalOpen(false);
                  }
                }}
              >
                执行
              </button>
            </div>
          </div>
        </div>
      )}
      {gameOverOverlayOpen && intel.game_status !== 'ONGOING' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/80 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-lg border border-slate-600/80 bg-slate-950/95 p-5 text-sm shadow-[0_0_80px_rgba(0,0,0,0.6)]">
            <div className="mb-1 font-mono text-[10px] tracking-widest text-slate-500">指挥链路静默</div>
            <div className="mb-1 text-xs text-amber-200/80">战役结束</div>
            <div className="mb-2 bg-gradient-to-r from-amber-100 to-slate-100 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
              {statusLabel(intel.game_status)}
            </div>
            <div className="mb-4 text-slate-300">{gameOverVerdict(intel.game_status)}</div>
            <div className="mb-4 space-y-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs">
              <div className="font-semibold text-slate-200">这局为什么会这样</div>
              {gameOverHighlights.length === 0 && <div className="text-slate-500">暂无关键摘要</div>}
              {gameOverHighlights.map((entry, index) => (
                <div key={`${entry.turn}-${entry.event_type}-${index}`} className={gameOverEventTone(entry)}>
                  <div className="font-semibold">
                    第 {entry.turn} 回合 · {gameOverEventTitle(entry)}
                  </div>
                  <div className="mt-0.5 leading-relaxed text-slate-300">{gameOverEventSummary(entry)}</div>
                </div>
              ))}
            </div>
            <div className="mb-4 rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300">
              下一局优先复盘：{aarAnchorTurn ? `第 ${aarAnchorTurn} 回合` : '关键转折回合'}。{gameOverReviewHint(intel.game_status)}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded border border-slate-600 px-3 py-1 text-slate-200 transition-transform active:scale-95 hover:bg-slate-800"
                onClick={() => {
                  restartGameAction();
                  setExpandedTurns(new Set());
                  setGameOverOverlayOpen(false);
                  setSignalDrawerOpen(false);
                }}
              >
                重开 10 回合测试
              </button>
              <button
                type="button"
                className="rounded border border-emerald-500 px-3 py-1 text-emerald-300 transition-transform active:scale-95 hover:bg-emerald-900/30"
                onClick={() => {
                  setReviewMode('archive');
                  setSignalDrawerOpen(true);
                  if (aarAnchorTurn) {
                    setExpandedTurns(new Set([aarAnchorTurn]));
                    setTimeout(() => {
                      document.getElementById(`aar-turn-${aarAnchorTurn}`)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                      });
                    }, 0);
                  }
                  setGameOverOverlayOpen(false);
                }}
              >
                进入战后复盘
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function positionToPercent(nodeId: string): { x: string; y: string } {
  const layout = TEST_MAP_LAYOUT[nodeId];
  return { x: layout.x, y: layout.y };
}

function statusLabel(status: string): string {
  if (status === 'VICTORY') return '胜利';
  if (status === 'DEFEAT') return '失败';
  if (status === 'DRAW') return '平局';
  return '进行中';
}

function gameOverVerdict(status: string): string {
  if (status === 'VICTORY') return '你达成了战役目标：占领蓝方基地、清空敌军，或在最终回合控制了更多关键点。';
  if (status === 'DEFEAT') return '敌军突破到红方基地，主帅遭到接敌打击。问题不在最后一回合才出现，而是前几回合没能提前拦住穿插路线。';
  if (status === 'DRAW') return '双方主力僵持，战局进入胶着停火。';
  return '战役仍在进行。';
}

function buildActionHint(args: {
  selectedNodeId?: string;
  selectedReport?: IntelReport;
  selectedNodeSignal?: NodeSignalIntel;
  selectedNodeIntelDelay?: number;
  selectedNodeArtilleryRange?: number;
  selectedFriendlyUnit?: FriendlyUnitIntel;
  selectedUnitCanMove: boolean;
  commanderCanRedeploy: boolean;
  artilleryCanStrike: boolean;
  currentCp: number;
  visibleTurn: number;
  queuedCount: number;
  gameStatus: string;
}): ActionHint {
  if (args.gameStatus !== 'ONGOING') {
    return {
      title: '战役已结束',
      body: '进入战后复盘，确认真实路线和当时看到的残影差在哪里。',
      tone: 'border-slate-700 bg-slate-900/70 text-slate-300',
    };
  }
  if (!args.selectedNodeId) {
    return {
      title: '第一步：点一个节点',
      body: '先选地图上的节点或敌情残影。右侧会告诉你射程、延迟和这条情报能不能信。',
      tone: 'border-sky-800/70 bg-sky-950/20 text-sky-100',
    };
  }
  if (args.selectedNodeSignal?.state === 'contested') {
    return {
      title: '这里正在接敌',
      body: '争夺节点只报告战斗，不转发视野。先想办法稳住这里，后方情报才会恢复。',
      tone: 'border-rose-700 bg-rose-950/25 text-rose-100',
    };
  }
  if (args.selectedNodeSignal?.state === 'jammed') {
    return {
      title: '这片区域不敢信',
      body: '信号阴影里的残影会更脏。别把它当实时坐标，优先考虑设伏通路或启动烽火总令。',
      tone: 'border-fuchsia-800 bg-fuchsia-950/20 text-fuchsia-100',
    };
  }
  if (
    args.selectedFriendlyUnit &&
    args.selectedFriendlyUnit.unit_type !== 'commander' &&
    args.selectedUnitCanMove
  ) {
    return {
      title: '这里可以推进',
      body: `${unitShortName(args.selectedFriendlyUnit.unit_type)} ${args.selectedFriendlyUnit.unit_id} 能走到这里。调动后它会成为新的前线触点，可能占点，也可能撞上敌军。`,
      tone: 'border-emerald-800/70 bg-emerald-950/20 text-emerald-100',
    };
  }
  if (args.commanderCanRedeploy) {
    return {
      title: '这里可以移营',
      body: '目标点已有我方护卫。主帅前推会让前线情报更快，但后方会变慢，风险也会跟着上来。',
      tone: 'border-sky-800/70 bg-sky-950/20 text-sky-100',
    };
  }
  if (args.selectedReport) {
    const age = Math.max(0, args.visibleTurn - args.selectedReport.observed_turn);
    if (args.artilleryCanStrike && args.currentCp >= 1) {
      return {
        title: '可打，但先看残影年龄',
        body: `炮兵够得着这里。若残影已经 ${age} 回合以上，命中取决于你是否猜对敌军下一步。`,
        tone: 'border-amber-800/70 bg-amber-950/20 text-amber-100',
      };
    }
    return {
      title: '残影有价值，但炮兵够不着',
      body: '把它当路线线索，而不是炮击坐标。骑兵设伏更适合押敌军下一跳。',
      tone: 'border-cyan-800/70 bg-cyan-950/20 text-cyan-100',
    };
  }
  if (args.selectedNodeArtilleryRange !== undefined && args.selectedNodeArtilleryRange > ARTILLERY_RANGE_HOPS) {
    return {
      title: '炮兵超射程',
      body: '这个点现在不能被炮兵盲打。先压近战线，或把它作为敌军路线判断点。',
      tone: 'border-rose-900/60 bg-rose-950/20 text-rose-200',
    };
  }
  if (args.queuedCount > 0) {
    return {
      title: '已有命令待结算',
      body: '推进回合后，敌军先真实机动，你的命令再按结算时坐标判定。',
      tone: 'border-emerald-800/70 bg-emerald-950/20 text-emerald-100',
    };
  }
  return {
    title: '空坐标也能下令',
    body: '盲打不检查这里有没有残影，只检查结算时敌军在不在。谨慎花指挥点。',
    tone: 'border-slate-700 bg-slate-900/70 text-slate-300',
  };
}

function buildAdvisorMessage(args: {
  intel: PlayerIntelState;
  selectedNodeId?: string;
  selectedReport?: IntelReport;
  selectedNodeSignal?: NodeSignalIntel;
  artilleryCanStrike: boolean;
  selectedNodeArtilleryRange?: number;
  latestSignalSummary: string;
}): AdvisorMessage {
  const latestResolution = args.intel.resolved_command_resolutions[0];
  const latestReport = args.intel.visible_reports[args.intel.visible_reports.length - 1];
  const jammedCount = args.intel.signal_nodes.filter((node) => node.state === 'jammed').length;

  if (args.intel.game_status === 'DEFEAT') {
    return {
      key: `sergeant-defeat-${args.intel.visible_turn}`,
      speaker: 'sergeant',
      title: '军士长',
      text: '你不是输在火力不够，是输在把残影当成了坐标。打开复盘，看敌军真实路线从哪一回合开始绕开了你的判断。',
    };
  }
  if (args.intel.game_status === 'VICTORY') {
    return {
      key: `zero7-victory-${args.intel.visible_turn}`,
      speaker: 'zero7',
      title: '零七',
      text: '目标确认，链路还活着。指挥官，我们真的把这局从噪声里拽出来了。',
    };
  }
  if (latestResolution && /调动|移营/.test(latestResolution.public_summary)) {
    return {
      key: `zero7-move-${latestResolution.command_id}`,
      speaker: 'zero7',
      title: '零七',
      text:
        latestResolution.outcome === 'executed'
          ? '我方位置已刷新。主帅和部队动起来后，整张图的延迟会跟着改变，前线不再是死坐标。'
          : '调动没有按计划完成。不是按钮坏了，是路线上发生了接敌或护卫点失联，回放里能看到断点。',
    };
  }
  if (latestResolution?.outcome === 'failed') {
    return {
      key: `zero7-failed-${latestResolution.command_id}`,
      speaker: 'zero7',
      title: '零七',
      text: '弹着点确认，目标区空了。不是炮兵的问题，是我们打到了一张旧照片。',
    };
  }
  if (latestResolution?.outcome === 'voided') {
    return {
      key: `zero7-voided-${latestResolution.command_id}`,
      speaker: 'zero7',
      title: '零七',
      text: '这条命令没有回声。执行单位失联了，队列里的计划也跟着断掉。',
    };
  }
  if (args.selectedNodeSignal?.state === 'jammed' || jammedCount > 0) {
    return {
      key: `zero7-jammed-${args.selectedNodeId ?? jammedCount}-${args.intel.visible_turn}`,
      speaker: 'zero7',
      title: '零七',
      text: '噪声在抬升，后面的坐标开始漂。指挥官，这片区域现在只能参考，不能相信。',
    };
  }
  if (args.selectedReport) {
    const age = Math.max(0, args.intel.visible_turn - args.selectedReport.observed_turn);
    return {
      key: `zero7-report-${args.selectedReport.report_id}-${args.selectedNodeId ?? ''}`,
      speaker: 'zero7',
      title: '零七',
      text: `这份${args.selectedReport.observed_unit_type}坐标慢了 ${age} 回合。红点不是敌人本体，是它留在链路里的影子。`,
    };
  }
  if (args.selectedNodeArtilleryRange !== undefined && !args.artilleryCanStrike) {
    return {
      key: `zero7-range-${args.selectedNodeId}-${args.selectedNodeArtilleryRange}`,
      speaker: 'zero7',
      title: '零七',
      text: `炮兵够不到这个点。现在打不到，不代表这里不重要，它可能是敌军下一跳的路口。`,
    };
  }
  if (args.intel.queued_commands.length > 0) {
    return {
      key: `zero7-queued-${args.intel.queued_commands.length}-${args.intel.visible_turn}`,
      speaker: 'zero7',
      title: '零七',
      text: '命令已经压进队列。推进后敌军会先动，我们看到的答案永远晚一拍。',
    };
  }
  if (latestReport) {
    return {
      key: `zero7-latest-report-${latestReport.report_id}`,
      speaker: 'zero7',
      title: '零七',
      text: `刚收到新残影：${formatNode(latestReport.observed_position)}。先看它几回合前，再决定是炮击还是设伏。`,
    };
  }
  return {
    key: `zero7-idle-${args.intel.visible_turn}-${args.latestSignalSummary}`,
    speaker: 'zero7',
    title: '零七',
    text: '链路接上了。先别急着相信红点，那些是残影，不是敌人本体。点一个节点，我会把风险读给你听。',
  };
}

function buildTurnPreview(intel: PlayerIntelState): string {
  if (intel.game_status !== 'ONGOING') return '战役已结束。现在最有价值的是打开复盘，看真实路线和残影错位。';
  if (intel.queued_commands.length === 0) {
    return '尚未下令。你可以调动前线单位、判断残影年龄，也可以直接推进一回合观察敌军轨迹。';
  }
  const commands = intel.queued_commands
    .map((cmd) => {
      const commandName =
        cmd.type === 'MOVE' && cmd.source_unit === 'P-CMD-1'
          ? '主帅移营'
          : cmd.type === 'MOVE'
            ? `${cmd.source_unit ?? '单位'}调动`
            : formatCommandType(cmd.type);
      return `${commandName}${cmd.crisis_corridor ? `(${formatCorridor(cmd.crisis_corridor)})` : ''}→${formatNode(cmd.target_node)}`;
    })
    .join('，');
  return `敌军先真实机动；随后结算：${commands}；战报和回执会延迟送达。`;
}

function buildMoveButtonHelp(args: {
  selectedNodeId?: string;
  selectedUnit?: FriendlyUnitIntel;
  distance?: number;
  currentCp: number;
  gameStatus: string;
  pendingMove: boolean;
}): string {
  if (args.gameStatus !== 'ONGOING') return '战役已经结束，当前不能再调动单位。';
  if (!args.selectedUnit) return '先在“本方部署”里选一个存活单位。';
  if (args.selectedUnit.unit_type === 'commander') return '主帅不使用普通调动，请使用“主帅移营”。';
  if (!args.selectedNodeId) return '先在沙盘上选择一个相邻目标节点。';
  if (args.pendingMove) return `${args.selectedUnit.unit_id} 本回合已有命令，推进后再下新令。`;
  if (args.currentCp < 1) return '指挥点不足，节点调动需要 1 点。';
  if (args.distance === 0) return `${args.selectedUnit.unit_id} 已经在这个节点。`;
  if (args.distance !== 1) {
    return args.distance === undefined
      ? '无法读取目标距离。'
      : `${args.selectedUnit.unit_id} 距目标 ${args.distance} 格；普通调动只能走相邻节点。`;
  }
  return `命令 ${args.selectedUnit.unit_id} 推进到 ${formatNode(args.selectedNodeId)}。若敌军同时撞上这里，会变成遭遇战。`;
}

function buildCommanderMoveHelp(args: {
  selectedNodeId?: string;
  commander?: FriendlyUnitIntel;
  distance?: number;
  currentCp: number;
  gameStatus: string;
  targetScreened: boolean;
  pendingMove: boolean;
}): string {
  if (args.gameStatus !== 'ONGOING') return '战役已经结束，主帅不能再移营。';
  if (!args.commander || args.commander.hp <= 0) return '主帅失联，无法移营。';
  if (!args.selectedNodeId) return '先选择一个主帅相邻节点。';
  if (args.pendingMove) return '主帅本回合已有命令。';
  if (args.currentCp < 2) return '指挥点不足，主帅移营需要 2 点。';
  if (args.distance === 0) return '主帅已经在这个节点。';
  if (args.distance !== 1) {
    return args.distance === undefined ? '无法读取主帅到目标的距离。' : `主帅距目标 ${args.distance} 格，只能移营到相邻节点。`;
  }
  if (!args.targetScreened) return '移营点必须已有我方存活单位护卫。先把步兵、骑兵或侦察哨推进过去。';
  return `移营到 ${formatNode(args.selectedNodeId)} 后，情报延迟会以新主帅位置重新计算。`;
}

function buildCommandButtonHelp(args: {
  command: 'artillery' | 'ambush';
  selectedNodeId?: string;
  currentCp: number;
  gameStatus: string;
  canUse: boolean;
  range?: number;
  pendingSourceCommand?: boolean;
}): string {
  if (args.gameStatus !== 'ONGOING') return '战役已经结束，当前不能再下达命令。';
  if (!args.selectedNodeId) return '先在沙盘上选择一个节点，命令才知道要打哪里。';
  if (args.command === 'artillery') {
    if (args.pendingSourceCommand) return '炮兵本回合已经有命令，不能同时调动和开火。';
    if (args.currentCp < 1) return '指挥点不足，炮兵盲打需要 1 点。';
    if (!args.canUse) {
      return args.range === undefined
        ? '炮兵阵地失联，暂时无法盲打。'
        : `目标距离炮兵 ${args.range} 格，超过 ${ARTILLERY_RANGE_HOPS} 格射程。`;
    }
    return '下令炮兵覆盖这个节点。注意：命中看的是下回合结算时的真实位置，不是现在的残影。';
  }
  if (args.pendingSourceCommand) return '骑兵本回合已经有命令，不能同时调动和设伏。';
  if (args.currentCp < 2) return '指挥点不足，骑兵设伏需要 2 点。';
  if (!args.canUse) return '骑兵失联或正在执行其他命令，暂时不能设伏。';
  return '让骑兵在这个节点设伏。它最适合押敌军下一跳，尤其是截敌骑兵。';
}

function buildTimelineItems(entries: AuditEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Map<string, TimelineItem>();

  for (const entry of entries) {
    const normalized = normalizeTimelineEntry(entry);
    if (!normalized) continue;
    const key = `${normalized.turn}|${normalized.phase}|${normalized.eventType}|${normalized.title}|${normalized.body}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    seen.set(key, normalized);
    items.push(normalized);
  }

  return items;
}

function normalizeTimelineEntry(entry: AuditEntry): TimelineItem | undefined {
  if (entry.event_type === 'INTEL_REVEAL' && /本回合(未收到|无新增)/.test(entry.message)) return undefined;
  if (entry.event_type === 'SYSTEM_ALERT' && entry.message.includes('未接敌')) return undefined;
  if (entry.event_type === 'MOVE' && /从 (.+) 机动至 \1/.test(entry.message)) return undefined;

  const title = timelineTitle(entry);
  const body = timelineBody(entry);
  if (!body) return undefined;

  return {
    key: `${entry.turn}-${entry.phase}-${entry.track}-${entry.event_type}-${title}-${body}`,
    turn: entry.turn,
    phase: timelinePhaseLabel(entry),
    eventType: entry.event_type,
    title,
    body,
    tone: timelineTone(entry.event_type),
    count: 1,
  };
}

function timelinePhaseLabel(entry: AuditEntry): string {
  if (entry.track === '玩家') return '你收到的情报';
  if (entry.track === '真实') return '真实战场';
  if (entry.event_type === 'COMMAND_ISSUE') return '命令入队';
  return '命令结算';
}

function timelineTitle(entry: AuditEntry): string {
  if (entry.event_type === 'INTEL_REVEAL' && entry.message.startsWith('收到残影')) return '收到敌情残影';
  if (entry.event_type === 'INTEL_REVEAL' && entry.message.startsWith('战报更新')) return '战报解码';
  if (entry.event_type === 'INTEL_REVEAL' && entry.message.startsWith('指令回执')) return '指令回执';
  if (entry.event_type === 'COMMAND_ISSUE') return '命令已入队';
  if (entry.event_type === 'COMMAND_OK') return '命令完成结算';
  if (entry.event_type === 'COMMAND_VOID') return '命令作废';
  if (entry.event_type === 'CRISIS_ORDER') return entry.message.includes('执行') ? '烽火总令启动' : '烽火总令入队';
  if (entry.event_type === 'MOVE') return '单位机动';
  if (entry.event_type === 'COMBAT') return '发生接敌';
  return '战场状态';
}

function timelineBody(entry: AuditEntry): string {
  const message = stripDebugIds(entry.message);

  if (entry.event_type === 'COMMAND_ISSUE') {
    const match = message.match(/类型：(.+?)，目标：(.+?)，来源单位：(.+?)）/);
    if (match) return `${match[1]} → ${match[2]}，由${friendlySourceName(match[3])}执行，等待下回合结算。`;
  }

  if (entry.event_type === 'MOVE') {
    const match = message.match(/(.+?) .+? 从 (.+?) 机动至 (.+?)。/);
    if (match) return `${match[1]}：${match[2]} → ${match[3]}。`;
  }

  if (entry.event_type === 'COMBAT') {
    const match = message.match(/(.+?)在 (.+?) 接敌，(.+?) 承受 (\d+) 点损伤(并失去战斗力)?。/);
    if (match) {
      return `${match[1]}在${match[2]}攻击${friendlySourceName(match[3])}，造成 ${match[4]} 点损伤${match[5] ? '，目标失去战斗力' : ''}。`;
    }
  }

  if (entry.event_type === 'COMMAND_OK') {
    if (message.includes('目标为空')) return '目标节点没有敌军。通常意味着残影已经过期，敌军提前转移。';
    const hit = message.match(/命中(.+?)，结果/);
    if (hit) return `火力命中敌方${hit[1]}。详细战果会在战报回执里解码。`;
  }

  if (entry.event_type === 'COMMAND_VOID') {
    return '执行这条命令的我方单位已经失联或失去战斗力，所以排队行动被取消。';
  }

  if (entry.event_type === 'CRISIS_ORDER') {
    const reveal = message.match(/强制揭示 (\d+) 个敌方目标，下回合指挥点债务 (\d+)/);
    if (reveal) return `立刻揭示 ${reveal[1]} 个敌方目标；下回合少 ${reveal[2]} 点指挥点。`;
    const corridor = message.match(/走廊：(.+?)，状态/);
    if (corridor) return `${corridor[1]}走廊已锁定，本回合结算时执行。`;
  }

  if (entry.event_type === 'INTEL_REVEAL' && message.startsWith('收到残影')) {
    const match = message.match(/收到残影：(.+?)@(.+?)［(.+?) 回合前］，可信度 (.+?)。/);
    if (match) return `${match[3]} 回合前，${match[2]} 出现${match[1]}；可信度 ${match[4]}。`;
  }

  if (entry.event_type === 'INTEL_REVEAL' && message.startsWith('战报更新')) {
    return message.replace(/^战报更新：/, '');
  }

  if (entry.event_type === 'INTEL_REVEAL' && message.startsWith('指令回执')) {
    return message
      .replace(/^指令回执：/, '')
      .replace(/ 异常标记：.+?。$/, '。')
      .replace(/前线联络中断，行动单位未在预定窗口响应/, '执行单位失联，行动取消');
  }

  return message.replace(/来源单位不可用/g, '执行单位失联').replace(/标记为已作废/g, '行动取消');
}

function stripDebugIds(message: string): string {
  return message
    .replace(/cmd_[a-z0-9]+/gi, '该指令')
    .replace(/P-ART-1/g, '炮兵')
    .replace(/P-CAV-1/g, '骑兵')
    .replace(/P-SCT-1/g, '侦察哨')
    .replace(/P-INF-1/g, '前沿步兵')
    .replace(/P-INF-2/g, '前哨步兵')
    .replace(/P-CMD-1/g, '我方主帅');
}

function friendlySourceName(source: string): string {
  if (source.includes('P-ART-1') || source.includes('炮兵')) return '炮兵';
  if (source.includes('P-CAV-1') || source.includes('骑兵')) return '骑兵';
  if (source.includes('P-SCT-1') || source.includes('侦察哨')) return '侦察哨';
  if (source.includes('P-INF-1') || source.includes('前沿步兵')) return '前沿步兵';
  if (source.includes('P-INF-2') || source.includes('前哨步兵')) return '前哨步兵';
  if (source.includes('P-CMD-1') || source.includes('我方主帅')) return '我方主帅';
  return source;
}

function timelineTone(eventType: AuditEntry['event_type']): string {
  if (eventType === 'COMBAT') return 'border border-rose-900/40 bg-rose-950/15';
  if (eventType === 'COMMAND_VOID') return 'border border-amber-900/50 bg-amber-950/15';
  if (eventType === 'CRISIS_ORDER') return 'border border-sky-900/50 bg-sky-950/15';
  if (eventType === 'COMMAND_OK') return 'border border-emerald-900/45 bg-emerald-950/15';
  if (eventType === 'MOVE') return 'border border-slate-700/70 bg-slate-900/55';
  return 'border border-slate-800 bg-slate-950/55';
}

function gameOverEventTone(entry: AuditEntry): string {
  if (entry.event_type === 'COMBAT' && entry.message.includes('红方基地')) return 'rounded border border-rose-800/70 bg-rose-950/25 p-2 text-rose-100';
  if (entry.event_type === 'COMMAND_VOID') return 'rounded border border-amber-800/70 bg-amber-950/20 p-2 text-amber-100';
  if (entry.event_type === 'CRISIS_ORDER') return 'rounded border border-sky-800/70 bg-sky-950/20 p-2 text-sky-100';
  return 'rounded border border-slate-700 bg-slate-950/60 p-2 text-slate-100';
}

function gameOverEventTitle(entry: AuditEntry): string {
  if (entry.event_type === 'COMBAT' && entry.message.includes('红方基地')) return '敌军冲进基地';
  if (entry.event_type === 'COMBAT') return '前线发生接敌';
  if (entry.event_type === 'COMMAND_VOID') return '有一条命令没能执行';
  if (entry.event_type === 'CRISIS_ORDER') return '你启动了烽火总令';
  if (entry.event_type === 'COMMAND_OK') return '火力指令完成结算';
  return '战场状态变化';
}

function gameOverEventSummary(entry: AuditEntry): string {
  if (entry.event_type === 'COMBAT' && entry.message.includes('红方基地')) {
    return '敌方单位已经抵达红方基地并打到主帅。到这一步时，防线基本被突破，必须在基地前一格就完成判断或设伏。';
  }
  if (entry.event_type === 'COMBAT') {
    return '有单位在同一节点遭遇。注意这类接敌会让后续依赖该单位的命令失效。';
  }
  if (entry.event_type === 'COMMAND_VOID') {
    return '这不是“没有点中”，而是执行命令的我方单位已经失联或失去战斗力，所以原本排队的行动被取消了。';
  }
  if (entry.event_type === 'CRISIS_ORDER') {
    return '烽火总令能立刻揭示一条走廊上的敌军，但下一回合会少 2 点指挥点。它适合救急，过早使用会让后续拦截更吃紧。';
  }
  if (entry.event_type === 'COMMAND_OK') {
    return '这条指令已经完成结算。具体命中或落空原因可以在展开信道后的审计副本里查看。';
  }
  return entry.message.replace(/cmd_[a-z0-9]+/gi, '该指令').replace(/ → /g, '，');
}

function gameOverReviewHint(status: string): string {
  if (status === 'DEFEAT') return '先看敌方骑兵残影是否已经指向基地，再看被作废的命令是不是依赖了已被打掉的前线单位。';
  if (status === 'VICTORY') return '确认哪一次设伏或盲打真正打断了敌军路线，下一局可以围绕这个窗口复现。';
  if (status === 'DRAW') return '重点看哪些残影被误判成实时位置，以及哪些指挥点花在了低价值坐标上。';
  return '检查关键命令和残影年龄。';
}

function unitMarkerClass(unitType: string, disabled: boolean): string {
  const base = 'inline-flex h-5 min-w-5 items-center justify-center border px-1 text-[10px] font-bold leading-none ';
  const dead = disabled ? 'opacity-35 grayscale ' : '';
  if (unitType === 'commander') return `${base}${dead}rounded-full border-emerald-100 bg-emerald-200 text-slate-950 shadow-[0_0_10px_rgba(110,231,183,0.65)]`;
  if (unitType === 'artillery') return `${base}${dead}rounded-sm border-amber-100 bg-amber-300 text-slate-950 shadow-[0_0_8px_rgba(252,211,77,0.45)]`;
  if (unitType === 'cavalry') return `${base}${dead}rounded-full border-cyan-100 bg-cyan-300 text-slate-950 shadow-[0_0_8px_rgba(103,232,249,0.45)]`;
  if (unitType === 'scout') return `${base}${dead}rounded border-lime-100 bg-lime-300 text-slate-950`;
  return `${base}${dead}rounded-sm border-emerald-100 bg-emerald-400 text-slate-950`;
}

function unitMarkerGlyph(unitType: string): string {
  if (unitType === 'commander') return '帅';
  if (unitType === 'artillery') return '炮';
  if (unitType === 'cavalry') return '骑';
  if (unitType === 'scout') return '侦';
  return '步';
}

function unitShortName(unitType: string): string {
  if (unitType === 'commander') return '主帅';
  return formatUnitType(unitType);
}

function unitRoleDescription(unitType: string): string {
  if (unitType === 'commander') return '情报中心';
  if (unitType === 'artillery') return '盲打火力';
  if (unitType === 'cavalry') return '设伏截击';
  if (unitType === 'scout') return '前出观察';
  return '前沿占点';
}

function intelReportMarkerClass(report: IntelReport, now: number, signal?: NodeSignalIntel): string {
  const age = Math.max(0, now - report.observed_turn);
  const dirty = signal?.state === 'jammed' || report.anomaly_flags.includes('signal_shadow');
  const fresh = dirty ? 'war-dirty-ghost opacity-55 ' : age <= 1 ? 'shadow-[0_0_12px_rgba(251,113,133,0.75)] opacity-100 ' : 'opacity-60 ';
  const base = `inline-block h-3 w-3 cursor-pointer ring-1 ring-rose-100 transition-transform hover:scale-125 ${fresh}`;
  if (report.observed_unit_type.includes('骑')) return `${base}rounded-full bg-rose-400`;
  return `${base}rotate-45 bg-amber-400`;
}

function buildGhostNodeSummary(reports: IntelReport[], now: number, signal?: NodeSignalIntel): { label: string; title: string; className: string } | undefined {
  if (reports.length === 0) return undefined;
  const latest = [...reports].sort((a, b) => b.observed_turn - a.observed_turn || b.reveal_turn - a.reveal_turn)[0];
  const age = Math.max(0, now - latest.observed_turn);
  const dirty = signal?.state === 'jammed' || reports.some((report) => report.anomaly_flags.includes('signal_shadow'));
  const unitTypes = Array.from(new Set(reports.map((report) => ghostUnitGlyph(report.observed_unit_type)))).join('/');
  const ageText = dirty ? '失真' : age === 0 ? '实时' : `${age}回前`;
  const tone = dirty
    ? 'border-fuchsia-900/40 bg-fuchsia-950/35 text-fuchsia-100'
    : age <= 1
      ? 'border-rose-900/40 bg-rose-950/35 text-rose-100'
      : age === 2
        ? 'border-amber-900/40 bg-amber-950/30 text-amber-100'
        : 'border-slate-700/60 bg-slate-950/55 text-slate-300';
  return {
    label: `敌情 ${unitTypes}${reports.length > 1 ? `×${reports.length}` : ''} · ${ageText}`,
    title: reports
      .map((report) => `${report.observed_unit_type} ${formatNode(report.observed_position)}，${intelAgeText(report, now)}`)
      .join(' / '),
    className: `mx-auto mt-1 max-w-full truncate rounded border px-1.5 py-0.5 text-[9px] leading-none ${tone}`,
  };
}

function ghostUnitGlyph(unitType: string): string {
  if (unitType.includes('主帅')) return '帅';
  if (unitType.includes('骑')) return '骑';
  if (unitType.includes('炮')) return '炮';
  if (unitType.includes('侦')) return '侦';
  return '步';
}

function intelAgeText(report: IntelReport, now: number): string {
  const age = Math.max(0, now - report.observed_turn);
  if (age === 0) return '实时强制揭示';
  if (age === 1) return '1 回合前残影';
  return `${age} 回合前残影`;
}

function intelRiskText(report: IntelReport, now: number): string {
  const age = Math.max(0, now - report.observed_turn);
  if (age <= 1) return '窗口还热，可以尝试压它的下一跳。';
  if (age === 2) return '目标可能已经脱离本格，建议优先设伏路径节点。';
  return '这基本是旧照片，直接盲打风险很高。';
}

function battleFeedbackClass(result: string): string {
  const tone =
    result === 'hit'
      ? 'border-rose-300 bg-rose-500/25 text-rose-100'
      : result === 'contact' || result === 'meeting'
        ? 'border-orange-300 bg-orange-500/25 text-orange-100'
      : 'border-slate-400 bg-slate-900/80 text-slate-200';
  return `absolute -right-1 -top-2 z-10 rounded border px-1 py-0.5 font-mono text-[9px] ${tone} war-battle-pop`;
}

function battleFeedbackLabel(result: string): string {
  if (result === 'hit') return 'HIT';
  if (result === 'contact' || result === 'meeting') return 'CLASH';
  return 'MISS';
}

function CPBudgetBar(props: {
  max: number;
  available: number;
  committed: number;
  previewCost: number;
}) {
  const { max, available, committed, previewCost } = props;
  const previewApplied = Math.min(previewCost, available);
  const previewOver = Math.max(0, previewCost - available);
  const previewText =
    previewCost > 0
      ? previewOver > 0
        ? `指挥点不足，仍缺 ${previewOver}`
        : `预计占用 ${previewCost} 指挥点`
      : '预览占位';

  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
        {Array.from({ length: max }, (_, index) => {
          const seg = index + 1;
          const isCommitted = seg <= committed;
          const isPreview = seg > committed && seg <= committed + previewApplied;
          let cls = 'h-3 rounded border border-slate-700 bg-slate-800';
          if (isCommitted) cls = 'h-3 rounded border border-amber-500 bg-amber-700/70';
          if (isPreview) cls = 'h-3 animate-pulse rounded border border-yellow-300 bg-yellow-500/30';
          return <div key={seg} className={cls} />;
        })}
      </div>
      <div
        className={`mt-1 min-h-[14px] text-[10px] leading-[14px] ${
          previewCost > 0 ? (previewOver > 0 ? 'text-rose-400' : 'text-yellow-300') : 'text-transparent'
        }`}
        aria-hidden={previewCost === 0}
      >
        {previewText}
      </div>
    </div>
  );
}
