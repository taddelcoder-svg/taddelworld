/* Gemeinsame Spielregeln für Server und Browser.
   Im Browser liegt alles unter window.TWRules, in Node über require().
   Der Server rechnet damit verbindlich, der Browser nur zur Anzeige. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TWRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // KI-Reiche und ihre Länder (ISO-3-Codes)
  const FACTIONS = {
    nord:  { name: 'Nordbund',    color: '#5B7FD6', c: ['NOR', 'SWE', 'FIN', 'ISL', 'DNK'] },
    sonne: { name: 'Sonnenreich', color: '#D9644A', c: ['BRA', 'ARG', 'CHL', 'URY', 'PRY'] },
    ost:   { name: 'Ostlöwen',    color: '#9467D6', c: ['CHN', 'MNG', 'KAZ'] },
    duene: { name: 'Dünenpakt',   color: '#C79A3A', c: ['EGY', 'LBY', 'DZA', 'TUN', 'MAR'] },
    adler: { name: 'Adlerkrone',  color: '#3F9C8A', c: ['USA', 'CAN', 'MEX'] }
  };
  const COUNTRY_FACTION = {};
  for (const f in FACTIONS) FACTIONS[f].c.forEach(c => { COUNTRY_FACTION[c] = f; });

  const START_COINS = 300;
  const START_TROOPS = 18;
  const SEA_RANGE_KM = 900;
  const BUILDERS = 2;
  const MAX_TH = 5;
  const OFFLINE_CAP_SEC = 24 * 3600;

  /* Gebäude. minTH: ab welcher Rathaus-Stufe baubar. maxLvl: höchste Ausbaustufe.
     time: Sekunden für den Ausbau von Stufe 1 auf 2, danach wächst die Zeit mit der Stufe zum Quadrat. */
  const BUILDINGS = {
    rathaus:   { name: 'Rathaus',        cost: 0,    color: '#E6D3A3', inc: 2,  jobs: 2, hap: 3,  minTH: 99, maxLvl: MAX_TH, time: 60, unique: true },
    haus:      { name: 'Wohnhaus',       cost: 40,   color: '#F2B5A7', pop: 4,  minTH: 1, maxLvl: 1 },
    markt:     { name: 'Markt',          cost: 120,  color: '#F6D68B', inc: 3,  jobs: 4, hap: 2,  minTH: 1, time: 20 },
    park:      { name: 'Park',           cost: 60,   color: '#A8D5BA', hap: 6,  minTH: 1, time: 15 },
    farm:      { name: 'Bauernhof',      cost: 100,  color: '#C9DE8C', inc: 2,  jobs: 2, hap: 1,  minTH: 1, time: 15 },
    brunnen:   { name: 'Löwenbrunnen',   cost: 90,   color: '#BFD7E6', hap: 4,  minTH: 1, time: 15 },
    pflaster:  { name: 'Pflasterweg',    cost: 5,    color: '#C8BBA6', minTH: 1, maxLvl: 1 },
    banner:    { name: 'Banner',         cost: 30,   color: '#F4F1EA', hap: 1,  minTH: 1, maxLvl: 1 },
    werk:      { name: 'Werkstatt',      cost: 200,  color: '#9CB4C8', inc: 7,  jobs: 6, hap: -5, minTH: 2, time: 30 },
    baeckerei: { name: 'Bäckerei',       cost: 150,  color: '#F3D9B1', inc: 4,  jobs: 3, hap: 2,  minTH: 2, time: 25 },
    muehle:    { name: 'Windmühle',      cost: 180,  color: '#E9E4D8', inc: 3,  jobs: 2, hap: 1,  minTH: 2, time: 25 },
    kaserne:   { name: 'Kaserne',        cost: 250,  color: '#B07A6A', jobs: 5, hap: -2, troops: 0.5, minTH: 2, time: 40 },
    hafen:     { name: 'Hafen',          cost: 350,  color: '#C9A27A', inc: 12, jobs: 8, hap: 1,  minTH: 2, time: 45, water: true },
    bruecke:   { name: 'Brücke',         cost: 60,   color: '#A9A49A', hap: 1,  minTH: 2, maxLvl: 1, water: true },
    wachturm:  { name: 'Wachturm',       cost: 220,  color: '#B9B2A6', jobs: 1, hap: -1, troops: 0.2, minTH: 3, time: 40 },
    kirche:    { name: 'Kirche',         cost: 400,  color: '#DCE3EA', jobs: 1, hap: 10, minTH: 3, time: 60 },
    turm:      { name: 'Leuchtturm',     cost: 600,  color: '#F4F1EA', inc: 2,  jobs: 2, hap: 8,  minTH: 4, time: 60 },
    monument:  { name: 'Löwen-Monument', cost: 2000, color: '#E9C46A', inc: 10, hap: 15, minTH: 5, time: 120 }
  };
  for (const k in BUILDINGS) { const b = BUILDINGS[k]; if (b.maxLvl == null) b.maxLvl = 5; }

  const LAWS = [
    { id: 'autofrei', name: 'Autofreie Insel', info: '+10 Zufriedenheit, −10 % Einnahmen' },
    { id: 'ruhe',     name: 'Nachtruhe',       info: '+5 Zufriedenheit, Werkstätten −20 %' },
    { id: 'markttag', name: 'Markttag',        info: 'Märkte +50 %, −2 Zufriedenheit' },
    { id: 'wehr',     name: 'Wehrpflicht',     info: 'Truppen +50 %, −6 Zufriedenheit' }
  ];
  const LAW_IDS = LAWS.map(l => l.id);

  // Wirkung je Stufe: Ertrag und Truppen wachsen kräftig, Jobs und Zufriedenheit etwas
  const LVL_MULT = [1, 1.6, 2.3, 3.1, 4];
  const lvlMult = lvl => LVL_MULT[Math.max(1, Math.min(5, lvl)) - 1];
  const upgradeCost = (type, lvl) => type === 'rathaus' ? Math.round(500 * Math.pow(2.6, lvl - 1)) : Math.round(BUILDINGS[type].cost * Math.pow(1.8, lvl));
  const upgradeTime = (type, lvl) => Math.round(BUILDINGS[type].time * lvl * lvl);
  const rushCost = sec => Math.max(10, Math.ceil(sec * 2));
  const maxFloors = th => Math.min(5, th + 1);
  const maxChunks = th => th * 3;
  const landCost = bought => 150 + bought * 100;

  // Raster: 48 × 48 Felder, Grundstücke zu 6 × 6, die mittleren vier gehören allen von Anfang an
  const GRID_HALF = 24, CHUNK = 6;
  const START_CHUNKS = ['3,3', '3,4', '4,3', '4,4'];
  const chunkOf = k => { const [i, j] = k.split(',').map(Number); return Math.floor((i + GRID_HALF) / CHUNK) + ',' + Math.floor((j + GRID_HALF) / CHUNK); };
  const STARTER = [['haus', 2], ['haus', 1], ['markt'], ['park'], ['haus', 3], ['haus', 1], ['rathaus']];

  function townHall(grid) { for (const k in grid || {}) if (grid[k].type === 'rathaus') return grid[k].lvl || 1; return 1; }
  function busyCount(grid, now) { let n = 0; for (const k in grid || {}) if (grid[k].busyUntil && grid[k].busyUntil > now) n++; return n; }

  /* Bewohner, Jobs, Zufriedenheit, Einnahmen und Truppen einer Stadt */
  function cityStats(city, regionIncome) {
    let pop = 0, jobs = 0, hap = 60, troopB = 0;
    const inc = {}, counts = {}, L = city.laws || {}, grid = city.grid || {};
    for (const k in grid) {
      const g = grid[k], t = BUILDINGS[g.type]; if (!t) continue;
      counts[g.type] = (counts[g.type] || 0) + 1;
      if (g.type === 'haus') { pop += t.pop * (g.floors ? g.floors.length : 1); continue; }
      const lvl = g.lvl || 1, m = lvlMult(lvl);
      jobs += (t.jobs || 0) * (1 + 0.5 * (lvl - 1));
      inc[g.type] = (inc[g.type] || 0) + (t.inc || 0) * m;
      hap += (t.hap || 0) * (1 + 0.3 * (lvl - 1));
      troopB += (t.troops || 0) * m;
    }
    if (L.ruhe && inc.werk) inc.werk *= 0.8;
    if (L.markttag && inc.markt) inc.markt *= 1.5;
    hap += (L.autofrei ? 10 : 0) + (L.ruhe ? 5 : 0) - (L.markttag ? 2 : 0) - (L.wehr ? 6 : 0);
    hap -= (city.tax || 0) * 1.4;
    hap = Math.max(0, Math.min(100, hap));
    jobs = Math.round(jobs);
    const staff = jobs ? Math.min(1, pop / jobs) : 1;
    let income = Object.values(inc).reduce((a, b) => a + b, 0) * staff + pop * (city.tax || 0) / 100 * 1.2 + (regionIncome || 0);
    income *= 0.5 + hap / 100;
    if (L.autofrei) income *= 0.9;
    const troopRate = (0.25 + troopB * staff) * (L.wehr ? 1.5 : 1);
    return { pop, jobs, hap, income, staff, counts, troopRate, reg: regionIncome || 0 };
  }

  function rnd(s) { const v = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }

  // Verteidigung und Ertrag einer Region, nur aus ihrem Index und Reich abgeleitet
  function regionStats(index, faction) {
    const a = rnd(index * 7.13 + 3), b = rnd(index * 3.7 + 1), c = rnd(index * 5.1 + 2);
    return {
      def: Math.round((faction ? 10 : 3) + a * (faction ? 9 : 6) + b * 4),
      yield: Math.round((0.8 + a * 1.2 + c * 1.5) * 10) / 10
    };
  }

  function loot(def) { return Math.round(def * 15); }

  function distanceKm([lon1, lat1], [lon2, lat2]) {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const NAME_RE = /^[A-Za-z0-9_\-äöüÄÖÜß]{3,20}$/;

  return {
    FACTIONS, COUNTRY_FACTION, START_COINS, START_TROOPS, SEA_RANGE_KM, BUILDERS, MAX_TH, OFFLINE_CAP_SEC,
    BUILDINGS, LAWS, LAW_IDS, lvlMult, upgradeCost, upgradeTime, rushCost, maxFloors, maxChunks, landCost,
    GRID_HALF, CHUNK, START_CHUNKS, chunkOf, STARTER, townHall, busyCount, cityStats,
    rnd, regionStats, loot, distanceKm, NAME_RE
  };
});
