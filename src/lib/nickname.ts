// The name a contribution is shown under ("Tip from Brave Hedgehog"). The form fills in a random nickname
// that people can re-roll or change; the hint asks for a nickname, never a real name. Kept in the profile
// (lo-nick), so one family's tips all carry the same name.

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

/** Remembers the nickname for next time; an emptied field means "stay anonymous", remembered as "". */
export function rememberNick(store: Pick<Storage, "setItem">, nick: string) {
  store.setItem("lo-nick", cleanNick(nick));
}
