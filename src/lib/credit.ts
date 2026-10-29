// Nicknames are free to pick, so two families can end up with the same one. Each contribution also
// carries `byId`, a short hash of the sender's browser id (functions/api/inbox.ts). Where one name is
// used by more than one id, each gets a short tag ("Allo.Land #3f2a"); a name only one family uses
// stays as it is. Contributions sent before ids existed have none and are never tagged.

type Credited = { by?: string; byId?: string };

/** Adds the tag to `by` wherever the same name (ignoring case) belongs to more than one family. */
export function tagSharedNames(items: Credited[]): void {
  const ids = new Map<string, Set<string>>();
  for (const x of items) {
    if (!x.by || !x.byId) continue;
    const k = x.by.toLowerCase();
    if (!ids.has(k)) ids.set(k, new Set());
    ids.get(k)!.add(x.byId);
  }
  for (const x of items) {
    if (x.by && x.byId && ids.get(x.by.toLowerCase())!.size > 1) x.by = `${x.by} #${x.byId.slice(0, 4)}`;
  }
}
