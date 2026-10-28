// English and Chinese names of the places-only towns (osm-family-data's more_towns: every city of about
// 100,000 or more that has no event calendar here yet). The towns with events have theirs in content/regions/.
// German names are the keys, exactly as osm-family-data writes a place's town.
export const MORE_TOWN_NAMES: Record<string, { en?: string; zh: string }> = {
  Duisburg: { zh: "杜伊斯堡" }, Oberhausen: { zh: "奥伯豪森" }, "Mülheim an der Ruhr": { en: "Mülheim", zh: "米尔海姆" },
  Bottrop: { zh: "博特罗普" }, Gelsenkirchen: { zh: "盖尔森基兴" }, Herne: { zh: "黑尔讷" }, Bochum: { zh: "波鸿" },
  Recklinghausen: { zh: "雷克林豪森" }, Witten: { zh: "维滕" }, Dortmund: { zh: "多特蒙德" }, Hagen: { zh: "哈根" },
  Hamm: { zh: "哈姆" }, Moers: { zh: "默尔斯" }, Krefeld: { zh: "克雷菲尔德" }, Mönchengladbach: { zh: "门兴格拉德巴赫" },
  Neuss: { zh: "诺伊斯" }, Solingen: { zh: "索林根" }, Remscheid: { zh: "雷姆沙伊德" }, Münster: { zh: "明斯特" },
  Osnabrück: { zh: "奥斯纳布吕克" }, Bielefeld: { zh: "比勒费尔德" }, Gütersloh: { zh: "居特斯洛" }, Paderborn: { zh: "帕德博恩" },
  Siegen: { zh: "锡根" }, Wiesbaden: { zh: "威斯巴登" }, Mainz: { zh: "美因茨" }, Darmstadt: { zh: "达姆施塔特" },
  "Offenbach am Main": { en: "Offenbach", zh: "奥芬巴赫" }, Hanau: { zh: "哈瑙" }, Mannheim: { zh: "曼海姆" },
  "Ludwigshafen am Rhein": { en: "Ludwigshafen", zh: "路德维希港" }, Heidelberg: { zh: "海德堡" }, Kaiserslautern: { zh: "凯泽斯劳滕" },
  Koblenz: { zh: "科布伦茨" }, Trier: { zh: "特里尔" }, Saarbrücken: { zh: "萨尔布吕肯" }, Stuttgart: { zh: "斯图加特" },
  Reutlingen: { zh: "罗伊特林根" }, Heilbronn: { zh: "海尔布隆" }, Karlsruhe: { zh: "卡尔斯鲁厄" }, Pforzheim: { zh: "普福尔茨海姆" },
  "Freiburg im Breisgau": { en: "Freiburg", zh: "弗莱堡" }, Ulm: { zh: "乌尔姆" }, Nürnberg: { en: "Nuremberg", zh: "纽伦堡" },
  Fürth: { zh: "菲尔特" }, Erlangen: { zh: "埃尔朗根" }, Augsburg: { zh: "奥格斯堡" }, Ingolstadt: { zh: "因戈尔施塔特" },
  Regensburg: { zh: "雷根斯堡" }, Würzburg: { zh: "维尔茨堡" }, Kassel: { zh: "卡塞尔" }, Göttingen: { zh: "哥廷根" },
  Hannover: { en: "Hanover", zh: "汉诺威" }, Hildesheim: { zh: "希尔德斯海姆" }, Braunschweig: { en: "Brunswick", zh: "不伦瑞克" },
  Wolfsburg: { zh: "沃尔夫斯堡" }, Salzgitter: { zh: "萨尔茨吉特" }, Bremen: { zh: "不来梅" }, Bremerhaven: { zh: "不来梅港" },
  Oldenburg: { zh: "奥尔登堡" }, Kiel: { zh: "基尔" }, Lübeck: { zh: "吕贝克" }, Rostock: { zh: "罗斯托克" },
  Schwerin: { zh: "什未林" }, Potsdam: { zh: "波茨坦" }, Cottbus: { zh: "科特布斯" }, Magdeburg: { zh: "马格德堡" },
  Leipzig: { zh: "莱比锡" }, "Halle (Saale)": { en: "Halle", zh: "哈勒" }, Dresden: { zh: "德累斯顿" }, Chemnitz: { zh: "开姆尼茨" },
  Erfurt: { zh: "爱尔福特" }, Jena: { zh: "耶拿" },
};
