# Changelog

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
