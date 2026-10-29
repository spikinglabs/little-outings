// The name a contribution is shown under ("Tip from Brave Hedgehog"). It's made up for the family the first
// time it's needed and kept in the profile (lo-nick), so all their tips carry the same name; forms only say
// "Sent as …" with a link to Profile, where it can be changed, re-rolled or emptied (anonymous).

const WORDS: Record<string, { adj: string[]; animal: string[]; join: (a: string, b: string) => string }> = {
  en: {
    adj: ["Brave", "Happy", "Curious", "Sunny", "Busy", "Gentle", "Lucky", "Merry", "Clever", "Cosy", "Bouncy", "Sleepy", "Speedy", "Jolly"],
    animal: ["Hedgehog", "Fox", "Squirrel", "Owl", "Otter", "Badger", "Duck", "Rabbit", "Deer", "Beaver", "Robin", "Hare", "Mole", "Frog"],
    join: (a, b) => `${a} ${b}`,
  },
  de: {
    adj: ["Mutiger", "Fröhlicher", "Neugieriger", "Sonniger", "Fleißiger", "Sanfter", "Flinker", "Lustiger", "Schlauer", "Kuscheliger", "Munterer", "Verträumter"],
    animal: ["Igel", "Fuchs", "Biber", "Dachs", "Hase", "Frosch", "Maulwurf", "Otter", "Uhu", "Rabe", "Specht", "Hirsch"],
    join: (a, b) => `${a} ${b}`,
  },
  zh: {
    adj: ["勇敢的", "快乐的", "好奇的", "阳光的", "勤快的", "温柔的", "幸运的", "开心的", "聪明的", "暖暖的", "蹦蹦跳跳的", "迷糊的"],
    animal: ["小刺猬", "小狐狸", "小松鼠", "猫头鹰", "小水獭", "小獾", "小鸭子", "小兔子", "小鹿", "小海狸", "小青蛙", "小鼹鼠"],
    join: (a, b) => `${a}${b}`,
  },
};

const pick = <T>(list: T[], r: () => number) => list[Math.floor(r() * list.length)];

/** A random nickname in the page's language. */
export function randomNick(lang: string, r: () => number = Math.random): string {
  const w = WORDS[lang] ?? WORDS.en;
  return w.join(pick(w.adj, r), pick(w.animal, r));
}

export const NICK_MAX = 30;

/** What may be shown: trimmed, short, and never an email address, a link or a phone number. Empty means "no name". */
export function cleanNick(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NICK_MAX);
  if (/@|https?:|www\.|\.(com|de|net|org)\b|\d{4,}/i.test(s)) return "";
  return s;
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** Saves the nickname; an emptied field means "stay anonymous", remembered as "". */
export function rememberNick(store: Pick<Storage, "setItem">, nick: string) {
  store.setItem("lo-nick", cleanNick(nick));
}

/** This family's nickname, made up and saved the first time it's asked for. "" means anonymous. */
export function myNick(store: Store, lang: string): string {
  const saved = store.getItem("lo-nick");
  if (saved !== null) return cleanNick(saved);
  const nick = randomNick(lang);
  rememberNick(store, nick);
  return nick;
}

/**
 * This browser's random id (lo-voter, same one the taps use), sent with a contribution so two families
 * who picked the same nickname can be told apart. The server keeps only a short hash of it (by_id).
 */
export function myId(store: Store): string {
  let v = store.getItem("lo-voter");
  if (!v) { v = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; store.setItem("lo-voter", v); }
  return v;
}

/** True once: after the first thing this family sends, so the thanks can say where to change the name. */
export function firstSendHint(store: Store): boolean {
  if (store.getItem("lo-nick-hinted")) return false;
  store.setItem("lo-nick-hinted", "1");
  return true;
}
