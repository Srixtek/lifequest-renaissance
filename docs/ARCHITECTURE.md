# Architecture — LifeQuest : Renaissance v0.1

Stack : Expo SDK 58, TypeScript strict, Expo Router, expo-sqlite, Zustand (vue), react-native-svg, Jest.

- Domaine (`src/domain`) : règles XP, dates, services (tracking, aventure, outils, backup).
- Persistance (`src/data/db`) : migrations 001–002, repositories.
- Contenu (`src/data/content`) : classes, objets, carte, quêtes, templates, lignes d'aide FR.
- UI (`app/`, `src/design-system`) : pas de règles métier complexes dans les écrans.
- `applicationId` : `lifequest.renaissance` (figé).

Offline-first : aucune dépendance réseau obligatoire.
