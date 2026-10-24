'use strict';
/* Spiel-Server für Löwen-Inseln (taddelworld).
   Liefert das Spiel aus, verwaltet Konten, speichert jede Stadt und vergibt die
   Regionen der Weltkarte, damit jede Region genau einem Spieler gehört.
   Keine Abhängigkeiten außer Node 18+.

   Speicher: Mit SUPABASE_URL und SUPABASE_SERVICE_KEY liegt alles als eine Zeile in
   der Tabelle „taddelworld_speicher“ (siehe supabase_setup.sql) und übersteht Deploys.
   Ohne diese Variablen wird nur lokal in daten.json gespeichert. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./shared/rules');

const PORT = process.env.PORT || 10000;
const DB_DATEI = path.join(__dirname, 'daten.json');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const MIT_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const TABELLE = `${SUPABASE_URL}/rest/v1/taddelworld_speicher`;
const KOPF = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
const SITZUNG_TAGE = 180;
const MAX_SPIELER = 5000;

let daten = { users: {}, sessions: {}, cities: {}, regions: {} };
let geaendert = false;

/* ---------- Speicher ---------- */
async function laden() {
  if (MIT_SUPABASE) {
    for (let versuch = 1; versuch <= 3; versuch++) {
      try {
        const res = await fetch(`${TABELLE}?id=eq.haupt&select=daten`, { headers: KOPF });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const z = await res.json();
        if (z[0] && z[0].daten) daten = z[0].daten;
        console.log('Daten aus Supabase geladen.');
        return;
      } catch (e) { console.error(`Laden aus Supabase fehlgeschlagen (Versuch ${versuch}):`, e.message); await new Promise(r => setTimeout(r, 1500)); }
    }
    // Ohne erfolgreiches Laden nicht starten, sonst würde der leere Stand die echten Daten überschreiben
    console.error('Abbruch: Supabase nicht erreichbar.'); process.exit(1);
  }
  try { daten = JSON.parse(fs.readFileSync(DB_DATEI, 'utf8')); } catch (e) {}
  for (const k of ['users', 'sessions', 'cities', 'regions']) daten[k] = daten[k] || {};
}

let speichert = false;
async function speichern() {
  if (!geaendert || speichert) return;
  speichert = true; geaendert = false;
  try {
    if (MIT_SUPABASE) {
      const res = await fetch(TABELLE, { method: 'POST',
        headers: { ...KOPF, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: 'haupt', daten, geaendert_am: new Date().toISOString() }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } else fs.writeFileSync(DB_DATEI, JSON.stringify(daten));
  } catch (e) { geaendert = true; console.error('Speichern fehlgeschlagen:', e.message); }
  speichert = false;
}
setInterval(speichern, 5000);

/* ---------- Weltkarte: Nachbarn und Mittelpunkte aus world.json ---------- */
const WELT = (() => {
  const topo = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'assets', 'world.json'), 'utf8'));
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const geoms = topo.objects.regions.geometries;
  const arcOwners = new Map(), regions = [];
  const ringsOf = g => g.type === 'Polygon' ? g.arcs : g.type === 'MultiPolygon' ? g.arcs.flat() : [];
  geoms.forEach((g, i) => {
    let sumX = 0, sumY = 0, n = 0;
    for (const ring of ringsOf(g)) for (const a of ring) {
      const idx = a < 0 ? ~a : a;
      if (!arcOwners.has(idx)) arcOwners.set(idx, new Set());
      arcOwners.get(idx).add(i);
      for (const [lon, lat] of arcs[idx]) { sumX += lon; sumY += lat; n++; }
    }
    const cc = g.properties && g.properties.adm0_a3;
    regions[i] = { id: 'r' + i, cc, faction: R.COUNTRY_FACTION[cc] || null, centroid: n ? [sumX / n, sumY / n] : [0, 0], nb: new Set(), ...R.regionStats(i, R.COUNTRY_FACTION[cc] || null) };
  });
  for (const set of arcOwners.values()) for (const a of set) for (const b of set) if (a !== b) regions[a].nb.add('r' + b);
  const byId = {}; regions.forEach(r => { byId[r.id] = r; });
  return { byId, count: regions.length };
})();

