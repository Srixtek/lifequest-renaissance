# Crédits artistiques — Royaume / combat (006B)

Assets **CC0 1.0** de [Kenney](https://kenney.nl), embarqués localement dans `assets/kingdom/kenney/`.

| Pack | Source officielle (miroir) | Fichiers utilisés |
| --- | --- | --- |
| **Tiny Dungeon** | [kenney.nl/assets/tiny-dungeon](https://kenney.nl/assets/tiny-dungeon) — copie via [OpenGameArt](https://opengameart.org/content/tiny-dungeon) (`kenney_tinydungeon.zip`) | heros, gardien, terrain, forge, camp |
| **Micro Roguelike** (couleur) | [kenney.nl/assets/micro-roguelike](https://kenney.nl/assets/micro-roguelike) — copie via [OpenGameArt](https://opengameart.org/content/micro-roguelike) (`kenney_microroguelike_1.2.zip`) | Loup des Brumes |

Licence : **Creative Commons Zero (CC0)** — attribution appréciée mais non requise.  
Textes de licence originales : `assets/kingdom/LICENSE-KENNEY-TINY-DUNGEON.txt` (Tiny Dungeon).

Palette et mise en scène : thème Eloria sombre de l’app (voir `src/design-system/theme.ts`), upscale pixel `image-rendering` via `scale` sur les sprites 16×16.

## Illustrations SVG originales (007A)

Composants React Native SVG — **création projet** (aucune licence tierce) :

| Composant | Usage |
| --- | --- |
| `src/design-system/art/BastionSceneArt.tsx` | Bastion nocturne (Arène, Camp, Forge L0–L2) |
| `src/design-system/art/CombatArenaArt.tsx` | Fond d’arène combat |
| `src/design-system/art/CombatFighterArt.tsx` | Silhouettes héros (4 classes) + ennemis |
| `src/design-system/art/HeroPortraitArt.tsx` | Médaillon fiche personnage |
| `src/design-system/ForestScene.tsx` | Header Camp (scènes antérieures / cohérence) |

Les écrans Bastion et Combat **007A** privilégient ces SVG ; les PNG Kenney restent référencés pour emblèmes quêtes et secours hors combat.