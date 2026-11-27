export type GoalKind =
  | 'habit'
  | 'reduce'
  | 'abstinence'
  | 'limit'
  | 'duration'
  | 'quantity';

export type HabitCategoryId =
  | 'vape'
  | 'alcool'
  | 'sport'
  | 'proches'
  | 'personnel'
  | 'sans_ecran'
  | 'divers';

export type GoalScheduleKind = 'daily' | 'weekly';

export type TrackingStatus = 'unknown' | 'success' | 'partial' | 'miss' | 'paused';

export type GoalTier = 'minimal' | 'normal' | 'ambitieux';

export type ClassId = 'rodeur' | 'gardien' | 'sage' | 'artisan';

export interface Profile {
  id: string;
  pseudo: string;
  classId: ClassId;
  tone: 'fantasy' | 'sobre';
  dayStartHour: number;
  timezone: string;
  createdAt: string;
  onboardingDone: boolean;
}

export interface GoalDefinition {
  id: string;
  title: string;
  kind: GoalKind;
  unit: string | null;
  weight: number;
  status: 'active' | 'paused' | 'archived';
  templateId: string | null;
  sensitive: boolean;
  followWithoutXp: boolean;
  /** Catégorie persistée (migration 011). Absente/null : classement par modèle, sinon « divers ». */
  categoryId?: HabitCategoryId | null;
  createdAt: string;
}

export interface GoalVersion {
  id: string;
  goalId: string;
  version: number;
  tier: GoalTier;
  targetValue: number | null;
  scheduleKind: GoalScheduleKind;
  weeklyTargetCount: number | null;
  notes: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface TrackingEvent {
  id: string;
  goalId: string;
  localDate: string;
  status: TrackingStatus;
  value: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface XpLedgerEntry {
  id: string;
  sourceEventId: string | null;
  sourceRuleVersion: string;
  xpAmount: number;
  reason: string;
  idempotencyKey: string;
  localDate: string | null;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  itemId: string;
  quantity: number;
  acquiredAt: string;
}

export interface EquipmentSlot {
  slot: 'hand' | 'body' | 'trinket';
  itemId: string | null;
}

export interface CharacterProgress {
  level: number;
  totalXp: number;
  shards: number;
  campLevel: number;
  storyFlagsJson: string;
}

export interface SettingsMap {
  [key: string]: string;
}