/* ---------- Konten ---------- */
const schluessel = name => String(name).toLowerCase();
function hashPasswort(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function neueSitzung(u) {
  const token = crypto.randomBytes(32).toString('base64url');
  daten.sessions[crypto.createHash('sha256').update(token).digest('hex')] = { u, erstellt: Date.now(), gesehen: Date.now() };
  geaendert = true;
  return token;
}
function sitzung(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = crypto.createHash('sha256').update(m[1]).digest('hex'), s = daten.sessions[h];
  if (!s || !daten.users[s.u]) return null;
  if (Date.now() - s.gesehen > SITZUNG_TAGE * 864e5) { delete daten.sessions[h]; geaendert = true; return null; }
  if (Date.now() - s.gesehen > 36e5) { s.gesehen = Date.now(); geaendert = true; }
  return { hash: h, u: s.u };
}

// Einfacher Schutz gegen Passwort-Raten: 10 Fehlversuche pro IP in 10 Minuten
const fehlversuche = new Map();
function gesperrt(ip) { const f = fehlversuche.get(ip); return f && f.n >= 10 && Date.now() - f.t < 6e5; }
function fehlversuch(ip) { const f = fehlversuche.get(ip); if (!f || Date.now() - f.t > 6e5) fehlversuche.set(ip, { n: 1, t: Date.now() }); else f.n++; }

/* ---------- Städte ---------- */
const B = R.BUILDINGS;
const FARBE = /^#[0-9A-Fa-f]{6}$/;
const FELD = /^-?\d{1,2},-?\d{1,2}$/;
const GRUND = /^\d,\d$/;

function stadtVon(u) {
  const c = daten.cities[u] || (daten.cities[u] = { coins: R.START_COINS, troops: R.START_TROOPS, earned: 0, day: 1, tax: 10, laws: {}, grid: null, unlocked: [], log: [], home: null });
  // Alte Spielstände: Stufe 1 für alles, Zeitstempel für die Wirtschaft
  if (c.grid) for (const k in c.grid) { const g = c.grid[k]; if (!B[g.type]) delete c.grid[k]; else if (!g.lvl) g.lvl = 1; }
  if (!c.lastTick) c.lastTick = c.saved || Date.now();
  if (!Array.isArray(c.unlocked)) c.unlocked = [];
  return c;
}
function meineRegionen(u) { return Object.keys(daten.regions).filter(r => daten.regions[r] === u); }
function regionsErtrag(u) { return meineRegionen(u).reduce((s, r) => s + (WELT.byId[r] ? WELT.byId[r].yield : 0), 0); }
function protokoll(c, m) { c.log = [{ t: 'Tag ' + (c.day || 1), m: String(m).slice(0, 200) }].concat(c.log || []).slice(0, 8); }

// Einnahmen und fertige Ausbauten bis jetzt nachrechnen. Liefert, was offline dazukam.
function vorrechnen(u, c, jetzt) {
  const ertrag = regionsErtrag(u);
  let t = Math.max(c.lastTick, jetzt - R.OFFLINE_CAP_SEC * 1000);
  const vorher = { coins: c.coins, troops: c.troops };
  const sammeln = bis => {
    const sek = Math.max(0, (bis - t) / 1000); if (!sek) return;
    const s = R.cityStats(c, ertrag);
    c.coins += s.income * sek; c.earned += s.income * sek; c.troops += s.troopRate * sek; t = bis;
  };
  const fertig = Object.keys(c.grid || {}).filter(k => c.grid[k].busyUntil && c.grid[k].busyUntil <= jetzt)
    .sort((a, b) => c.grid[a].busyUntil - c.grid[b].busyUntil);
  for (const k of fertig) {
    const g = c.grid[k];
    sammeln(Math.max(t, g.busyUntil));
    g.lvl = (g.lvl || 1) + 1; delete g.busyUntil;
    protokoll(c, B[g.type].name + ' ist jetzt auf Stufe ' + g.lvl + '.');
  }
  sammeln(jetzt);
  c.lastTick = jetzt;
  return { coins: Math.floor(c.coins - vorher.coins), troops: Math.floor(c.troops - vorher.troops) };
}

function stadtAnsicht(u, c, jetzt, extra) {
  return { city: { coins: c.coins, troops: c.troops, earned: c.earned, day: c.day, tax: c.tax, laws: c.laws, grid: c.grid, unlocked: c.unlocked, log: c.log, home: c.home },
    regionIncome: regionsErtrag(u), now: jetzt, ...extra };
}

// Darf auf diesem Feld gebaut werden? Wasser-Gebäude brauchen ein freigeschaltetes Nachbarfeld.
function feldFrei(c, k, wasser) {
  const offen = ch => R.START_CHUNKS.includes(ch) || c.unlocked.includes(ch);
  if (!wasser) return offen(R.chunkOf(k));
  const [i, j] = k.split(',').map(Number);
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => offen(R.chunkOf((i + a) + ',' + (j + b))));
}
function imRaster(k) { const [i, j] = k.split(',').map(Number); return Math.abs(i + 0.5) < R.GRID_HALF && Math.abs(j + 0.5) < R.GRID_HALF; }

