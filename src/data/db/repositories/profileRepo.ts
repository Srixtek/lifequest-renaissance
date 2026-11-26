import type { Db } from '../client';
import type { SqlRunner } from '../sqlRunner';
import type { ClassId, Profile } from '../../../domain/models/types';

type Conn = Db | SqlRunner;

function mapRow(r: any): Profile {
  return {
    id: r.id,
    pseudo: r.pseudo,
    classId: r.class_id as ClassId,
    tone: r.tone,
    dayStartHour: r.day_start_hour,
    timezone: r.timezone,
    createdAt: r.created_at,
    onboardingDone: !!r.onboarding_done,
  };
}

export async function getProfile(db: Conn): Promise<Profile | null> {
  const row = await db.getFirstAsync<any>('SELECT * FROM profiles LIMIT 1');
  return row ? mapRow(row) : null;
}

export async function upsertProfile(db: Db, p: Profile): Promise<void> {
  await db.runAsync(
    `INSERT INTO profiles (id, pseudo, class_id, tone, day_start_hour, timezone, created_at, onboarding_done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pseudo=excluded.pseudo,
       class_id=excluded.class_id,
       tone=excluded.tone,
       day_start_hour=excluded.day_start_hour,
       timezone=excluded.timezone,
       onboarding_done=excluded.onboarding_done`,
    p.id,
    p.pseudo,
    p.classId,
    p.tone,
    p.dayStartHour,
    p.timezone,
    p.createdAt,
    p.onboardingDone ? 1 : 0,
  );
}
