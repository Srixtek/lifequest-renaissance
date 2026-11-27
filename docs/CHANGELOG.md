# Changelog

## V1-02A — Vape : chrono principal

Habitudes → Vape : chrono « sans vapoter » persisté (SQLite, timestamps), paliers de 30 min confirmés (2 or), record + bonus de seuil unique, « J'ai une envie » (défi adaptatif existant), corrections sans perte d'historique. Migration 012 (`vape_main_sessions`, `vape_main_claims`, `vape_events`), plafond d'or de 50/jour partagé avec les quêtes renouvelables (`goldDailyCap.ts`). Services : `vapeTrackerService.ts`.

## 004C-1

Tableau de quêtes (onglet Aventure), 4 quêtes, or en `wallet_ledger` (resource `gold`), migration 005, anti-duplication des objets d'aventure. Voir `docs/QUESTS.md`.

## 0.1.0

Première tranche verticale jouable : onboarding, objectifs, XP, aventure lanterne, respiration, envie, journal, stats 7/30, sauvegarde `.lqbackup`, APK signée.
