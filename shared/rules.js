/* Gemeinsame Spielregeln für Server und Browser.
   Im Browser liegt alles unter window.TWRules, in Node über require(). */
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

  return { FACTIONS, COUNTRY_FACTION, START_COINS, START_TROOPS, SEA_RANGE_KM, rnd, regionStats, loot, distanceKm, NAME_RE };
});
