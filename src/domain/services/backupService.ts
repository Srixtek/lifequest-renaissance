import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import type { Db } from '../../data/db/client';
import { migrate } from '../../data/db/client';
import * as kingdomRepo from '../../data/db/repositories/kingdomRepo';

const TABLES = [
  'profiles',
  'goal_definitions',
  'goal_versions',
  'tracking_events',
  'journal_entries',
  'coping_sessions',
  'xp_ledger',
  'wallet_ledger',
  'inventory_items',
  'equipment_slots',
  'character_progress',
  'story_flags',
  'quest_instances',
  'adventure_state',
  'settings',
  'schema_migrations',
  'backup_metadata',
  'daily_reward_days',
  'daily_reward_goals',
  'challenge_sessions',
  'adaptive_challenge_state',
  'adaptive_challenge_attempts',
  'adaptive_challenge_records',
  'kingdom_buildings',
  'kingdom_combat',
] as const;

/** Ordre enfants → parents (FK) pour un vidage sans orphelins. */
const WIPE_ORDER: readonly string[] = [
  'adaptive_challenge_attempts',
  'adaptive_challenge_records',
  'adaptive_challenge_state',
  'challenge_sessions',
  'daily_reward_goals',
  'tracking_events',
  'goal_versions',
  'goal_definitions',
  'journal_entries',
  'coping_sessions',
  'xp_ledger',
  'wallet_ledger',
  'inventory_items',
  'equipment_slots',
  'quest_instances',
  'story_flags',
  'kingdom_combat',
  'kingdom_buildings',
  'character_progress',
  'adventure_state',
  'daily_reward_days',
  'profiles',
  'settings',
  'backup_metadata',
];

export interface BackupPreview {
  pseudo: string | null;
  goalCount: number;
  xpTotal: number;
  exportedAt: string;
  appVersion: string;
}

async function dumpDb(db: Db): Promise<Record<string, any[]>> {
  const data: Record<string, any[]> = {};
  for (const t of TABLES) {
    try {
      data[t] = await db.getAllAsync(`SELECT * FROM ${t}`);
    } catch {
      data[t] = [];
    }
  }
  return data;
}

export async function exportBackup(db: Db, appVersion = '0.1.0'): Promise<{ uri: string; preview: BackupPreview }> {
  const data = await dumpDb(db);
  const exportedAt = new Date().toISOString();
  const manifest = {
    format: 'lqbackup',
    version: 1,
    appVersion,
    exportedAt,
    tables: TABLES,
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('data.json', JSON.stringify(data));
  const base64 = await zip.generateAsync({ type: 'base64' });
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}lifequest-${exportedAt.slice(0, 10)}.lqbackup`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await db.runAsync(
    `INSERT INTO backup_metadata (id, last_export_at, last_import_at, app_version)
     VALUES (1, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET last_export_at=excluded.last_export_at, app_version=excluded.app_version`,
    exportedAt,
    appVersion,
  );
  const profile = data.profiles?.[0];
  const xpTotal = (data.xp_ledger ?? []).reduce((s: number, r: any) => s + (r.xp_amount ?? 0), 0);
  return {
    uri,
    preview: {
      pseudo: profile?.pseudo ?? null,
      goalCount: (data.goal_definitions ?? []).length,
      xpTotal,
      exportedAt,
      appVersion,
    },
  };
}

export async function previewBackup(uri: string): Promise<BackupPreview> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const data = JSON.parse(await zip.file('data.json')!.async('string'));
  const profile = data.profiles?.[0];
  const xpTotal = (data.xp_ledger ?? []).reduce((s: number, r: any) => s + (r.xp_amount ?? 0), 0);
  return {
    pseudo: profile?.pseudo ?? null,
    goalCount: (data.goal_definitions ?? []).length,
    xpTotal,
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
  };
}

/** Applique un dump JSON (tests node:sqlite et import fichier). */
export async function importBackupPayload(
  db: Db,
  manifest: { format?: string; appVersion?: string },
  data: Record<string, any[]>,
): Promise<void> {
  if (manifest.format !== 'lqbackup') throw new Error('Format de sauvegarde inconnu');

  const preMigrations = await db.getAllAsync<{ version: number; applied_at: string }>(
    'SELECT version, applied_at FROM schema_migrations',
  );
  const preMaxVersion = preMigrations.reduce((m, r) => Math.max(m, r.version), 0);

  await db.withTransactionAsync(async () => {
    for (const t of WIPE_ORDER) {
      try {
        await db.execAsync(`DELETE FROM ${t}`);
      } catch {
        /* table absente sur anciennes bases */
      }
    }

    for (const t of TABLES) {
      if (t === 'schema_migrations') continue;
      const rows = data[t] ?? [];
      for (const row of rows) {
        const keys = Object.keys(row);
        if (!keys.length) continue;
        const placeholders = keys.map(() => '?').join(',');
        await db.runAsync(
          `INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${placeholders})`,
          ...keys.map((k) => row[k]),
        );
      }
    }

    const backupMigrations = data.schema_migrations ?? [];
    for (const row of backupMigrations) {
      await db.runAsync(
        `INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
        row.version,
        row.applied_at,
      );
    }

    const importedMax = backupMigrations.reduce((m: number, r: { version: number }) => Math.max(m, r.version), 0);
    if (preMaxVersion > importedMax) {
      for (const row of preMigrations) {
        if (row.version > importedMax) {
          await db.runAsync(
            `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
            row.version,
            row.applied_at,
          );
        }
      }
    }

    await db.runAsync(
      `INSERT INTO backup_metadata (id, last_export_at, last_import_at, app_version)
       VALUES (1, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_import_at=excluded.last_import_at, app_version=excluded.app_version`,
      new Date().toISOString(),
      manifest.appVersion ?? '0.1.0',
    );
  });

  await migrate(db);
  await kingdomRepo.ensureKingdomDefaults(db);
}

/** Full replace import. Caller should export a safety backup first. */
export async function importBackup(db: Db, uri: string): Promise<BackupPreview> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const data = JSON.parse(await zip.file('data.json')!.async('string')) as Record<string, any[]>;
  await importBackupPayload(db, manifest, data);
  return previewBackup(uri);
}

export async function exportBackupPayload(db: Db, appVersion = '0.1.0'): Promise<{
  manifest: Record<string, unknown>;
  data: Record<string, any[]>;
}> {
  const data = await dumpDb(db);
  const exportedAt = new Date().toISOString();
  return {
    manifest: {
      format: 'lqbackup',
      version: 1,
      appVersion,
      exportedAt,
      tables: TABLES,
    },
    data,
  };
}
