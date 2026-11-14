import type { ClassId } from '../../domain/models/types';

export interface ClassDef {
  id: ClassId;
  name: string;
  blurb: string;
}

export const CLASSES: ClassDef[] = [
  { id: 'rodeur', name: 'Rôdeur', blurb: 'Observe, se déplace léger, préfère les sentiers discrets.' },
  { id: 'gardien', name: 'Gardien', blurb: 'Protège le camp et tient les engagements du quotidien.' },
  { id: 'sage', name: 'Sage', blurb: 'Cherche le sens, note, respire, ajuste sans se juger.' },
  { id: 'artisan', name: 'Artisan', blurb: 'Construit petit à petit : projets, habitudes, camp.' },
];
