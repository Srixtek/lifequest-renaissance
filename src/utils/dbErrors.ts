/** Map low-level SQLite errors to short French UI messages. */
export function friendlyDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('UNIQUE constraint')) {
    return 'Cet enregistrement existe déjà.';
  }
  if (msg.includes('FOREIGN KEY')) {
    return 'Enregistrement impossible : référence manquante.';
  }
  if (msg.includes('Version active introuvable')) {
    return 'Version active introuvable pour cet objectif.';
  }
  return 'Enregistrement impossible pour le moment.';
}