/* Eine Aktion des Spielers ausführen. Wirft einen Text, wenn sie nicht erlaubt ist. */
function aktion(u, c, a, jetzt) {
  const th = R.townHall(c.grid);
  const zahlen = kosten => { if (c.coins < kosten) throw 'Zu wenig Münzen. Dir fehlen ' + Math.ceil(kosten - c.coins) + '.'; c.coins -= kosten; };
  const k = String(a.k || ''), g = c.grid && c.grid[k];
  if (a.type !== 'init' && a.type !== 'tax' && a.type !== 'law' && !c.grid) throw 'Deine Stadt wird noch eingerichtet.';

  switch (a.type) {
    case 'init': {
      // Startgebäude an Plätzen, die der Browser passend zur Landschaft gewählt hat
      if (!c.home) throw 'Wähle zuerst dein Startgebiet.';
      const plaetze = Array.isArray(a.spots) ? a.spots.map(String) : [];
      if (c.grid && Object.keys(c.grid).length) {
        // Alter Spielstand ohne Rathaus: nur das Rathaus nachrüsten
        if (Object.values(c.grid).some(x => x.type === 'rathaus')) throw 'Deine Stadt steht schon.';
        const p = plaetze.find(q => FELD.test(q) && !c.grid[q] && feldFrei(c, q, false));
        if (!p) throw 'Kein freier Platz für das Rathaus.';
        c.grid[p] = { type: 'rathaus', lvl: 1 };
        return;
      }
      if (plaetze.length < R.STARTER.length || new Set(plaetze).size !== plaetze.length || plaetze.some(q => !FELD.test(q) || !feldFrei(c, q, false))) throw 'Ungültige Startplätze.';
      const farben = Array.isArray(a.colors) ? a.colors : [];
      c.grid = {};
      R.STARTER.forEach(([type, fl], n) => {
        c.grid[plaetze[n]] = type === 'haus' ? { type, lvl: 1, floors: Array.from({ length: fl }, (_, x) => FARBE.test(farben[n * 3 + x]) ? farben[n * 3 + x] : '#F4F1EA') } : { type, lvl: 1 };
      });
      return;
    }
    case 'build': {
      const t = B[a.build];
      if (!t || a.build === 'rathaus') throw 'Unbekanntes Gebäude.';
      if (th < t.minTH) throw t.name + ' gibt es ab Rathaus-Stufe ' + t.minTH + '.';
      if (!FELD.test(k) || !imRaster(k)) throw 'Ungültiges Feld.';
      if (g) throw 'Hier steht schon etwas.';
      if (!feldFrei(c, k, t.water)) throw t.water ? 'Das muss an dein freigeschaltetes Land grenzen.' : 'Dieses Land gehört dir noch nicht.';
      zahlen(t.cost);
      c.grid[k] = a.build === 'haus' ? { type: 'haus', lvl: 1, floors: [FARBE.test(a.color) ? a.color : '#F4F1EA'] } : { type: a.build, lvl: 1 };
      return;
    }
    case 'stack': {
      if (!g || g.type !== 'haus') throw 'Hier steht kein Wohnhaus.';
      if (g.floors.length >= R.maxFloors(th)) throw g.floors.length >= 5 ? 'Höher geht es nicht.' : 'Mehr Stockwerke gibt es ab Rathaus-Stufe ' + g.floors.length + '.';
      zahlen(B.haus.cost);
      g.floors.push(FARBE.test(a.color) ? a.color : '#F4F1EA');
      return;
    }
    case 'upgrade': {
      if (!g) throw 'Hier steht kein Gebäude.';
      const t = B[g.type], lvl = g.lvl || 1;
      if (g.busyUntil) throw 'Dieses Gebäude wird schon ausgebaut.';
      if (lvl >= t.maxLvl) throw t.name + ' ist schon auf der höchsten Stufe.';
      if (g.type !== 'rathaus' && lvl >= th) throw 'Baue zuerst dein Rathaus aus.';
      if (R.busyCount(c.grid, jetzt) >= R.BUILDERS) throw 'Alle Bauarbeiter sind beschäftigt.';
      zahlen(R.upgradeCost(g.type, lvl));
      g.busyUntil = jetzt + R.upgradeTime(g.type, lvl) * 1000;
      return;
    }
    case 'rush': {
      if (!g || !g.busyUntil) throw 'Hier wird nichts ausgebaut.';
      zahlen(R.rushCost((g.busyUntil - jetzt) / 1000));
      g.busyUntil = jetzt;
      vorrechnen(u, c, jetzt);
      return;
    }
    case 'demolish': {
      if (!g) throw 'Hier steht nichts.';
      if (g.type === 'rathaus') throw 'Das Rathaus kannst du nicht abreißen.';
      let zurueck;
      if (g.type === 'haus' && g.floors.length > 1) { g.floors.pop(); zurueck = 20; }
      else { zurueck = Math.round(B[g.type].cost / 2); delete c.grid[k]; }
      c.coins += zurueck;
      return { refund: zurueck };
    }
    case 'buyLand': {
      const ch = String(a.ch || '');
      if (!GRUND.test(ch)) throw 'Ungültiges Grundstück.';
      if (R.START_CHUNKS.includes(ch) || c.unlocked.includes(ch)) throw 'Dieses Land gehört dir schon.';
      if (c.unlocked.length >= R.maxChunks(th)) throw 'Mehr Land gibt es ab der nächsten Rathaus-Stufe.';
      const [x, y] = ch.split(',').map(Number);
      const offen = q => R.START_CHUNKS.includes(q) || c.unlocked.includes(q);
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([p, q]) => offen((x + p) + ',' + (y + q)))) throw 'Kaufe nur Land, das an deine Baufläche grenzt.';
      zahlen(R.landCost(c.unlocked.length));
      c.unlocked.push(ch);
      return;
    }
    case 'tax': c.tax = Math.max(0, Math.min(30, Math.round(Number(a.value) || 0))); return;
    case 'law': if (!R.LAW_IDS.includes(a.id)) throw 'Unbekanntes Gesetz.'; c.laws = { ...c.laws, [a.id]: !!a.on }; return;
  }
  throw 'Unbekannte Aktion.';
}
function weltAnsicht() {
  const owners = {};
  for (const r in daten.regions) { const u = daten.users[daten.regions[r]]; if (u) owners[r] = u.name; }
  return { owners, players: Object.keys(daten.users).length };
}

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function senden(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function koerper(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 600000) { fail(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { fail(e); } });
  });
}
function datei(res, pfad) {
  const basis = pfad.startsWith('/shared/') ? __dirname : path.join(__dirname, 'public');
  const voll = path.normalize(path.join(basis, pfad === '/' ? '/index.html' : pfad));
  if (!voll.startsWith(basis)) return senden(res, 403, { fehler: 'Verboten' });
  fs.stat(voll, (err, st) => {
    if (err || !st.isFile()) return senden(res, 404, { fehler: 'Nicht gefunden' });
    const ext = path.extname(voll);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': /\/(assets|vendor)\//.test(pfad) ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(voll).pipe(res);
  });
}

