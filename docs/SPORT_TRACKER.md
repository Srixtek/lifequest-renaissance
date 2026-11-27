# Journal Sport (V1-03A)

Outil de suivi honnête et motivant : il enregistre les efforts réels (réussis ou non) et n'attribue aucune récompense dans cette version.

## Fiche (Habitudes → Sport)

Chips d'activité (la dernière utilisée est présélectionnée, Pompes par défaut), puis : séances du jour (nombre, total, meilleure séance), semaine en cours, objectif actuel, bouton « Enregistrer une séance », « Définir un objectif », accès aux défis chronométrés existants (`/tools/challenges?type=sport`). Le formulaire n'apparaît qu'à la demande. Sections repliables : records personnels, objectifs suivis (+ historique, habitudes Sport), « À savoir ». Les habitudes Sport classiques restent affichées dessous (« Mes habitudes Sport »), inchangées.

## Activités

| Activité | Saisie | Records |
|---|---|---|
| Pompes | répétitions (entier ≥ 0) | meilleure séance (répétitions) |
| Marche / Course | durée (min, 1 décimale) et/ou distance (km, 3 décimales) | durée max, distance max (séparés) |
| Séance libre | durée OU répétitions, nom de discipline facultatif | aucun (disciplines hétérogènes) |

Unités stockées : répétitions entières, durées en **secondes**, distances en **mètres**. Bornes : 0–10 000 répétitions, 0–24 h, 0–1 000 km. Vide, texte, négatif, décimale pour des répétitions, notation scientifique : refusé. `0` saisi explicitement est une séance réalisée à zéro ; l'absence de séance reste « aucune séance » (`count = 0`, totaux `NULL`).

## Résultat d'une tentative

- Sans objectif choisi : `free` (séance neutre, ni réussite ni échec).
- Avec l'objectif courant : `achieved` ou `failed`. Par défaut (« Selon mon résultat ») : atteint si performance ≥ cible, sinon échoué ; l'utilisateur peut forcer « Échoué » ou « Sans objectif ».
- « Atteint » avec une performance sous la cible est **refusé** (`below_target`). « Échoué » est toujours accepté et la performance saisie est conservée telle quelle.
- Cas crucial : objectif 20, réalisé 16, « Échoué » → séance conservée, 16 comptées dans les totaux, 16 candidat au record, tentative `failed`, aucune preuve de réussite, aucun XP/or. Message neutre : « Tentative enregistrée : … non atteint. Ta performance compte dans tes totaux et ton record ».
- La séance garde `goal_id`, `goal_metric`, `goal_target` (instantané) : une modification ultérieure de l'objectif ne réécrit pas les tentatives passées.

## Totaux, records, progression

Tout est recalculé depuis les séances **actives** (jamais un compteur stocké) : totaux du jour / de la semaine civile (lundi→dimanche, journée logique comme Alcool), meilleure séance ≠ total du jour, réussites et échecs distincts, record (égalité : le plus ancien garde le record, les zéros ne sont jamais des records), tendance simple (3 dernières vs 3 précédentes séances, ±5 %). Les événements `record_set` sont informatifs (futurs graphiques) ; la source de vérité reste les séances.

## Corrections et annulations

Correction de la quantité, durée, distance, date/heure, note, résultat ; l'activité et l'objectif associé sont figés. Chaque correction écrit une ligne `sport_corrections` (avant/après JSON). Annulation = `status = 'cancelled'` (jamais de `DELETE`), trace `cancel`, exclue des totaux, records, suggestions et preuves. Annulation en deux temps dans l'UI.

## Objectifs versionnés et suggestion

`sport_goals` est append-only : une ligne par version (métrique, cible, date d'effet, source `manual|suggestion|habit`, raison). `target_value = NULL` = objectif retiré. Pompes : répétitions ; Marche/Course : durée ou distance ; Séance libre : pas d'objectif.

Suggestion (jamais appliquée seule) : ≥ 3 tentatives pour la version courante, dont ≥ 2/3 échouées → cible = milieu entre la cible et la médiane des tentatives échouées (ex. 20 et 16 → 18), arrondie au pas (1 rép., 1 min, 100 m). Hausse seulement après 4 tentatives consécutives atteintes sur ≥ 3 jours différents (+10 %). Après un refus : silence jusqu'à 2 nouvelles tentatives. Aucun jour de repos obligatoire, aucune pénalité pour un jour sans sport.

## Habitudes Sport personnalisées

Une habitude de catégorie Sport (créée dans Paramètres) est rattachée à une activité seulement si son titre évoque exactement une activité (pompes / marche / course) et si son unité est compatible. Rattachement = bouton explicite « Suivre dans le journal » : crée une version d'objectif `source = 'habit'` (`legacy_goal_id`), sans modifier l'habitude, ses versions ni son suivi XP. Plusieurs habitudes pour la même activité : aucun rattachement (ambiguïté).

## RPG / XP

Le journal n'écrit jamais dans `xp_ledger`, `wallet_ledger`, l'inventaire, les quêtes, `tracking_events` ni `challenge_sessions`. Le suivi historique (`sport_minutes`, chrono Sport, quêtes `time_challenge`) reste séparé et inchangé ; une séance du journal ne valide aucune ancienne quête.

Preuves pour la future mission Quêtes : `listSportEvidence(db, { sinceIso, untilIso })` renvoie les séances actives avec une clé stable `evidenceKey = "sport_session:<id>"`, performances en unités entières, objectif et cible d'alors, et `countsAsSuccess` (vrai uniquement pour `outcome = 'achieved'`). Un consommateur futur doit dédupliquer sur `evidenceKey`.

## Tables (migration 014, additive)

`sport_activities` (4 lignes fixes, réinsérées après un import ancien), `sport_goals`, `sport_sessions` (UNIQUE `client_request_id`, CHECK sur bornes et cohérence résultat/objectif), `sport_corrections`, `sport_events` (`session_logged`, `record_set`, `session_edited`, `session_cancelled`, `goal_set`, `suggestion_accepted`, `suggestion_dismissed`). Toutes dans l'export/import `.lqbackup` ; une sauvegarde sans ces tables s'importe (journal vide, activités recréées). Migrations 001–013 inchangées.

## Fichiers

`src/data/db/migrations/014_sport_tracker.ts`, `src/data/db/repositories/sportRepo.ts`, `src/domain/rules/sport.ts`, `src/domain/services/sportTrackerService.ts`, `src/design-system/SportTracker.tsx`, intégration dans `app/(tabs)/goals.tsx`, `backupService.ts`.
