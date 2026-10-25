// St. Martin lantern walks (Martinszug, Laternenumzug), around 11 November. Discover shows a
// "St. Martin" chip in the weeks they run, and /<lang>/mitmachen/?martin=1 is a short form
// parents share in Kita chats to add their walk.

/** Titles of lantern walks and Martin festivals; "Martin Pfeiffer" and Martin Luther are not. */
const MARTIN = /martins?-?(?:zug|züge|zuege|umzug|umzüge|umzuege|feier|fest|singen|lieder|spiel|andacht|markt)|(?:sankt|st\.?)[ -]?martins?\b|laterne(?:n|l)?-?(?:umzug|umzüge|zug|züge|lauf|fest|wanderung|bastel)|lichterzug/i;

export const isMartin = (title: string) => MARTIN.test(title);

/** The weeks the chip shows: from 25 October to 15 November, as YYYY-MM-DD in Germany. */
export function martinSeason(today: string): boolean {
  const md = today.slice(5);
  return md >= "10-25" && md <= "11-15";
}
