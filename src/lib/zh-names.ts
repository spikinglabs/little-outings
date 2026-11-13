// German place names stay German in Chinese text (L, 2026-11-13: "德语地名不用翻译"). Parents find a place
// on the map, a sign or a tram display by its German name, so 罗马广场 for Römerberg only gets in the way.
// Every prompt that writes Chinese takes this rule; the Rednote posts in posts/ follow it by hand.

/** The rule, as a prompt line. */
export const ZH_NAMES = `- In Chinese, German place names stay exactly as written in German, never translated or transliterated: squares, streets, districts, parks, rivers' banks, bridges, buildings, town halls, churches, castles, museums, venues, markets and stations (Römerberg, not 罗马广场; Marienplatz, not 玛利亚广场; Rotes Rathaus, not 红色市政厅; also Jungfernstieg, Schloss Charlottenburg, Kölner Dom, Mainkai). When the name alone doesn't say what kind of place or event it is, say that in Chinese next to the name: "Weihnachtsmarkt am Roten Rathaus" → "Rotes Rathaus 圣诞市场"; "Spielplatz Weegen" → "Weegen 游乐场"; "Beethovenpark" → "Beethovenpark 公园". Only towns and cities, federal states and the big rivers keep their usual Chinese names: 科隆, 法兰克福, 慕尼黑, 黑森州, 莱茵河, 美因河.`;

/** Chinese renderings of German place names the posts and notes used before the rule, for the test that keeps them out. */
export const TRANSLATED_NAMES = [
  "罗马广场", "罗马贝格", "罗马山", "保罗广场", "美因河岸", "玛利亚广场", "卡尔广场", "红色市政厅", "夏洛滕堡宫", "威廉皇帝纪念教堂",
  "少女堤", "鹅市场", "圣彼得教堂", "市政厅广场", "阿尔斯特湖", "中国塔", "奥林匹克公园", "英国花园", "王宫", "新市政厅",
  "港口市场", "巧克力博物馆", "历史博物馆", "圣尼古拉教堂", "伊萨尔门", "考芬格大街", "维克图阿利恩市场", "国王大道", "城堡广场",
  "老港口", "明斯特广场", "莱辛纪念碑", "海神喷泉", "罗森塔尔", "博伊尔", "海德恩海姆",
];
