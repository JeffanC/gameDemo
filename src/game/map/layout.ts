import type { NodeId } from '../types';

export interface NodeLayout {
  [key: NodeId]: {
    x: string;
    y: string;
    labelOffset?: 'top' | 'bottom' | 'left' | 'right';
  };
}

/** 纵向战场：敌方（蓝方基地）在上，我方（红方基地）在下，便于竖屏手机操作 */
export const TEST_MAP_LAYOUT: NodeLayout = {
  BlueBase: { x: '50%', y: '6%' },
  CentralPass: { x: '46%', y: '20%' },
  EastWatch: { x: '88%', y: '26%' },
  OldRelay: { x: '68%', y: '38%' },
  NorthOutpost: { x: '34%', y: '36%' },
  SouthForest: { x: '22%', y: '70%' },
  RedBase: { x: '50%', y: '90%' },
};
