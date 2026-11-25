# Quêtes et or (mission 004C-1)

## Règles
- 4 quêtes uniques (`src/data/content/quests.ts`), or fixe, pas de quête quotidienne répétable, pas d'XP ni d'éclats par quête.
- Maximum 3 quêtes acceptées (non réclamées). Aucune acceptation automatique.
- **Preuve non rétroactive (règle uniforme)** : seule une action commencée à l'instant d'acceptation ou après compte. Ré-accepter après un abandon repart de zéro.
- Preuves (données persistées uniquement) :
  - Première vérité : `tracking_events` success/partial/miss mis à jour après acceptation (unknown/paused exclus).
  - Souffle d'Eloria : `coping_sessions` breathing terminée, hors bouton « Terminer maintenant (test) » (`meta_json.shortcut`), début (fin − durée) après acceptation.
  - Le temps apprivoisé : `challenge_sessions` terminée + confirmée, démarrée après acceptation ; sport avec durée confirmée > 0 OU sans écran déclaré respecté. Interrompue / vape exclus.
  - Au-delà de la brume : entrée de `adventure_state.choice_log_json` après acceptation menant à `hidden_grove` (être déjà dedans ne compte pas).
- « Prête » est calculé à la lecture et revérifié à la réclamation (pas de latch).
- Réclamation : une transaction exclusive (état, preuve, ligne `wallet_ledger` resource `gold` clé `quest:<id>:reward`, quête terminée). Rollback complet en cas d'erreur.
- Abandon : retire du carnet sans toucher au ledger ; impossible si déjà réclamée.
- Solde d'or = `SUM(wallet_ledger.amount)` où resource = `gold` (aucun cache). Or non dépensable avant la boutique (004C-2).
- Aventure : `gather` / `kit` ne donnent objet + éclats qu'une fois (drapeau `story_flags` lu/écrit dans la même transaction exclusive). Quantités déjà acquises conservées.

## Migration 005 (additive)
`quest_instances` : `accepted_at`, `claimed_at`, `abandoned_at` + index unique `quest_id` ; index `wallet_ledger(resource)`.

## Checklist manuelle
1. Aventure > Tableau de quêtes : 4 quêtes « Disponible », solde Or = 0 (aussi sur Accueil et Héros).
2. Accepter 3 quêtes : la 4e propose « Carnet plein ». Abandonner une quête libère une place.
3. Souffle d'Eloria : accepter, faire une respiration 1 min complète → « Prête » → Réclamer : +10 or ; un second tap ne rajoute rien.
4. Interrompre une respiration : la quête reste en cours. Le bouton « (test) » ne valide pas la quête.
5. Première vérité : accepter puis déclarer une habitude (même « écart ») → Prête.
6. Le temps apprivoisé : accepter puis terminer un sport avec durée confirmée ou un défi sans écran « respecté ».
7. Au-delà de la brume : accepter, aller Lisière brumeuse > Tenter le passage → Prête.
8. Redémarrer l'app : acceptées / terminées / or conservés.
9. Clairière : répéter « Cueillir » / « Kit » : l'inventaire n'augmente pas.
10. XP et éclats inchangés après une réclamation.
