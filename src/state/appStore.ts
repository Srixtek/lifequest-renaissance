import { create } from 'zustand';
import { getDb } from '../data/db/client';
import * as profileRepo from '../data/db/repositories/profileRepo';
import * as goalRepo from '../data/db/repositories/goalRepo';
import * as rpgRepo from '../data/db/repositories/rpgRepo';
import * as xpRepo from '../data/db/repositories/xpRepo';
import type { CharacterProgress, GoalDefinition, Profile, TrackingEvent } from '../domain/models/types';
import { localDateWithDayStart } from '../domain/rules/dates';

interface AppState {
  ready: boolean;
  profile: Profile | null;
  goals: GoalDefinition[];
  character: CharacterProgress | null;
  goldBalance: number;
  today: string;
  todayTracking: Record<string, TrackingEvent | null>;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  profile: null,
  goals: [],
  character: null,
  goldBalance: 0,
  today: localDateWithDayStart(new Date(), 4),
  todayTracking: {},
  bootstrap: async () => {
    await getDb();
    await get().refresh();
    set({ ready: true });
  },
  refresh: async () => {
    const db = await getDb();
    const profile = await profileRepo.getProfile(db);
    const goals = await goalRepo.listGoals(db);
    const character = await rpgRepo.getCharacter(db);
    await xpRepo.refreshCharacterFromLedger(db);
    const today = localDateWithDayStart(new Date(), profile?.dayStartHour ?? 4, profile?.timezone);
    const todayTracking: Record<string, TrackingEvent | null> = {};
    for (const g of goals) {
      todayTracking[g.id] = await goalRepo.getTracking(db, g.id, today);
    }
    set({
      profile,
      goals,
      character: await rpgRepo.getCharacter(db),
      goldBalance: await rpgRepo.getGoldBalance(db),
      today,
      todayTracking,
    });
  },
}));
