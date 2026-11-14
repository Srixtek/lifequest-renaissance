/** Verified FR help lines — dates from research 2026-11-10. */
export const HELP_LINES = [
  {
    id: 'tabac',
    name: 'Tabac Info Service',
    phone: '39 89',
    hours: '7j/7',
    note: 'Aide tabac / vape. Vérifié 10/11/2026.',
  },
  {
    id: 'alcool',
    name: 'Alcool Info Service',
    phone: '0 980 980 930',
    hours: '7j/7 8 h–23 h (depuis 01/10/2026)',
    note: 'Anonyme, non surtaxé. Vérifié 10/11/2026.',
  },
  {
    id: 'urgence',
    name: 'Urgences',
    phone: '15 / 112',
    hours: '24 h/24',
    note: 'Détresse vitale, delirium tremens, convulsions.',
  },
  {
    id: 'suicide',
    name: '3114',
    phone: '3114',
    hours: '24 h/24',
    note: 'Prévention du suicide, écoute.',
  },
] as const;

export const HEALTH_GUARDRAIL =
  'LifeQuest n\'est pas un dispositif médical. Aucun conseil de sevrage médicamenteux. En cas de doute, parle à un professionnel de santé.';
