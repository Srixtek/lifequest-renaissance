# Mission 001 — limites connues

- **Objectifs hebdomadaires** : les modèles sont créés avec un plan, mais l'écran Objectifs journalier ne cumule pas encore la semaine (seul le jour courant est saisi).
- **Correction tardive / XP** : une correction le même jour met à jour la valeur et le statut, mais l'XP quotidienne reste soumise à la clé d'idempotence (`daily-goal:goalId:date`) — un second enregistrement le même jour ne verse pas d'XP supplémentaire même si le statut s'améliore.
- **Abstinence** : aucun succès automatique sans saisie ; le vape preset est en mode **limite** (séances), pas abstinence par défaut.
- **Binaire** : les objectifs `habit` / `abstinence` exigent une confirmation explicite (pas de case cochée par défaut).
- **Hors scope mission** : pas de backend, pas de stats 7/30 j étendues, pas de plans si-alors (mission 002+).