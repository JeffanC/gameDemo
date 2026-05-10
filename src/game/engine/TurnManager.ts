import { getIntelDelayToCommander, getNodeHopDistance } from '../map/graph';
import {
  BLUE_BASE,
  CENTRAL_PASS,
  EAST_WATCH,
  NORTH_OUTPOST,
  OLD_RELAY,
  RED_BASE,
  SOUTH_FOREST,
  TEST_MAP_EDGES,
} from '../map/testMap7';
import type {
  AuditEntry,
  AuditEventType,
  AuditPhase,
  AuditTrack,
  BattleEvent,
  CrisisCorridor,
  CommandResolution,
  GameCommand,
  IntelReport,
  NodeSignalIntel,
  NodeId,
  PlayerIntelState,
  RealGameState,
  Unit,
} from '../types';
import {
  formatAnomalyFlag,
  formatCommandType,
  formatConfidence,
  formatCorridor,
  formatNode,
  formatOutcome,
  formatUnitType,
} from '../i18n/zh';
import {
  createEnemyScriptPlan,
  getScriptedEnemyNodeFromPlan,
  type EnemyScriptMode,
  type EnemyScriptPlan,
} from './scriptedEnemy';

const MAX_TURN = 10;
const BASE_MAX_CP = 6;
const MOVE_CP_COST = 1;
const COMMANDER_REDEPLOY_CP_COST = 2;
const BLIND_ATTACK_CP_COST = 1;
const AMBUSH_CP_COST = 2;
const CRISIS_CP_DEBT = 2;
const ARTILLERY_RANGE_HOPS = 2;

interface TurnManagerOptions {
  enemyScriptMode?: EnemyScriptMode;
  enemyScriptSeed?: number;
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export class TurnManager {
  private realState: RealGameState;
  private intelState: PlayerIntelState;
  private pendingIntelReports: IntelReport[] = [];
  private pendingCommands: GameCommand[] = [];
  private enemyScriptPlan: EnemyScriptPlan;
  private auditTrail: AuditEntry[] = [];
  private disruptedNodes = new Map<NodeId, number>();
  private lastEnemyMoves = new Map<string, { from: NodeId; to: NodeId }>();

  constructor(options: TurnManagerOptions = {}) {
    this.enemyScriptPlan = createEnemyScriptPlan(options.enemyScriptMode ?? 'tutorial', options.enemyScriptSeed);
    this.realState = {
      turn: 1,
      units: [
        { id: 'P-CMD-1', owner: 'player', type: 'commander', hp: 10, position_node: RED_BASE },
        { id: 'P-ART-1', owner: 'player', type: 'artillery', hp: 6, position_node: RED_BASE },
        { id: 'P-INF-1', owner: 'player', type: 'infantry', hp: 8, position_node: NORTH_OUTPOST },
        { id: 'P-CAV-1', owner: 'player', type: 'cavalry', hp: 7, position_node: SOUTH_FOREST },
        { id: 'P-SCT-1', owner: 'player', type: 'scout', hp: 5, position_node: EAST_WATCH },
        {
          id: 'E-CMD-1',
          owner: 'enemy',
          type: 'commander',
          hp: 10,
          position_node: getScriptedEnemyNodeFromPlan(this.enemyScriptPlan, 'E-CMD-1', 1),
        },
        {
          id: 'E-CAV-1',
          owner: 'enemy',
          type: 'cavalry',
          hp: 7,
          position_node: getScriptedEnemyNodeFromPlan(this.enemyScriptPlan, 'E-CAV-1', 1),
        },
        {
          id: 'E-INF-1',
          owner: 'enemy',
          type: 'infantry',
          hp: 9,
          position_node: getScriptedEnemyNodeFromPlan(this.enemyScriptPlan, 'E-INF-1', 1),
        },
      ],
    };
    this.intelState = {
      visible_reports: [],
      pending_battle_reports: [],
      resolved_battle_reports: [],
      pending_command_resolutions: [],
      resolved_command_resolutions: [],
      queued_commands: [],
      audit_entries: [],
      current_cp: BASE_MAX_CP,
      max_cp: BASE_MAX_CP,
      cp_debt: 0,
      crisis_available: true,
      friendly_units: [],
      signal_nodes: [],
      enemy_script: {
        mode: this.enemyScriptPlan.mode,
        label: this.enemyScriptPlan.label,
        brief: this.enemyScriptPlan.brief,
        seed: this.enemyScriptPlan.seed,
      },
      visible_turn: 1,
      max_turn: MAX_TURN,
      game_status: 'ONGOING',
    };
    this.refreshFriendlyIntel();
    this.refreshSignalIntel();
    this.captureEnemyIntelForCurrentTurn();
  }

  getPlayerIntelState(): PlayerIntelState {
    return structuredClone(this.intelState);
  }

  getAuditTrail(): AuditEntry[] {
    return structuredClone(this.auditTrail);
  }

  queueMoveUnit(sourceUnitId: string, targetNode: NodeId): boolean {
    if (this.intelState.game_status !== 'ONGOING') return false;
    const sourceUnit = this.realState.units.find((u) => u.id === sourceUnitId && u.owner === 'player' && u.hp > 0);
    if (!sourceUnit) return false;
    if (sourceUnit.type === 'commander') return false;
    if (this.hasPendingSourceCommand(sourceUnitId)) return false;
    const range = getNodeHopDistance(TEST_MAP_EDGES, sourceUnit.position_node, targetNode);
    if (range !== 1) return false;
    if (this.intelState.current_cp < MOVE_CP_COST) return false;

    this.intelState.current_cp -= MOVE_CP_COST;
    this.pendingCommands.push({
      command_id: makeId('cmd'),
      turn: this.realState.turn,
      issuer: 'player',
      type: 'MOVE',
      target_node: targetNode,
      source_unit: sourceUnit.id,
      cp_cost: MOVE_CP_COST,
      intel_snapshot_hash: this.getIntelSnapshotHash(),
    });
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'COMMAND_ISSUE',
      `调动入队 ${this.pendingCommands[this.pendingCommands.length - 1].command_id}（单位：${sourceUnit.id}，从 ${formatNode(sourceUnit.position_node)} 至 ${formatNode(targetNode)}）。`,
    );
    this.syncQueuedCommandsIntel();
    return true;
  }

