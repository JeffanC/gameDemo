import { TurnManager } from '../engine/TurnManager';
import { formatAnomalyFlag, formatNode, formatOutcome } from '../i18n/zh';
import { NORTH_OUTPOST } from '../map/testMap7';

export function runConsoleDemo(): void {
  const demo = new TurnManager();
  console.log('--- MVP 情报延迟测试开始 ---');
  console.log('回合 1 可见残影数：', demo.getPlayerIntelState().visible_reports.length);
  demo.endTurn();
  const turn2 = demo.getPlayerIntelState();
  console.log(
    '回合 2 可见残影：',
    turn2.visible_reports.map(
      (r) => `${r.observed_unit_type}@${formatNode(r.observed_position)}［${turn2.visible_turn - r.observed_turn} 回合前］`,
    ),
  );
  demo.queueBlindAttack(NORTH_OUTPOST);
  demo.endTurn();
  const turn3 = demo.getPlayerIntelState();
  console.log('回合 3 已解锁战报：', turn3.resolved_battle_reports.map((r) => r.public_summary));
  console.log(
    '回合 3 指令解析：',
    turn3.resolved_command_resolutions.map((r) => `［${formatOutcome(r.outcome)}］${r.public_summary}`),
  );
  console.log('当前战局状态：', turn3.game_status);
  console.log('--- MVP 情报延迟测试结束 ---');

  const voidedDemo = new TurnManager({ enemyScriptMode: 'voided_demo' });
  console.log('--- 作废指令固定剧本开始 ---');
  console.log('初始回合：', voidedDemo.debugGetTurn());
  console.log('阶段说明：先「机动与交战」，后「指令执行」');
  const queued = voidedDemo.queueAmbush(NORTH_OUTPOST, 'P-CAV-1');
  console.log('回合 1 下达设伏命令（2 指挥点）：', queued ? '成功' : '失败');
  voidedDemo.endTurn();
  const voidedTurn2 = voidedDemo.getPlayerIntelState();
  const latestResolution = voidedTurn2.resolved_command_resolutions[0];
  console.log(
    '回合 2 可见最新指令解析：',
    latestResolution
      ? `［${formatOutcome(latestResolution.outcome)}］${latestResolution.public_summary}`
      : '无',
  );
  console.log(
    '回合 2 异常标记：',
    latestResolution?.anomaly_flags?.length
      ? latestResolution.anomaly_flags.map((f) => formatAnomalyFlag(f)).join('、')
      : '无',
  );
  printAuditArchive(voidedDemo.getAuditTrail());
  console.log('--- 作废指令固定剧本结束 ---');
}

function printAuditArchive(
  entries: Array<{ turn: number; phase: string; track: string; message: string }>,
): void {
  const grouped = new Map<string, Array<{ track: string; message: string }>>();
  for (const entry of entries) {
    const key = `第 ${entry.turn} 回合 | 阶段：${entry.phase}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ track: entry.track, message: entry.message });
  }

  console.log('=== 战场解密档案（双轨时间轴）===');
  for (const [header, items] of grouped.entries()) {
    console.log(`[${header}]`);
    for (const item of items) {
      console.log(`[${item.track}] ${item.message}`);
    }
  }
  console.log('=== 结束 ===');
}
