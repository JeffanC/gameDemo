export type NodeId = string;
export type CrisisCorridor = 'north' | 'south';

export interface GameNode {
  id: NodeId;
  name: string;
  type: 'Base' | 'Outpost' | 'Pass' | 'Forest' | 'Relay';
  neighbors: NodeId[];
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  move_cost: number;
  intel_resistance: number;
}

export interface Unit {
  id: string;
  owner: 'player' | 'enemy';
  type: 'commander' | 'infantry' | 'cavalry' | 'artillery' | 'scout';
  hp: number;
  position_node: NodeId;
}

export interface RealGameState {
  turn: number;
  units: Unit[];
}

export interface IntelReport {
  report_id: string;
  target_owner: 'player' | 'enemy';
  observed_unit_id?: string;
  observed_unit_type: string;
  observed_position: NodeId;
  observed_turn: number;
  reveal_turn: number;
  confidence: 'high' | 'medium' | 'low';
  anomaly_flags: string[];
}

export interface BattleEvent {
  event_id: string;
  location: NodeId;
  event_turn: number;
  real_result: string;
  reveal_turn: number;
  public_summary: string;
}

export type AuditPhase = '机动与交战' | '指令执行' | '情报揭示';
export type AuditTrack = '真实' | '引擎' | '玩家';
export type AuditEventType =
  | 'MOVE'
  | 'COMBAT'
  | 'CRISIS_ORDER'
  | 'COMMAND_ISSUE'
  | 'COMMAND_OK'
  | 'COMMAND_VOID'
  | 'INTEL_REVEAL'
  | 'SYSTEM_ALERT';

export interface AuditEntry {
  turn: number;
  phase: AuditPhase;
  track: AuditTrack;
  event_type: AuditEventType;
  message: string;
}

export type GameStatus = 'ONGOING' | 'VICTORY' | 'DEFEAT' | 'DRAW';

export interface GameCommand {
  command_id: string;
  turn: number;
  issuer: 'player' | 'enemy';
  type: 'MOVE' | 'BLIND_STRIKE' | 'INTERCEPT' | 'AMBUSH' | 'SCOUT' | 'CRISIS_ORDER';
  target_node: NodeId;
  source_unit?: string;
  cp_cost: number;
  locked?: boolean;
  crisis_corridor?: CrisisCorridor;
  intel_snapshot_hash?: string;
}

export type CommandOutcome = 'executed' | 'failed' | 'voided';

export interface CommandResolution {
  command_id: string;
  resolved_turn: number;
  outcome: CommandOutcome;
  real_reason:
    | 'OK'
    | 'SOURCE_UNIT_UNAVAILABLE'
    | 'OUT_OF_RANGE'
    | 'TARGET_EMPTY'
    | 'INTERRUPTED_BY_COMBAT';
  reveal_turn: number;
  public_summary: string;
  anomaly_flags: string[];
}

export interface FriendlyUnitIntel {
  unit_id: string;
  unit_type: Unit['type'];
  hp: number;
  position_node: NodeId;
}

export type SignalState = 'clear' | 'contested' | 'jammed';

export interface NodeSignalIntel {
  node_id: NodeId;
  state: SignalState;
  cause_node?: NodeId;
  reason?: string;
}

export interface QueuedCommandIntel {
  command_id: string;
  type: GameCommand['type'];
  target_node: NodeId;
  source_unit?: string;
  cp_cost: number;
  locked: boolean;
  crisis_corridor?: CrisisCorridor;
}

export interface EnemyScriptIntel {
  mode: string;
  label: string;
  brief: string;
  seed: number;
}

export interface PlayerIntelState {
  visible_reports: IntelReport[];
  pending_battle_reports: BattleEvent[];
  resolved_battle_reports: BattleEvent[];
  pending_command_resolutions: CommandResolution[];
  resolved_command_resolutions: CommandResolution[];
  queued_commands: QueuedCommandIntel[];
  audit_entries: AuditEntry[];
  current_cp: number;
  max_cp: number;
  cp_debt: number;
  crisis_available: boolean;
  friendly_units: FriendlyUnitIntel[];
  signal_nodes: NodeSignalIntel[];
  enemy_script: EnemyScriptIntel;
  visible_turn: number;
  max_turn: number;
  game_status: GameStatus;
}