  queueCommanderRedeploy(targetNode: NodeId): boolean {
    if (this.intelState.game_status !== 'ONGOING') return false;
    const commander = this.realState.units.find((u) => u.id === 'P-CMD-1' && u.owner === 'player' && u.hp > 0);
    if (!commander) return false;
    if (this.hasPendingSourceCommand(commander.id)) return false;
    const range = getNodeHopDistance(TEST_MAP_EDGES, commander.position_node, targetNode);
    if (range !== 1) return false;
    if (!this.hasProjectedFriendlyScreen(targetNode, commander.id)) return false;
    if (this.intelState.current_cp < COMMANDER_REDEPLOY_CP_COST) return false;

    this.intelState.current_cp -= COMMANDER_REDEPLOY_CP_COST;
    this.pendingCommands.push({
      command_id: makeId('cmd'),
      turn: this.realState.turn,
      issuer: 'player',
      type: 'MOVE',
      target_node: targetNode,
      source_unit: commander.id,
      cp_cost: COMMANDER_REDEPLOY_CP_COST,
      intel_snapshot_hash: this.getIntelSnapshotHash(),
    });
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'COMMAND_ISSUE',
      `主帅移营入队 ${this.pendingCommands[this.pendingCommands.length - 1].command_id}（从 ${formatNode(commander.position_node)} 至 ${formatNode(targetNode)}，前出护卫确认）。`,
    );
    this.syncQueuedCommandsIntel();
    return true;
  }

  queueBlindAttack(targetNode: NodeId): boolean {
    if (this.intelState.game_status !== 'ONGOING') return false;
    const artillery = this.realState.units.find((u) => u.id === 'P-ART-1' && u.owner === 'player' && u.hp > 0);
    if (!artillery) return false;
    if (this.hasPendingSourceCommand(artillery.id)) return false;
    const range = getNodeHopDistance(TEST_MAP_EDGES, artillery.position_node, targetNode);
    if (range > ARTILLERY_RANGE_HOPS) return false;
    if (this.intelState.current_cp < BLIND_ATTACK_CP_COST) return false;
    this.intelState.current_cp -= BLIND_ATTACK_CP_COST;
    this.pendingCommands.push({
      command_id: makeId('cmd'),
      turn: this.realState.turn,
      issuer: 'player',
      type: 'BLIND_STRIKE',
      target_node: targetNode,
      source_unit: artillery.id,
      cp_cost: BLIND_ATTACK_CP_COST,
      intel_snapshot_hash: this.getIntelSnapshotHash(),
    });
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'COMMAND_ISSUE',
      `指令入队 ${this.pendingCommands[this.pendingCommands.length - 1].command_id}（类型：${formatCommandType('BLIND_STRIKE')}，目标：${formatNode(targetNode)}，来源单位：${artillery.id}，射程：${range}/${ARTILLERY_RANGE_HOPS}）。`,
    );
    this.syncQueuedCommandsIntel();
    return true;
  }

  queueAmbush(targetNode: NodeId, sourceUnitId: string = 'P-CAV-1'): boolean {
    if (this.intelState.game_status !== 'ONGOING') return false;
    const sourceUnit = this.realState.units.find((u) => u.id === sourceUnitId && u.owner === 'player' && u.hp > 0);
    if (!sourceUnit) return false;
    if (this.hasPendingSourceCommand(sourceUnitId)) return false;
    if (this.intelState.current_cp < AMBUSH_CP_COST) return false;
    this.intelState.current_cp -= AMBUSH_CP_COST;
    this.pendingCommands.push({
      command_id: makeId('cmd'),
      turn: this.realState.turn,
      issuer: 'player',
      type: 'AMBUSH',
      target_node: targetNode,
      source_unit: sourceUnitId,
      cp_cost: AMBUSH_CP_COST,
      intel_snapshot_hash: this.getIntelSnapshotHash(),
    });
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'COMMAND_ISSUE',
      `指令入队 ${this.pendingCommands[this.pendingCommands.length - 1].command_id}（类型：${formatCommandType('AMBUSH')}，目标：${formatNode(targetNode)}，来源单位：${sourceUnitId}）。`,
    );
    this.syncQueuedCommandsIntel();
    return true;
  }

  queueCrisisOrder(corridor: CrisisCorridor): boolean {
    if (this.intelState.game_status !== 'ONGOING') return false;
    if (!this.intelState.crisis_available) return false;
    if (this.pendingCommands.some((cmd) => cmd.type === 'CRISIS_ORDER')) return false;
    this.pendingCommands.push({
      command_id: makeId('cmd'),
      turn: this.realState.turn,
      issuer: 'player',
      type: 'CRISIS_ORDER',
      target_node: RED_BASE,
      cp_cost: 0,
      locked: true,
      crisis_corridor: corridor,
      intel_snapshot_hash: this.getIntelSnapshotHash(),
    });
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'CRISIS_ORDER',
      `烽火总令入队 ${this.pendingCommands[this.pendingCommands.length - 1].command_id}（走廊：${formatCorridor(corridor)}，状态：锁定）。`,
    );
    this.syncQueuedCommandsIntel();
    return true;
  }

  removeQueuedCommand(commandId: string): boolean {
    const index = this.pendingCommands.findIndex((c) => c.command_id === commandId);
    if (index < 0) return false;
    if (this.pendingCommands[index].locked) return false;
    const [removed] = this.pendingCommands.splice(index, 1);
    this.intelState.current_cp = Math.min(this.intelState.max_cp, this.intelState.current_cp + removed.cp_cost);
    this.syncQueuedCommandsIntel();
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'SYSTEM_ALERT',
      `指令撤销 ${removed.command_id}（类型：${formatCommandType(removed.type)}，返还指挥点：${removed.cp_cost}）。`,
    );
    return true;
  }

  endTurn(): PlayerIntelState {
    if (this.intelState.game_status !== 'ONGOING') {
      return this.getPlayerIntelState();
    }

    // Phase 1: enemy movement/combat happens first in real state.
    this.resolveEnemyMovementCombatPhase();
    // Phase 2: queued player commands resolve against updated real state.
    this.resolvePendingCommands();
    this.resolveImmediateGameStatus();
    if (this.intelState.game_status === 'ONGOING' && this.realState.turn < MAX_TURN) {
      this.realState.turn += 1;
      this.intelState.visible_turn = this.realState.turn;
      const debt = this.intelState.cp_debt;
      const effectiveMaxCp = Math.max(0, BASE_MAX_CP - debt);
      this.intelState.max_cp = effectiveMaxCp;
      this.intelState.current_cp = effectiveMaxCp;
      this.intelState.cp_debt = 0;
      this.captureEnemyIntelForCurrentTurn();
    }
    this.resolveTimeoutGameStatus();
    this.revealIntelReports();
    this.revealBattleReports();
    this.revealCommandResolutions();
    this.refreshFriendlyIntel();
    this.refreshSignalIntel();
    return this.getPlayerIntelState();
  }

  private applyScriptedEnemyMovement(): void {
    for (const enemy of this.realState.units.filter((u) => u.owner === 'enemy' && u.hp > 0)) {
      enemy.position_node = getScriptedEnemyNodeFromPlan(this.enemyScriptPlan, enemy.id, this.realState.turn);
    }
  }

  private resolveEnemyMovementCombatPhase(): void {
    const turn = this.realState.turn;
    const activeEnemies = this.realState.units.filter((u) => u.owner === 'enemy' && u.hp > 0);
    const beforeNodes = new Map(activeEnemies.map((unit) => [unit.id, unit.position_node]));
    this.lastEnemyMoves = new Map();
    this.applyScriptedEnemyMovement();

    for (const enemy of activeEnemies) {
      const beforeNode = beforeNodes.get(enemy.id);
      this.lastEnemyMoves.set(enemy.id, { from: beforeNode ?? enemy.position_node, to: enemy.position_node });
      this.addAudit(
        turn,
        '机动与交战',
        '真实',
        'MOVE',
        `${formatUnitType(enemy.type)} ${enemy.id} 从 ${beforeNode ? formatNode(beforeNode) : '未知'} 机动至 ${formatNode(enemy.position_node)}。`,
      );

      const playerAtNode = this.realState.units.find(
        (u) => u.owner === 'player' && u.hp > 0 && u.position_node === enemy.position_node,
      );
      if (playerAtNode) {
        const damage = enemy.type === 'cavalry' ? 8 : 4;
        playerAtNode.hp = Math.max(0, playerAtNode.hp - damage);
        const counterDamage = this.getMovementContactDamage(playerAtNode, enemy);
        enemy.hp = Math.max(0, enemy.hp - counterDamage);
        this.addAudit(
          turn,
          '机动与交战',
          '真实',
          'COMBAT',
          `${formatUnitType(enemy.type)}在 ${formatNode(enemy.position_node)} 接敌，${playerAtNode.id} 承受 ${damage} 点损伤${playerAtNode.hp <= 0 ? '并失去战斗力' : ''}，敌军承受 ${counterDamage} 点反击${enemy.hp <= 0 ? '并脱离战斗' : ''}。`,
        );
        this.intelState.pending_battle_reports.push({
          event_id: makeId('battle'),
          location: enemy.position_node,
          event_turn: turn,
          real_result: 'contact',
          reveal_turn: turn,
          public_summary: `第 ${turn} 回合敌方${formatUnitType(enemy.type)}突入 ${formatNode(enemy.position_node)}，${playerAtNode.id} 受损 ${damage}，反击造成 ${counterDamage}。`,
        });
        this.disruptedNodes.set(enemy.position_node, turn);
      } else {
        this.addAudit(
          turn,
          '机动与交战',
          '真实',
          'SYSTEM_ALERT',
          `${formatUnitType(enemy.type)}在 ${formatNode(enemy.position_node)} 未接敌。`,
        );
      }
    }
  }

  private captureEnemyIntelForCurrentTurn(): void {
    const enemyUnits = this.realState.units.filter((u) => u.owner === 'enemy' && u.hp > 0);
    const playerCommanderNode =
      this.realState.units.find((u) => u.owner === 'player' && u.type === 'commander' && u.hp > 0)?.position_node ??
      RED_BASE;
    const signalByNode = this.getSignalNodeMap();
    for (const unit of enemyUnits) {
      const signal = signalByNode.get(unit.position_node);
      const inSignalShadow = signal?.state === 'jammed';
      const delay = getIntelDelayToCommander(TEST_MAP_EDGES, unit.position_node, playerCommanderNode) + (inSignalShadow ? 1 : 0);
      this.pendingIntelReports.push({
        report_id: makeId('intel'),
        target_owner: 'player',
        observed_unit_id: unit.id,
        observed_unit_type: formatUnitType(unit.type),
        observed_position: unit.position_node,
        observed_turn: this.realState.turn,
        reveal_turn: this.realState.turn + delay,
        confidence: inSignalShadow ? 'low' : delay <= 1 ? 'high' : delay === 2 ? 'medium' : 'low',
        anomaly_flags: inSignalShadow ? ['signal_shadow'] : [],
      });
    }
  }

  private revealIntelReports(): void {
    const now = this.realState.turn;
    const revealed = this.pendingIntelReports.filter((r) => r.reveal_turn <= now);
    this.pendingIntelReports = this.pendingIntelReports.filter((r) => r.reveal_turn > now);
    this.intelState.visible_reports.push(...revealed);
    if (revealed.length === 0) {
      this.addAudit(now, '情报揭示', '玩家', 'INTEL_REVEAL', '本回合未收到新的敌情残影。');
      return;
    }
    for (const report of revealed) {
      const age = now - report.observed_turn;
      this.addAudit(
        now,
        '情报揭示',
        '玩家',
        'INTEL_REVEAL',
        `收到残影：${report.observed_unit_type}@${formatNode(report.observed_position)}［${age} 回合前］，可信度 ${formatConfidence(report.confidence)}。`,
      );
    }
  }

  private resolvePendingCommands(): void {
    const commandsForResolution = [...this.pendingCommands].sort((a, b) => {
      return this.getCommandResolvePriority(a) - this.getCommandResolvePriority(b);
    });

    for (const command of commandsForResolution) {
      if (command.type === 'CRISIS_ORDER') {
        this.resolveCrisisOrder(command);
        continue;
      }
      if (command.type === 'MOVE') {
        this.resolveMoveCommand(command);
        continue;
      }
      if (command.type !== 'BLIND_STRIKE' && command.type !== 'AMBUSH') continue;
      const sourceUnit = command.source_unit
        ? this.realState.units.find((u) => u.id === command.source_unit && u.owner === 'player')
        : undefined;
      let resolution: CommandResolution;
      let battleEvent: BattleEvent | undefined;

      if (!sourceUnit || sourceUnit.hp <= 0) {
        resolution = {
          command_id: command.command_id,
          resolved_turn: this.realState.turn,
          outcome: 'voided',
          real_reason: 'SOURCE_UNIT_UNAVAILABLE',
          reveal_turn: command.turn + 1,
          public_summary: `第 ${command.turn} 回合${command.type === 'AMBUSH' ? '设伏' : '盲打'}指令未完成：前线联络中断，行动单位未在预定窗口响应。`,
          anomaly_flags: ['comm_lost', 'source_unavailable'],
        };
        this.addAudit(
          this.realState.turn,
          '指令执行',
          '引擎',
          'COMMAND_VOID',
          `解析 ${command.command_id} 失败：来源单位不可用 → 标记为已作废。`,
        );
      } else {
        if (
          command.type === 'BLIND_STRIKE' &&
          getNodeHopDistance(TEST_MAP_EDGES, sourceUnit.position_node, command.target_node) > ARTILLERY_RANGE_HOPS
        ) {
          resolution = {
            command_id: command.command_id,
            resolved_turn: this.realState.turn,
            outcome: 'voided',
            real_reason: 'OUT_OF_RANGE',
            reveal_turn: command.turn + 1,
            public_summary: `第 ${command.turn} 回合盲打指令未完成：炮兵阵地与目标距离变化，射程不再覆盖 ${formatNode(command.target_node)}。`,
            anomaly_flags: ['route_blocked'],
          };
          this.addAudit(
            this.realState.turn,
            '指令执行',
            '引擎',
            'COMMAND_VOID',
            `解析 ${command.command_id} 失败：炮兵射程不再覆盖 ${formatNode(command.target_node)}。`,
          );
          this.intelState.pending_command_resolutions.push(resolution);
          continue;
        }
        const targetEnemy = this.realState.units.find(
          (u) => u.owner === 'enemy' && u.position_node === command.target_node && u.hp > 0,
        );
        const hit = Boolean(targetEnemy);
        const damage = targetEnemy ? this.getCommandDamage(command, sourceUnit, targetEnemy) : 0;
        if (targetEnemy) {
          targetEnemy.hp = Math.max(0, targetEnemy.hp - damage);
        }
        const destroyed = Boolean(targetEnemy && targetEnemy.hp <= 0);
        resolution = {
          command_id: command.command_id,
          resolved_turn: this.realState.turn,
          outcome: hit ? 'executed' : 'failed',
          real_reason: hit ? 'OK' : 'TARGET_EMPTY',
          reveal_turn: command.turn + 1,
          public_summary: hit
            ? `第 ${command.turn} 回合${command.type === 'AMBUSH' ? '设伏' : '盲打'}指令已执行：${formatNode(command.target_node)} 命中${targetEnemy ? formatUnitType(targetEnemy.type) : '目标'}，造成 ${damage} 点损伤${destroyed ? '，目标脱离战斗序列' : ''}。`
            : `第 ${command.turn} 回合${command.type === 'AMBUSH' ? '设伏' : '盲打'}指令已执行：${formatNode(command.target_node)} 未发现目标，敌方疑似已转移。`,
          anomaly_flags: hit ? [] : ['stale_intel_possible'],
        };
        battleEvent = {
          event_id: makeId('battle'),
          location: command.target_node,
          event_turn: command.turn,
          real_result: hit ? 'hit' : 'miss',
          reveal_turn: command.turn + 1,
          public_summary: hit
            ? `第 ${command.turn} 回合对 ${formatNode(command.target_node)} 的攻击命中${targetEnemy ? formatUnitType(targetEnemy.type) : '目标'}，战损 ${damage}${destroyed ? '，目标消失' : ''}。`
            : `第 ${command.turn} 回合对 ${formatNode(command.target_node)} 的攻击未发现目标，敌方疑似已转移。`,
        };
        this.addAudit(
          this.realState.turn,
          '指令执行',
          '引擎',
          'COMMAND_OK',
          `解析 ${command.command_id} 完成：${hit ? `命中${targetEnemy ? formatUnitType(targetEnemy.type) : '目标'}` : '目标为空'}，结果 ${formatOutcome(resolution.outcome)}。`,
        );
      }

      this.intelState.pending_command_resolutions.push(resolution);
      if (battleEvent) {
        this.intelState.pending_battle_reports.push(battleEvent);
      }
    }
    this.pendingCommands = [];
    this.syncQueuedCommandsIntel();
  }

  private getCommandResolvePriority(command: GameCommand): number {
    if (command.type === 'CRISIS_ORDER') return 0;
    if (command.type === 'MOVE' && command.source_unit !== 'P-CMD-1') return 1;
    if (command.type === 'MOVE') return 2;
    return 3;
  }

  private resolveMoveCommand(command: GameCommand): void {
    const sourceUnit = command.source_unit
      ? this.realState.units.find((u) => u.id === command.source_unit && u.owner === 'player')
      : undefined;

    if (!sourceUnit || sourceUnit.hp <= 0) {
      this.pushMoveResolution(command, {
        outcome: 'voided',
        real_reason: 'SOURCE_UNIT_UNAVAILABLE',
        public_summary: `第 ${command.turn} 回合调动未完成：执行单位失联，命令自动作废。`,
        anomaly_flags: ['comm_lost', 'source_unavailable'],
      });
      this.addAudit(
        this.realState.turn,
        '指令执行',
        '引擎',
        'COMMAND_VOID',
        `解析 ${command.command_id} 失败：来源单位不可用 → 标记为已作废。`,
      );
      return;
    }

    const fromNode = sourceUnit.position_node;
    const range = getNodeHopDistance(TEST_MAP_EDGES, fromNode, command.target_node);
    if (range !== 1) {
      this.pushMoveResolution(command, {
        outcome: 'voided',
        real_reason: 'OUT_OF_RANGE',
        public_summary: `第 ${command.turn} 回合调动未完成：${sourceUnit.id} 已不在原定相邻位置，路线失效。`,
        anomaly_flags: ['route_blocked'],
      });
      this.addAudit(
        this.realState.turn,
        '指令执行',
        '引擎',
        'COMMAND_VOID',
        `解析 ${command.command_id} 失败：${sourceUnit.id} 至 ${formatNode(command.target_node)} 路线失效。`,
      );
      return;
    }

    if (sourceUnit.type === 'commander' && !this.hasFriendlyScreen(command.target_node, sourceUnit.id)) {
      this.pushMoveResolution(command, {
        outcome: 'voided',
        real_reason: 'INTERRUPTED_BY_COMBAT',
        public_summary: `第 ${command.turn} 回合主帅移营取消：${formatNode(command.target_node)} 护卫点失联，指挥部没有进入不明区域。`,
        anomaly_flags: ['screening_lost'],
      });
      this.addAudit(
        this.realState.turn,
        '指令执行',
        '引擎',
        'COMMAND_VOID',
        `解析 ${command.command_id} 失败：主帅移营目标护卫点失联。`,
      );
      return;
    }

    const crossingEnemy = this.findCrossingEnemy(fromNode, command.target_node);
    if (crossingEnemy) {
      this.disruptedNodes.set(fromNode, this.realState.turn);
      this.pushMoveResolution(command, {
        outcome: 'failed',
        real_reason: 'INTERRUPTED_BY_COMBAT',
        public_summary: `第 ${command.turn} 回合调动中止：${sourceUnit.id} 在 ${formatNode(fromNode)} 与敌方${formatUnitType(crossingEnemy.type)}迎头相撞，未能推进。`,
        anomaly_flags: ['meeting_engagement'],
      });
      this.intelState.pending_battle_reports.push({
        event_id: makeId('battle'),
        location: fromNode,
        event_turn: command.turn,
        real_result: 'meeting',
        reveal_turn: this.realState.turn,
        public_summary: `第 ${command.turn} 回合${sourceUnit.id} 的推进被敌方${formatUnitType(crossingEnemy.type)}撞断，双方退守原线。`,
      });
      this.addAudit(
        this.realState.turn,
        '机动与交战',
        '真实',
        'COMBAT',
        `${sourceUnit.id} 从 ${formatNode(fromNode)} 推进时，与敌方${formatUnitType(crossingEnemy.type)}迎头相撞，调动中止。`,
      );
      return;
    }

    sourceUnit.position_node = command.target_node;
    const commandLabel = sourceUnit.type === 'commander' ? '主帅移营' : '节点调动';
    this.addAudit(
      this.realState.turn,
      '机动与交战',
      '真实',
      'MOVE',
      `${sourceUnit.id} 从 ${formatNode(fromNode)} 机动至 ${formatNode(command.target_node)}。`,
    );
    const contactSummary = this.resolvePlayerMovementContact(sourceUnit, command);
    this.pushMoveResolution(command, {
      outcome: 'executed',
      real_reason: 'OK',
      public_summary: contactSummary
        ? `第 ${command.turn} 回合${commandLabel}完成：${sourceUnit.id} 从 ${formatNode(fromNode)} 抵达 ${formatNode(command.target_node)}，随即接敌。`
        : `第 ${command.turn} 回合${commandLabel}完成：${sourceUnit.id} 从 ${formatNode(fromNode)} 推进至 ${formatNode(command.target_node)}。`,
      anomaly_flags: contactSummary ? ['meeting_engagement'] : [],
    });
  }

  private pushMoveResolution(
    command: GameCommand,
    result: Pick<CommandResolution, 'outcome' | 'real_reason' | 'public_summary' | 'anomaly_flags'>,
  ): void {
    this.intelState.pending_command_resolutions.push({
      command_id: command.command_id,
      resolved_turn: this.realState.turn,
      outcome: result.outcome,
      real_reason: result.real_reason,
      reveal_turn: this.realState.turn,
      public_summary: result.public_summary,
      anomaly_flags: result.anomaly_flags,
    });
  }

  private findCrossingEnemy(fromNode: NodeId, targetNode: NodeId): Unit | undefined {
    return this.realState.units.find((unit) => {
      if (unit.owner !== 'enemy' || unit.hp <= 0) return false;
      const move = this.lastEnemyMoves.get(unit.id);
      return move?.from === targetNode && move.to === fromNode;
    });
  }

  private resolvePlayerMovementContact(sourceUnit: Unit, command: GameCommand): string | undefined {
    const targetEnemy = this.realState.units.find(
      (u) => u.owner === 'enemy' && u.hp > 0 && u.position_node === sourceUnit.position_node,
    );
    if (!targetEnemy) return undefined;

    const playerDamage = this.getMovementContactDamage(sourceUnit, targetEnemy);
    const enemyDamage = this.getEnemyContactDamage(targetEnemy, sourceUnit);
    targetEnemy.hp = Math.max(0, targetEnemy.hp - playerDamage);
    sourceUnit.hp = Math.max(0, sourceUnit.hp - enemyDamage);
    this.disruptedNodes.set(sourceUnit.position_node, this.realState.turn);

    const summary = `第 ${command.turn} 回合${sourceUnit.id} 推进至 ${formatNode(sourceUnit.position_node)}，与敌方${formatUnitType(targetEnemy.type)}遭遇；敌军损伤 ${playerDamage}，我方损伤 ${enemyDamage}${targetEnemy.hp <= 0 ? '，敌方目标脱离战斗' : ''}${sourceUnit.hp <= 0 ? '，我方单位失去战斗力' : ''}。`;
    this.intelState.pending_battle_reports.push({
      event_id: makeId('battle'),
      location: sourceUnit.position_node,
      event_turn: command.turn,
      real_result: 'contact',
      reveal_turn: this.realState.turn,
      public_summary: summary,
    });
    this.addAudit(
      this.realState.turn,
      '机动与交战',
      '真实',
      'COMBAT',
      `${sourceUnit.id} 在 ${formatNode(sourceUnit.position_node)} 与敌方${formatUnitType(targetEnemy.type)}遭遇，双方交换火力。`,
    );
    return summary;
  }

  private getMovementContactDamage(sourceUnit: Unit, targetEnemy: Unit): number {
    if (sourceUnit.type === 'cavalry') return targetEnemy.type === 'commander' ? 5 : 4;
    if (sourceUnit.type === 'infantry') return 3;
    if (sourceUnit.type === 'artillery') return 2;
    if (sourceUnit.type === 'scout') return 1;
    return 2;
  }

  private getEnemyContactDamage(enemy: Unit, playerUnit: Unit): number {
    const base = enemy.type === 'cavalry' ? 4 : enemy.type === 'infantry' ? 3 : 2;
    return playerUnit.type === 'commander' ? base + 1 : base;
  }

  private hasFriendlyScreen(targetNode: NodeId, commanderId: string): boolean {
    return this.realState.units.some(
      (unit) =>
        unit.owner === 'player' &&
        unit.hp > 0 &&
        unit.id !== commanderId &&
        unit.position_node === targetNode,
    );
  }

  private hasProjectedFriendlyScreen(targetNode: NodeId, commanderId: string): boolean {
    const projectedMoveTargets = new Map<string, NodeId>();
    for (const command of this.pendingCommands) {
      if (command.type !== 'MOVE' || !command.source_unit || command.source_unit === commanderId) continue;
      projectedMoveTargets.set(command.source_unit, command.target_node);
    }

    return this.realState.units.some((unit) => {
      if (unit.owner !== 'player' || unit.hp <= 0 || unit.id === commanderId) return false;
      return (projectedMoveTargets.get(unit.id) ?? unit.position_node) === targetNode;
    });
  }

  private hasPendingSourceCommand(sourceUnitId: string): boolean {
    return this.pendingCommands.some((command) => command.source_unit === sourceUnitId);
  }

  private getCommandDamage(command: GameCommand, sourceUnit: Unit, targetEnemy: Unit): number {
    if (command.type === 'BLIND_STRIKE') {
      return sourceUnit.type === 'artillery' ? 6 : 4;
    }
    if (command.type === 'AMBUSH') {
      if (sourceUnit.type === 'cavalry' && targetEnemy.type === 'cavalry') return 8;
      if (sourceUnit.type === 'cavalry') return 5;
      return targetEnemy.type === 'cavalry' ? 6 : 3;
    }
    return 3;
  }

  private resolveCrisisOrder(command: GameCommand): void {
    const corridor = command.crisis_corridor;
    if (!corridor) return;
    const corridorNodes = this.getCorridorNodes(corridor);
    const visibleEnemies = this.realState.units.filter(
      (u) => u.owner === 'enemy' && u.hp > 0 && corridorNodes.includes(u.position_node),
    );
    for (const enemy of visibleEnemies) {
      this.pendingIntelReports.push({
        report_id: makeId('intel'),
        target_owner: 'player',
        observed_unit_id: enemy.id,
        observed_unit_type: formatUnitType(enemy.type),
        observed_position: enemy.position_node,
        observed_turn: this.realState.turn,
        reveal_turn: this.realState.turn,
        confidence: 'high',
        anomaly_flags: ['crisis_overdrive'],
      });
    }

    this.intelState.cp_debt = CRISIS_CP_DEBT;
    this.intelState.crisis_available = false;
    this.addAudit(
      this.realState.turn,
      '指令执行',
      '引擎',
      'CRISIS_ORDER',
      `烽火总令执行（${formatCorridor(corridor)}走廊）：强制揭示 ${visibleEnemies.length} 个敌方目标，下回合指挥点债务 ${CRISIS_CP_DEBT}。`,
    );
  }

  private revealCommandResolutions(): void {
    const now = this.realState.turn;
    const resolved = this.intelState.pending_command_resolutions.filter((r) => r.reveal_turn <= now);
    this.intelState.pending_command_resolutions = this.intelState.pending_command_resolutions.filter(
      (r) => r.reveal_turn > now,
    );
    this.intelState.resolved_command_resolutions.unshift(...resolved);
    if (resolved.length === 0) {
      this.addAudit(now, '情报揭示', '玩家', 'INTEL_REVEAL', '本回合未收到新的指令回执。');
      return;
    }
    for (const item of resolved) {
      this.addAudit(
        now,
        '情报揭示',
        '玩家',
        'INTEL_REVEAL',
        `指令回执：［${formatOutcome(item.outcome)}］${item.public_summary} 异常标记：${
          item.anomaly_flags.length ? item.anomaly_flags.map((f) => formatAnomalyFlag(f)).join('、') : '无'
        }。`,
      );
    }
  }

  private resolveImmediateGameStatus(): void {
    const playerCommander = this.realState.units.find(
      (u) => u.owner === 'player' && u.type === 'commander',
    );
    if (!playerCommander || playerCommander.hp <= 0) {
      this.intelState.game_status = 'DEFEAT';
      return;
    }

    const playerOnBlueBase = this.realState.units.some(
      (u) => u.owner === 'player' && u.hp > 0 && u.position_node === BLUE_BASE,
    );
    if (playerOnBlueBase) {
      this.intelState.game_status = 'VICTORY';
      return;
    }

    const enemyCommander = this.realState.units.find(
      (u) => u.owner === 'enemy' && u.type === 'commander',
    );
    if (enemyCommander && enemyCommander.hp <= 0) {
      this.intelState.game_status = 'VICTORY';
      return;
    }

    const activeEnemies = this.realState.units.some((u) => u.owner === 'enemy' && u.hp > 0);
    if (!activeEnemies) {
      this.intelState.game_status = 'VICTORY';
      return;
    }

    const enemyOnRedBase = this.realState.units.some(
      (u) => u.owner === 'enemy' && u.hp > 0 && u.position_node === RED_BASE,
    );
    if (enemyOnRedBase) {
      this.intelState.game_status = 'DEFEAT';
    }
  }

  private resolveTimeoutGameStatus(): void {
    if (this.intelState.game_status !== 'ONGOING') return;
    if (this.realState.turn < MAX_TURN) return;

    const keyNodeIds = new Set<NodeId>(['NorthOutpost', 'CentralPass', 'SouthForest', 'OldRelay']);
    let playerControl = 0;
    let enemyControl = 0;
    for (const nodeId of keyNodeIds) {
      const hasPlayer = this.realState.units.some(
        (u) => u.owner === 'player' && u.hp > 0 && u.position_node === nodeId,
      );
      const hasEnemy = this.realState.units.some(
        (u) => u.owner === 'enemy' && u.hp > 0 && u.position_node === nodeId,
      );
      if (hasPlayer && !hasEnemy) playerControl += 1;
      if (hasEnemy && !hasPlayer) enemyControl += 1;
    }
    if (playerControl > enemyControl) {
      this.intelState.game_status = 'VICTORY';
      return;
    }
    if (enemyControl > playerControl) {
      this.intelState.game_status = 'DEFEAT';
      return;
    }
    this.intelState.game_status = 'DRAW';
  }

  private getIntelSnapshotHash(): string {
    const snapshot = {
      turn: this.intelState.visible_turn,
      visible_reports: this.intelState.visible_reports.map((r) => ({
        pos: r.observed_position,
        type: r.observed_unit_type,
        observed_turn: r.observed_turn,
      })),
    };
    const json = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(json);
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).slice(0, 16);
  }

  private revealBattleReports(): void {
    const now = this.realState.turn;
    const resolved = this.intelState.pending_battle_reports.filter((r) => r.reveal_turn <= now);
    this.intelState.pending_battle_reports = this.intelState.pending_battle_reports.filter(
      (r) => r.reveal_turn > now,
    );
    this.intelState.resolved_battle_reports.unshift(...resolved);
    if (resolved.length === 0) {
      this.addAudit(now, '情报揭示', '玩家', 'INTEL_REVEAL', '本回合无新增战报确认。');
      return;
    }
    for (const report of resolved) {
      this.addAudit(now, '情报揭示', '玩家', 'INTEL_REVEAL', `战报更新：${report.public_summary}`);
    }
  }

  private refreshFriendlyIntel(): void {
    this.intelState.friendly_units = this.realState.units
      .filter((u: Unit) => u.owner === 'player')
      .map((u) => ({
        unit_id: u.id,
        unit_type: u.type,
        hp: u.hp,
        position_node: u.position_node,
      }));
  }

  private refreshSignalIntel(): void {
    this.intelState.signal_nodes = this.computeSignalNodes();
  }

  private getSignalNodeMap(): Map<NodeId, NodeSignalIntel> {
    return new Map(this.computeSignalNodes().map((node) => [node.node_id, node]));
  }

  private computeSignalNodes(): NodeSignalIntel[] {
    const playerCommanderNode =
      this.realState.units.find((u) => u.owner === 'player' && u.type === 'commander' && u.hp > 0)?.position_node ??
      RED_BASE;
    const contestedNodes = new Set<NodeId>();

    for (const node of TEST_MAP_EDGES.flatMap((edge) => [edge.from, edge.to])) {
      const hasPlayer = this.realState.units.some((u) => u.owner === 'player' && u.hp > 0 && u.position_node === node);
      const hasEnemy = this.realState.units.some((u) => u.owner === 'enemy' && u.hp > 0 && u.position_node === node);
      if (hasPlayer && hasEnemy) contestedNodes.add(node);
    }

    for (const [node, turn] of this.disruptedNodes) {
      if (this.realState.turn - turn <= 1) contestedNodes.add(node);
    }

    const uniqueNodes = Array.from(new Set(TEST_MAP_EDGES.flatMap((edge) => [edge.from, edge.to])));
    return uniqueNodes.map((nodeId) => {
      if (contestedNodes.has(nodeId)) {
        return {
          node_id: nodeId,
          state: 'contested',
          cause_node: nodeId,
          reason: '节点发生接敌，信号转发中断。',
        };
      }

      const cause = Array.from(contestedNodes).find(
        (contested) => this.pathFromCommanderCrossesNode(playerCommanderNode, nodeId, contested),
      );
      if (cause) {
        return {
          node_id: nodeId,
          state: 'jammed',
          cause_node: cause,
          reason: `${formatNode(cause)} 信号受干扰，本节点情报不可完全信任。`,
        };
      }

      return {
        node_id: nodeId,
        state: 'clear',
      };
    });
  }

  private pathFromCommanderCrossesNode(fromNode: NodeId, targetNode: NodeId, blockingNode: NodeId): boolean {
    if (targetNode === fromNode || targetNode === blockingNode) return false;
    const fullDistance = getNodeHopDistance(TEST_MAP_EDGES, fromNode, targetNode);
    const toBlocker = getNodeHopDistance(TEST_MAP_EDGES, fromNode, blockingNode);
    const fromBlocker = getNodeHopDistance(TEST_MAP_EDGES, blockingNode, targetNode);
    return toBlocker + fromBlocker === fullDistance;
  }

  private syncQueuedCommandsIntel(): void {
    this.intelState.queued_commands = this.pendingCommands.map((command) => ({
      command_id: command.command_id,
      type: command.type,
      target_node: command.target_node,
      source_unit: command.source_unit,
      cp_cost: command.cp_cost,
      locked: command.locked ?? false,
      crisis_corridor: command.crisis_corridor,
    }));
  }

  private getCorridorNodes(corridor: CrisisCorridor): NodeId[] {
    if (corridor === 'north') {
      return [RED_BASE, NORTH_OUTPOST, CENTRAL_PASS, BLUE_BASE];
    }
    return [RED_BASE, SOUTH_FOREST, OLD_RELAY, BLUE_BASE];
  }

  debugGetTurn(): number {
    return this.realState.turn;
  }

  private addAudit(
    turn: number,
    phase: AuditPhase,
    track: AuditTrack,
    eventType: AuditEventType,
    message: string,
  ): void {
    this.auditTrail.push({ turn, phase, track, event_type: eventType, message });
    this.intelState.audit_entries = structuredClone(this.auditTrail);
  }
}