async function api(req, res, pfad) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const b = req.method === 'GET' ? {} : await koerper(req);

  if (req.method === 'POST' && pfad === '/api/register') {
    const name = String(b.name || '').trim(), pw = String(b.password || '');
    if (!R.NAME_RE.test(name)) return senden(res, 400, { fehler: 'Der Name braucht 3 bis 20 Zeichen: Buchstaben, Zahlen, _ oder -.' });
    if (pw.length < 6 || pw.length > 200) return senden(res, 400, { fehler: 'Das Passwort braucht mindestens 6 Zeichen.' });
    const u = schluessel(name);
    if (daten.users[u]) return senden(res, 409, { fehler: 'Diesen Namen gibt es schon.' });
    if (Object.keys(daten.users).length >= MAX_SPIELER) return senden(res, 503, { fehler: 'Gerade sind alle Plätze voll.' });
    const salt = crypto.randomBytes(16).toString('hex');
    daten.users[u] = { name, salt, hash: hashPasswort(pw, salt), erstellt: Date.now() };
    stadtVon(u); geaendert = true;
    return senden(res, 200, { token: neueSitzung(u), name });
  }
  if (req.method === 'POST' && pfad === '/api/login') {
    if (gesperrt(ip)) return senden(res, 429, { fehler: 'Zu viele Versuche. Warte ein paar Minuten.' });
    const u = schluessel(String(b.name || '').trim()), nutzer = daten.users[u];
    const ok = nutzer && crypto.timingSafeEqual(Buffer.from(hashPasswort(String(b.password || ''), nutzer.salt), 'hex'), Buffer.from(nutzer.hash, 'hex'));
    if (!ok) { fehlversuch(ip); return senden(res, 401, { fehler: 'Name oder Passwort stimmt nicht.' }); }
    return senden(res, 200, { token: neueSitzung(u), name: nutzer.name });
  }
  if (req.method === 'GET' && pfad === '/api/world') return senden(res, 200, weltAnsicht());

  const s = sitzung(req);
  if (!s) return senden(res, 401, { fehler: 'Bitte melde dich an.' });
  const u = s.u, stadt = stadtVon(u);

  if (req.method === 'POST' && pfad === '/api/logout') { delete daten.sessions[s.hash]; geaendert = true; return senden(res, 200, { ok: true }); }
  if (req.method === 'GET' && pfad === '/api/me') {
    const jetzt = Date.now(), offline = vorrechnen(u, stadt, jetzt);
    geaendert = true;
    return senden(res, 200, { name: daten.users[u].name, regions: meineRegionen(u), ...stadtAnsicht(u, stadt, jetzt, { offline }) });
  }
  if (req.method === 'POST' && pfad === '/api/city/action') {
    const jetzt = Date.now();
    vorrechnen(u, stadt, jetzt);
    try {
      const extra = aktion(u, stadt, b, jetzt) || {};
      geaendert = true;
      return senden(res, 200, stadtAnsicht(u, stadt, jetzt, extra));
    } catch (e) {
      if (typeof e !== 'string') throw e;
      return senden(res, 400, { fehler: e, ...stadtAnsicht(u, stadt, jetzt) });
    }
  }
  if (req.method === 'POST' && pfad === '/api/world/start') {
    const r = WELT.byId[b.region];
    if (stadt.home) return senden(res, 409, { fehler: 'Du hast schon ein Startgebiet.' });
    if (!r) return senden(res, 400, { fehler: 'Unbekannte Region.' });
    if (r.faction) return senden(res, 400, { fehler: 'Diese Region gehört einem KI-Reich.' });
    if (daten.regions[r.id]) return senden(res, 409, { fehler: 'Diese Region gehört schon einem anderen Spieler.' });
    daten.regions[r.id] = u; stadt.home = r.id; stadt.grid = null; stadt.unlocked = []; stadt.lastTick = Date.now();
    protokoll(stadt, 'Dein Reich wird in ' + (b.label ? String(b.label).slice(0, 80) : r.id) + ' gegründet.'); geaendert = true;
    return senden(res, 200, { home: r.id, ...weltAnsicht() });
  }
  if (req.method === 'POST' && pfad === '/api/world/attack') {
    const r = WELT.byId[b.region];
    if (!r) return senden(res, 400, { fehler: 'Unbekannte Region.' });
    if (!stadt.home) return senden(res, 400, { fehler: 'Wähle zuerst dein Startgebiet.' });
    const jetzt = Date.now(); vorrechnen(u, stadt, jetzt);
    const besitzer = daten.regions[r.id];
    if (besitzer === u) return senden(res, 409, { fehler: 'Diese Region gehört dir schon.' });
    if (besitzer) return senden(res, 409, { fehler: 'Angriffe auf andere Spieler kommen bald.' });
    const meine = meineRegionen(u);
    const hafen = stadt.grid && Object.values(stadt.grid).some(g => g.type === 'hafen');
    const erreichbar = meine.some(m => r.nb.has(m)) || (hafen && meine.some(m => R.distanceKm(WELT.byId[m].centroid, r.centroid) < R.SEA_RANGE_KM * 1.05));
    if (!erreichbar) return senden(res, 400, { fehler: 'Zu weit weg. Erobere zuerst eine angrenzende Region.' });
    if (stadt.troops < r.def) return senden(res, 400, { fehler: 'Dir fehlen ' + Math.ceil(r.def - stadt.troops) + ' Truppen.' });
    const beute = R.loot(r.def);
    stadt.troops -= r.def; stadt.coins += beute; stadt.earned += beute;
    daten.regions[r.id] = u; stadt.day = (stadt.day || 1) + 1;
    protokoll(stadt, (b.label ? String(b.label).slice(0, 80) : r.id) + ' erobert. +' + beute + ' Beute'); geaendert = true;
    return senden(res, 200, { loot: beute, ...stadtAnsicht(u, stadt, jetzt), ...weltAnsicht() });
  }
  return senden(res, 404, { fehler: 'Unbekannter Pfad.' });
}

const server = http.createServer(async (req, res) => {
  const pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (pfad.startsWith('/api/')) return await api(req, res, pfad);
    if (req.method === 'GET') return datei(res, pfad);
    senden(res, 405, { fehler: 'Nicht erlaubt' });
  } catch (e) { console.error(e); senden(res, 400, { fehler: 'Ungültige Anfrage.' }); }
});

laden().then(() => server.listen(PORT, () => console.log(`Löwen-Inseln läuft auf Port ${PORT} (${WELT.count} Regionen, ${MIT_SUPABASE ? 'Supabase' : 'lokale Datei'})`)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { geaendert = true; await speichern(); process.exit(0); });
