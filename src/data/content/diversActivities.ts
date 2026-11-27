export type DiversTheme =
  | 'maison'
  | 'animaux'
  | 'apprentissage'
  | 'exterieur'
  | 'cuisine'
  | 'social'
  | 'creativite'
  | 'bien_etre';

export interface DiversActivityDef {
  id: string;
  title: string;
  description: string;
  /** Durée indicative en minutes (affichage seulement). */
  durationMin: number;
  theme: DiversTheme;
  /** Consigne courte affichée au moment de confirmer. */
  confirmHint: string;
}

export const DIVERS_THEME_LABEL: Record<DiversTheme, string> = {
  maison: 'Maison',
  animaux: 'Animaux',
  apprentissage: 'Apprentissage',
  exterieur: 'Extérieur',
  cuisine: 'Cuisine',
  social: 'Social',
  creativite: 'Créativité',
  bien_etre: 'Bien-être',
};

/** Catalogue typé — 10 activités « petites actions » facultatives. */
export const DIVERS_ACTIVITIES: readonly DiversActivityDef[] = [
  {
    id: 'tidy_corner',
    title: 'Ranger un coin',
    description: 'Remets en ordre une petite zone : table, étagère ou tiroir.',
    durationMin: 10,
    theme: 'maison',
    confirmHint: 'Confirme seulement si tu as vraiment rangé ce coin.',
  },
  {
    id: 'water_plants',
    title: 'Arroser une plante',
    description: 'Une plante qui en a besoin, sans en faire trop.',
    durationMin: 5,
    theme: 'maison',
    confirmHint: 'Confirme après avoir arrosé au moins une plante.',
  },
  {
    id: 'pet_care',
    title: 'Moment avec un animal',
    description: 'Balade courte, toilettage léger ou jeu calme avec un animal de compagnie.',
    durationMin: 15,
    theme: 'animaux',
    confirmHint: 'Confirme si tu as passé un vrai moment avec l’animal.',
  },
  {
    id: 'read_pages',
    title: 'Lire quelques pages',
    description: 'Un passage d’un livre, article ou cours — pas besoin de finir.',
    durationMin: 15,
    theme: 'apprentissage',
    confirmHint: 'Confirme après avoir lu au moins un passage utile.',
  },
  {
    id: 'short_walk',
    title: 'Petite marche dehors',
    description: 'Sortir quelques minutes, même autour du pâté de maisons.',
    durationMin: 10,
    theme: 'exterieur',
    confirmHint: 'Confirme après une vraie sortie, même courte.',
  },
  {
    id: 'prep_snack',
    title: 'Préparer une collation',
    description: 'Préparer quelque chose de simple pour toi ou pour partager.',
    durationMin: 15,
    theme: 'cuisine',
    confirmHint: 'Confirme une fois la préparation faite.',
  },
  {
    id: 'kind_message',
    title: 'Message gentil',
    description: 'Écrire un court message à quelqu’un (sans obligation de réponse).',
    durationMin: 5,
    theme: 'social',
    confirmHint: 'Confirme après avoir envoyé ou rédigé le message.',
  },
  {
    id: 'sketch_doodle',
    title: 'Croquis ou carnet',
    description: 'Dessiner, noter une idée ou colorier quelques minutes.',
    durationMin: 10,
    theme: 'creativite',
    confirmHint: 'Confirme si tu as créé quelque chose, même petit.',
  },
  {
    id: 'stretch_break',
    title: 'Étirements courts',
    description: 'Quelques étirements ou mouvements doux pour le corps.',
    durationMin: 5,
    theme: 'bien_etre',
    confirmHint: 'Confirme après une pause corps réelle.',
  },
  {
    id: 'breathing_pause',
    title: 'Pause respiration',
    description: 'Quelques respirations calmes, sans chronomètre imposé.',
    durationMin: 3,
    theme: 'bien_etre',
    confirmHint: 'Confirme après une pause consciente.',
  },
  {
    id: 'inbox_clear',
    title: 'Désencombrer une liste',
    description: 'Traiter 2–3 items d’une liste (courses, tâches, mails non urgents).',
    durationMin: 10,
    theme: 'maison',
    confirmHint: 'Confirme après avoir traité au moins deux items.',
  },
  {
    id: 'learn_word',
    title: 'Apprendre un mot',
    description: 'Un mot, une notion ou une astuce nouvelle (langue, culture, savoir-faire).',
    durationMin: 5,
    theme: 'apprentissage',
    confirmHint: 'Confirme si tu as retenu ou noté quelque chose de nouveau.',
  },
];

export const DIVERS_ACTIVITY_BY_ID: Record<string, DiversActivityDef> = Object.fromEntries(
  DIVERS_ACTIVITIES.map((a) => [a.id, a]),
);

export const DIVERS_ACTIVITY_IDS: readonly string[] = DIVERS_ACTIVITIES.map((a) => a.id);

export function isDiversActivityId(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DIVERS_ACTIVITY_BY_ID, value);
}