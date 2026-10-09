// Event types from the title and venue, so parents can filter events by what happens there.
// German first (the data is German), a few English words for English-language listings.
const RULES = {
  reading: /vorles|lesung|bilderbuch|geschicht|m(ä|ae)rchen|b(ü|ue)cherei|bibliothek|kamishibai|story ?time/,
  diy: /bastel|werkstatt|workshop|mitmach|kreativ|malen|malerei|t(ö|oe)pfer|clay|n(ä|ae)h|flechten|experiment|forsch|kochen|kochgruppe|backen|craft|lego|robot|programmier/,
  stage: /theater|puppen|kasper|oper\b|kinderoper|zirkus|zauber|kino|film|cinep(ä|ae)nz|figuren|musical|show\b/,
  music: /musik|konzert|live\b|gitarre|quintett|band\b|singen|lieder|chor\b|orchester|trommel|rhythm|music/,
  sport: /sport|turnen|schwimm|kletter|capoeira|kampfsport|selbstverteidigung|yoga|fu(ß|ss)ball|tanz|bewegung|judo|karate|reiten|radfahr|fahrrad|skate/,
  animals: /tier|zoo\b|bauernhof|pony|esel|ziege|pferd|v(ö|oe)gel|imker|biene|alpaka|farm/,
  tour: /f(ü|ue)hrung|rundgang|museum|ausstellung|r(ö|oe)mer/,
  market: /markt|tr(ö|oe)del|basar|bazar/,
  fest: /fest\b|fest |feier|kirmes|party|jubil(ä|ae)um|parade|umzug|hoffest|festival/,
  outside: /wald|natur|wander|drau(ß|ss)en|garten|spaziergang|exkursion|outdoor|erlebnispfad/,
  season: /ferien|halloween|advent|weihnacht|nikolaus|ostern|karneval|laterne|martin/,
  parents: /vortrag|elternabend|elterncaf|babysitter|erziehung|beratung|mediation|ged(ä|ae)chtnistraining|mit kindern (ü|ue)ber|informationsveranstaltung|babymassage|elternzeit/,
};

// A venue says what happens there only for these (a library also hosts language courses).
const FROM_VENUE = new Set(["animals", "stage", "tour"]);

/** Every type whose words appear in the title (or, for a few types, the venue), in a fixed order. */
export function tagsOf(title, venue) {
  const t = String(title || "").toLowerCase(), v = String(venue || "").toLowerCase();
  return Object.entries(RULES).filter(([k, re]) => re.test(t) || (FROM_VENUE.has(k) && re.test(v))).map(([k]) => k);
}

// How much German an event needs, for parents who don't speak it: "en" (held in English or
// bilingual), "de" (mostly listening or talking: readings, theatre, guided tours, talks),
// "none" (you can join in without it: animals, markets, fests, crafts, sport, music).
// Undefined when the title gives no clue.
const ENGLISH = /\benglish\b|englisch|bilingual|zweisprachig|deutsch[- ]englisch/;
// Held in another language (Vorlesezeit auf Türkisch): German doesn't help or hurt, so no label.
const OTHER = /auf (t(ü|ue)rkisch|arabisch|ukrainisch|russisch|polnisch|spanisch|franz(ö|oe)sisch|italienisch|griechisch|persisch|chinesisch)|mehrsprachig/;
const TALK = /h(ö|oe)rspiel|f(ü|ue)hrung|rundgang|vortrag|lesung|vorles|erz(ä|ae)hl|gespr(ä|ae)ch|diskussion|seminar|kurs\b|sprachkurs|schreib|quiz|dialog/;
const TALK_TAGS = ["reading", "stage", "parents"];
const HANDS_TAGS = ["animals", "market", "fest", "diy", "sport", "music", "outside"];

export function languageOf(title, tags = []) {
  const t = String(title || "").toLowerCase();
  if (ENGLISH.test(t)) return "en";
  if (OTHER.test(t)) return undefined;
  if (TALK.test(t) || tags.some((g) => TALK_TAGS.includes(g))) return "de";
  if (tags.some((g) => HANDS_TAGS.includes(g))) return "none";
  return undefined;
}
