# Spécification redesign visuel — LifeQuest Renaissance (006V-A)

Document de référence pour une future passe art / maquettes. **Aucune illustration nouvelle n’est intégrée dans cette mission** : on consolide la hiérarchie, les contraintes et les défauts observés (revue code + manque de captures Android sur l’environnement cloud).

## 1. Défauts observés (audit)

| Zone | Symptôme | Gravité | Piste correction (006V-A appliquée ou future art) |
|------|----------|---------|--------------------------------------------------|
| Carnet quêtes | Quatre sections plates (prête / acceptée / dispo / terminée) | Moyen | Regroupé **En cours → Disponibles → Terminées** ; `flexShrink` / `numberOfLines` sur titres et badges |
| Carte quête | Badge statut chevauche le titre sur petit écran | Moyen | `headerMain` `minWidth: 0`, badge `maxWidth` 36 % |
| Carte quête | Objectif long, pas de « comment faire » | Fort | Bloc `QUEST_HOW_TO` sur carte (disponible / en cours) |
| Boutons combat | Libellés longs (compétence + coût) | Moyen | `adjustsFontSizeToFit` sur `Button` / `Chip` |
| CombatPanel | Ligne télégraphe (nom ennemi + concentration) | Faible | `flexWrap` + titre tronqué à 2 lignes |
| Royaume (bastion) | Joueur 0 or, forge L0 : pas d’indication | Moyen | Message contextuel sous la scène |
| KingdomScene | Forêt cliquable mais « bientôt » | Faible | Garder tag verrouillé ; pas de faux gain |
| Camp | Accès rapide + « Autres actions » | Faible | Secondaire déjà replié ; garder liens réels uniquement |
| Personnage | Or affiché, boutique absente | OK | Texte explicite conservé |
| Sprites combat | Pixel art ×4.5, lisible mais sans ombre unifiée | Art | Maquette lumière commune scène + barres HP |
| KingdomScene | Herbe / chemin répétitifs | Art | Palette tuiles + masques SVG pour bords (Skia ou images) |

## 2. Hiérarchie d’écran (cible)

```
Camp (hub quotidien)
├── Scène forêt + identité (pseudo, niveau, ressources)
├── Prochain défi (1 CTA primaire)
├── Aujourd’hui (habitudes compactes)
└── Accès rapide (liens secondaires, pas de faux boutons)

Royaume (onglet Aventure)
├── Bastion : or + forge + KingdomScene (zones tappables)
├── Quêtes : En cours | Disponibles | Terminées
└── Ancien sentier (narration / reach_node)

Combat (panneau dans Bastion)
├── Scène (sprites + HP intégrés)
├── Intent ennemi + concentration (télégraphe)
├── 1 action primaire (Attaquer) + secondaires
└── Journal de tour (scroll limité)
```

## 3. Composition par écran

### Royaume / Bastion

- **Focus** : carte interactive 16:9 interne (~268 dp hauteur), zones Arène / Camp / Forge alignées hitbox.
- **Or** : valeur en or (`typography.title`) dans panneau accent.
- **Forge** : panneau dépliable au tap zone ; coût suivant niveau visible avant confirmation.
- **Illustrations futures** : bannière sky gradient existante ; remplacer répétition herbe par 2–3 tuiles maîtrisées + props (anvil, mur) déjà Kenney.

### Combat

- **Ratio** : scène ~40 % hauteur panneau, actions ~25 %, log ~20 %.
- **Sprites** : conserver pixel density ; cible maquette 64×64 affichés à 72–80 dp sans stretch bilinéaire (Neighbour pour PNG).
- **Barres HP** : double lecture (in-scène + sous-titre) acceptable en mobile ; future art peut fusionner.

### Quêtes

- **Carte** : emblème | titre + objectif une ligne | badge statut.
- **Primaire** : un seul bouton selon état (Accepter / Réclamer / Abandonner ghost).
- **Secondaire** : `Détails` replié par défaut.
- **Terminées** : récompense texte seule, pas de bouton.

## 4. Liste d’illustrations / assets (futur, hors scope 006V-A)

| Id | Usage | Résolution cible | Source actuelle |
|----|-------|------------------|-----------------|
| `combat_backdrop` | Ciel / ruines combat | 512×256 @2x | Kenney `combat_backdrop.png` |
| `hero_*` / `enemy_*` | Combattants | 16×16 source, ×3–4.5 affichage | kingdomAssets |
| `QUEST_EMBLEM_*` | Icônes quêtes | 40×40 dp | Kenney building / camp |
| `ForestScene` camp | Header Camp | full width | ForestScene composant |
| `arena_floor` | Arène bastion | tile 64×32 logical | Kenney |

Aucun nouveau pack sprite dans 006V-A.

## 5. Contraintes techniques

- **React Native** : `flexShrink`, `minWidth: 0`, `flexWrap`, `numberOfLines`, `adjustsFontSizeToFit` (pas de réduction globale de `fontSize` dans le thème).
- **Accessibilité** : tester `fontScale` 1.3 et largeur ~320 dp (small phone).
- **Zones tactiles** : minimum 44–48 dp (`ui.Button`, `Chip`, `KingdomScene` zones).
- **Motion** : respect `useReduceMotion` sur flash combat.

## 6. Skia vs rendu natif

| Besoin | Recommandation |
|--------|----------------|
| Tuiles sol / parallax léger | **Images** `Image` + tiling (actuel) — suffisant |
| Contours glow forge / victoire | **Skia** ou `react-native-svg` (déjà utilisé) pour halos sans bitmap |
| Barres HP stylisées (biseau médiéval) | **Skia** si maquette l’exige ; sinon `View` + `borderRadius` (actuel) |
| Texte quest carte | **Natif** `Text` avec ellipses |
| Scène royaume refonte | **Hybride** : fond SVG gradient + sprites PNG ; éviter full Skia scene graph tant que l’équipe n’a pas maquettes |

**Décision 006V-A** : rester sur **composants natifs + SVG léger** ; réévaluer Skia uniquement pour une passe « illustration unique » validée par maquettes Figma.

## 7. Processus avant passe art complète

1. Valider maquettes statiques : Camp, Bastion, Combat, Quêtes (3 états carte).
2. Captures Android : petit + grand écran, `fontScale` 1.0 et 1.3.
3. Checklist interaction : zones bastion, combat 5–10 tours, accept → proof → claim.
4. Intégrer assets un par un sans changer IDs quête ni ledger or.

## 8. Validation

L’UI mobile **n’est pas marquée validée visuellement** tant qu’aucune capture Android réelle n’a été revue pour cette branche (`006V-A`). Les correctifs layout de cette mission réduisent les défauts connus mais ne remplacent pas la relecture device.