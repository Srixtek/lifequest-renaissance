# Règles XP v0.1

- Budget journalier : **50 XP** pour les quêtes personnelles, quel que soit le nombre d'objectifs.
- `potentialXp(i) = 50 * w_i / Σ w`.
- `earnedXp = potential * completionRatio`.
- `unknown` / `paused` → 0 XP (jamais de succès inventé).
- Bonus première utilisation outil (respiration / envie) : +10 XP, une seule fois (idempotence).
- Pas d'XP par envie notée.
- Ledger immuable ; corrections = transactions compensatrices (non utilisées en v0.1 UI).
- Niveau : `floor(totalXp / 100) + 1`.
- Jours `unknown`/`paused` n'affichent pas de série cassée (streaks off par défaut).
