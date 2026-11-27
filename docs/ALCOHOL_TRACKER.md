# Suivi alcool (V1-02B)

Outil de suivi honnête, non culpabilisant : il enregistre ce que la personne déclare, rien d'autre.

## Calcul des unités

France : 1 verre standard = 10 g d'alcool pur.

```
alcool_g  = volume_ml × (degré / 100) × 0,789 × quantité
verres    = alcool_g / 10
```

- Les paramètres sont stockés en entiers : volume en dixièmes de ml, degré en dixièmes de % vol, quantité en centièmes.
- L'alcool pur est stocké en **milligrammes entiers** (`alcohol_mg`), arrondi une seule fois (demi vers le haut) à partir des paramètres d'origine : `mg = vol_x10 × abv_x10 × qty_x100 × 789 / 1 000 000`.
- Tous les totaux (jour, 7 jours, semaine, comparaison) sont des sommes de `alcohol_mg`, jamais de valeurs arrondies. L'affichage utilise 1 à 2 décimales.
- Exemples : bière 25 cl 5 % → 9 863 mg (0,99) ; 2 bières → 19 725 mg (1,97) ; vin 10 cl 12 % → 9 468 mg (0,95) ; spiritueux 3 cl 40 % → 9 468 mg.
- Bornes : volume 1–5 000 ml, degré 0,1–100 % vol, quantité 0,01–50. Saisie vide, non numérique, négative, avec trop de décimales ou hors bornes : refusée. Aucun degré n'est supposé (« Autre » demande volume et degré).

## Journées, semaines, fuseaux

- Date logique = date murale dans le fuseau du profil, décalée d'un jour avant l'heure de début de journée du profil (4 h par défaut). Calculée sur l'heure murale : correcte aux changements d'heure. `localDateWithDayStart` (règle globale) n'est pas modifiée.
- `local_date` est enregistrée à l'écriture (et recalculée à la correction) ; si le fuseau ou le début de journée du profil change plus tard, les anciennes saisies gardent la journée qu'elles avaient à l'époque.
- Semaine civile = lundi → dimanche (journée logique). « 7 derniers jours » = aujourd'hui et les 6 journées précédentes.

## Zéro déclaré ≠ aucune donnée

- Un jour sans saisie reste « Aucune donnée renseignée ».
- « Aucune boisson ce jour-là » est une déclaration explicite (`alcohol_zero_days`) ; ajouter une boisson ce jour-là la révoque (tracé). Annuler l'unique boisson d'un jour ne fabrique pas un zéro.
- Une semaine non renseignée n'est jamais traitée comme zéro, ni pour les statistiques ni pour la suggestion d'objectif.

## Chrono

Référence = le plus récent entre la dernière boisson active et un départ explicitement confirmé (`alcohol_start_markers`). Sans aucune des deux : on demande une confirmation (date + heure), on ne suppose rien. Recalculé à chaque affichage depuis les horodatages ; jamais d'« abstinence vérifiée ».

## Objectif hebdomadaire

Libre, en verres standard (stocké en mg). Versionné en append-only (`alcohol_weekly_goals`, `effective_from` = lundi de la semaine en cours) : les semaines passées sont évaluées avec l'objectif d'alors. Suggestion de réduction uniquement après ≥ 2 semaines terminées avec ≥ 5 jours renseignés ; proposition = moyenne − 10 % arrondie à 0,5 verre, strictement sous l'objectif actuel, jamais appliquée seule, silence de 28 jours après tout changement d'objectif ou refus.

## Anciennes données et coexistence

- Le template historique `alcohol_limit` (« Alcool — verres déclarés », suivi par `tracking_events`) est conservé tel quel et reste utilisable.
- Ses valeurs ne sont **pas** des unités standard calculées : elles ne sont jamais converties ni additionnées au journal. Les deux suivis sont indépendants (aucun double comptage).
- Le journal alcool n'écrit jamais dans `xp_ledger`, `wallet_ledger`, l'inventaire ou la progression : aucune récompense, aucune pénalité.

## Tables (migration 013)

`alcohol_consumptions` (+ index date/statut et horodatage), `alcohol_corrections` (avant/après JSON), `alcohol_zero_days`, `alcohol_start_markers`, `alcohol_weekly_goals`, `alcohol_events` (pour la future page Bilan). Toutes incluses dans l'export/import `.lqbackup`.

## Santé

Texte discret dans la fiche : un arrêt brutal après consommation régulière et importante peut être dangereux (sevrage), avis médical conseillé ; aucun diagnostic, aucune prescription.
