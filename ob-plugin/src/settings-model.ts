import { DEFAULT_OBJECT_DIRS } from './core/model';
import type { ObjectDirs } from './core/model';
import type { MetricSettings } from './core/metrics';
import { DEFAULT_KOS_SYNC_SETTINGS } from './sync/model';
import type { KosSyncSettings } from './sync/model';

export interface KosSettings {
  staleThresholdDays: number;
  heatmapIncludeDiary: boolean;
  enableBadges: boolean;
  reviewConfirmDialog: boolean;
  agentHostPath: string;
  agentNodePath: string;
  agentAutoStart: boolean;
  agentVaultId: string;
  weekStart: number;
  objectDirs: ObjectDirs;
  sync: KosSyncSettings;
}

export const DEFAULT_SETTINGS: KosSettings = {
  staleThresholdDays: 3,
  heatmapIncludeDiary: true,
  enableBadges: true,
  reviewConfirmDialog: true,
  agentHostPath: '',
  agentNodePath: '',
  agentAutoStart: true,
  agentVaultId: '',
  weekStart: 1,
  objectDirs: { ...DEFAULT_OBJECT_DIRS },
  sync: { ...DEFAULT_KOS_SYNC_SETTINGS },
};

export function toMetricSettings(settings: KosSettings): MetricSettings {
  return {
    weekStart: settings.weekStart,
    staleThresholdDays: settings.staleThresholdDays,
    heatmapIncludeDiary: settings.heatmapIncludeDiary,
  };
}
