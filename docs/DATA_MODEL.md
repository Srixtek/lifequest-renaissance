# Modèle de données v0.1

Tables : profiles, goal_definitions, goal_versions, tracking_events, journal_entries, coping_sessions, xp_ledger, wallet_ledger, inventory_items, equipment_slots, character_progress, story_flags, quest_instances, adventure_state, settings, schema_migrations, backup_metadata.

- Tracking par défaut : `unknown` (Non renseigné).
- XP : ledger immuable + `idempotency_key` unique.
- Objectifs versionnés (`goal_versions`) pour changements de plan sans recalcul silencieux d'XP passée.
