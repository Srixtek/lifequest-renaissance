import type { ClassId } from '../../domain/models/types';

export interface ClassDef {
  id: ClassId;
  name: string;
  blurb: string;
  /** Thème narratif — pas de bonus gameplay (missions RPG ultérieures). */
  theme: string;
}

export const CLASSES: ClassDef[] = [
  {
    id: 'rodeur',
    name: 'Rôdeur',
    theme: 'Exploration',
    blurb: 'Tu scrutes l\'horizon et choisis tes pas. Idéal si tu aimes avancer à ton rythme.',
  },
  {
    id: 'gardien',
    name: 'Gardien',
    theme: 'Protection',
    blurb: 'Tu veilles sur toi et sur ce qui compte. Fidèle aux engagements du quotidien.',
  },
  {
    id: 'sage',
    name: 'Sage',
    theme: 'Connaissance',
    blurb: 'Tu observes, notes et respires avant d\'agir. Sans te juger, tu ajustes.',
  },
  {
    id: 'artisan',
    name: 'Artisan',
    theme: 'Construction',
    blurb: 'Tu bâtis pierre après pierre : habitudes, projets, camp.',
  },
];
