# Changelog

## V1-04B-1 — Trois missions du jour (Habitudes)

- Habitudes : bloc « Trois missions du jour » (Sport pompes/marche si objectif défini, Appeler un proche, Divers, Souffle). Offres figées par date logique du profil, 1 remplacement non accepté par jour, accepter AVANT l'action, réclamer ensuite. Or via `wallet_ledger` et plafond 50 or/jour partagé (UTC) : moteur `renewableQuestService` inchangé, aucun second paiement.
- Preuves relues à l'acceptation ET à la réclamation (même transaction) ; attribution durable dans `quest_evidence_claims`. Annuler / réécrire une preuve déjà récompensée est refusé (Sport, Proches, Divers) ; correction descriptive (note) toujours permise.
- Divers : « Passer » masque la suggestion sans en créer une autre ni consommer le remplacement ; une activité n'a qu'une confirmation active par jour, seule la première confirmation du jour est récompensable.
- Migration 017 (additive) : `daily_quest_sets`, `daily_quest_offers`, `quest_evidence_claims`, colonnes `slot0_passed` / `slot1_passed`. Incluses dans la sauvegarde `.lqbackup`.

## V1-03A — Sport : performances, séances, records, objectifs progressifs

- Habitudes → Sport : fiche avec activités Pompes / Marche / Course / Séance libre, « Enregistrer une séance », séances multiples par jour (nombre, total, meilleure séance, durée et distance totales), records par activité recalculés, objectif versionné, suggestion d'objectif jamais automatique, historique, correction et annulation tracées. Voir `docs/SPORT_TRACKER.md`.
- Tentative échouée conservée avec sa performance réelle (comptée dans les totaux et le record) ; jamais convertie en réussite ; « Atteint » refusé sous la cible.
- Unités entières : répétitions, secondes, mètres. Migration 014 (`sport_activities`, `sport_goals`, `sport_sessions`, `sport_corrections`, `sport_events`), toutes dans la sauvegarde `.lqbackup`.
- Aucun XP, or ni éclat attribué ; suivi Sport historique (`sport_minutes`, chrono, quêtes) inchangé. Preuves structurées exposées par `listSportEvidence` pour une future mission Quêtes.

## V1-02B — Alcool : journal, unités standard, chrono, objectif

- Habitudes → Alcool : fiche avec verres standard du jour / 7 derniers jours / semaine civile, objectif hebdomadaire, chrono depuis la dernière boisson enregistrée (ou un départ explicitement confirmé), « Ajouter une boisson », historique par jour, correction et annulation tracées. Voir `docs/ALCOHOL_TRACKER.md`.
- Calcul : `alcool_mg = volume_ml × degré/100 × 0,789 × quantité × 1000`, arrondi une seule fois, stocké en milligrammes entiers ; 1 verre standard = 10 000 mg. Totaux = somme des mg stockés.
- Migration 013 (`alcohol_consumptions`, `alcohol_corrections`, `alcohol_zero_days`, `alcohol_start_markers`, `alcohol_weekly_goals`, `alcohol_events`) ; toutes les tables sont dans la sauvegarde `.lqbackup`.
- Aucune récompense (XP, or, éclats) ni pénalité ; l'ancien template `alcohol_limit` est conservé et jamais additionné au journal.
- Micro-correctif vape : `declareVape` renvoie `craving_close_failed` et annule toute la transaction si la clôture de l'envie échoue sans exception (plus de clôture silencieuse du seul chrono).

## V1-02A-R — Vape : intégrité (correctif, pas de migration)

- Paliers à 0 or : la validation reste proposée quand le plafond du jour est atteint (« palier validé, 0 or (plafond atteint) »), état persisté, jamais d'or ultérieur ; aucun bonus de record promis si le plafond l'interdit.
- Plusieurs périodes réclamables : un intervalle clôturé non réclamé reste accessible après un nouveau chrono ; la période (début, fin, durée) est choisie explicitement et son id est revérifié dans la transaction de réclamation. Record précédent = chronologique.
- Corrections après réclamation : correction d'heure, annulation ou vape passée qui invalideraient des paliers/bonus déjà validés sont refusées (`rewards_claimed`) ; pas de compensation du ledger (or append-only, éventuellement dépensé). « Annuler J'ai vapoté » reste possible (l'intervalle ne fait que s'allonger).
- « J'ai vapoté » / « J'ai cédé » : chrono et envie clôturés dans une seule transaction ; une envie ne peut plus réussir après une vape déclarée.
- Longs intervalles : au plus 2000 paliers validés par confirmation (insertion groupée des paliers à 0 or).
- Limite connue inchangée : plafond d'or = jour UTC (comme les quêtes renouvelables).

## V1-02A — Vape : chrono principal

Habitudes → Vape : chrono « sans vapoter » persisté (SQLite, timestamps), paliers de 30 min confirmés (2 or), record + bonus de seuil unique, « J'ai une envie » (défi adaptatif existant), corrections sans perte d'historique. Migration 012 (`vape_main_sessions`, `vape_main_claims`, `vape_events`), plafond d'or de 50/jour partagé avec les quêtes renouvelables (`goldDailyCap.ts`). Services : `vapeTrackerService.ts`.

## 004C-1

Tableau de quêtes (onglet Aventure), 4 quêtes, or en `wallet_ledger` (resource `gold`), migration 005, anti-duplication des objets d'aventure. Voir `docs/QUESTS.md`.

## 0.1.0

Première tranche verticale jouable : onboarding, objectifs, XP, aventure lanterne, respiration, envie, journal, stats 7/30, sauvegarde `.lqbackup`, APK signée.
