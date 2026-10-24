/* Löwen-Inseln: Spiel-Logik (Insel in 3D, Wirtschaft, Weltkarte).
   Die Oberfläche zeichnet ui.js, den Server spricht api.js an. */
class Game {
  constructor(props) {
    this.props = props;
    // Gebäude kommen aus den gemeinsamen Regeln, dazu die drei Werkzeuge
    this.T = { auswahl: { name: 'Auswählen', cost: 0, color: '#8D9BB0', tool: true } };
    for (const id in TWRules.BUILDINGS) if (id !== 'rathaus') this.T[id] = TWRules.BUILDINGS[id];
    this.T.rathaus = TWRules.BUILDINGS.rathaus;
    this.T.land = { name: 'Land kaufen', cost: 0, color: '#C9B27A', tool: true };
    this.T.weg = { name: 'Abreißen', cost: 0, color: '#E98A7A', tool: true };
    this.LAWS = TWRules.LAWS;
    this.FACTIONS = TWRules.FACTIONS;
    this.cFaction = TWRules.COUNTRY_FACTION;
    this.HOUSE = ['#F2B5A7', '#F6D68B', '#A8D5BA', '#9CC3E6', '#D7B8E8', '#F4F1EA', '#F3C8A0'];
    this.grid = {}; this.hexCache = {}; this.unlocked = [];
    const c = props.city || {};
    this.saved = c;
    this.state = { coins: c.coins ?? TWRules.START_COINS, troops: c.troops ?? TWRules.START_TROOPS, earned: c.earned || 0, tool: 'auswahl', tab: 'regeln', tax: c.tax ?? 10, laws: c.laws || {}, msg: '', night: false,
      view: c.home ? 'insel' : 'karte', home: c.home || null, selHex: null, selTile: null, own: {}, ownV: 0,
      log: c.log && c.log.length ? c.log : [{ t: 'Tag 1', m: 'Wähle auf der Weltkarte dein Startgebiet.' }], mapReady: false, day: c.day || 1 };
    this.sync = { coins: this.state.coins, troops: this.state.troops, earned: this.state.earned, t: Date.now() };
    this.listeners = [];
  }

  /* ---------- Zustand und Neuzeichnen ---------- */
  setState(patch, cb) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    Object.assign(this.state, p);
    this.forceUpdate();
    if (cb) cb();
  }
  forceUpdate() {
    if (this.pending) return;
    this.pending = true;
    // requestAnimationFrame ruht in Hintergrund-Tabs, der Timer sorgt dann trotzdem fürs Neuzeichnen
    const run = () => { if (!this.pending) return; this.pending = false; this.listeners.forEach(f => f()); if (this.state.view === 'karte') this.drawMap(); };
    requestAnimationFrame(run); setTimeout(run, 100);
  }
  onChange(f) { this.listeners.push(f); }

  start() {
    // Der Server rechnet verbindlich. Hier wird zwischen zwei Antworten nur hochgezählt.
    this.timer = setInterval(() => this.tick(), 1000);
    this.syncTimer = setInterval(async () => { try { this.applyCity(await TWApi.me()); } catch (e) {} }, 30000);
    const off = this.props.offline;
    if (off && (off.coins > 0 || off.troops > 0) && this.saved.home) setTimeout(() => this.toast('Während du weg warst: +' + off.coins.toLocaleString('de-DE') + ' Münzen, +' + off.troops + ' Truppen'), 800);
    this.loadMap();
  }
  tick() {
    const now = Date.now(), s = this.calc(), dt = (now - this.sync.t) / 1000;
    // Fertige Ausbauten sofort zeigen, der Server übernimmt sie bei der nächsten Antwort ebenso
    for (const k in this.grid) { const g = this.grid[k]; if (g.busyUntil && g.busyUntil <= now) { g.lvl = (g.lvl || 1) + 1; delete g.busyUntil; this.build(k); this.toast(this.T[g.type].name + ' ist jetzt auf Stufe ' + g.lvl); } }
    this.setState({ coins: this.sync.coins + s.income * dt, earned: this.sync.earned + s.income * dt, troops: this.sync.troops + s.troopRate * dt });
  }
  // Antwort des Servers übernehmen: nur geänderte Felder neu bauen
  applyCity(r) {
    if (!r || !r.city) return;
    const c = r.city, before = this.grid, next = c.grid || {};
    this.sync = { coins: c.coins, troops: c.troops, earned: c.earned, t: Date.now() };
    const landChanged = JSON.stringify(c.unlocked || []) !== JSON.stringify(this.unlocked);
    this.grid = {};
    for (const k in next) this.grid[k] = { ...next[k], floors: next[k].floors ? next[k].floors.slice() : undefined };
    if (this.sc && this.terrainFor) {
      const keys = new Set(Object.keys(before).concat(Object.keys(this.grid)));
      keys.forEach(k => { if (JSON.stringify(before[k]) !== JSON.stringify(this.grid[k])) { const t = this.tiles && this.tiles[k]; if (t && this.grid[k] && (t.tree || t.deco)) { t.tree = false; t.deco = null; this.decoDirty = true; } this.build(k); } });
      if (landChanged) { this.unlocked = (c.unlocked || []).slice(); this.applyUnlocked(); this.decoDirty = true; }
      if (this.decoDirty) { this.decoDirty = false; this.drawTerrain(); }
    } else this.unlocked = (c.unlocked || []).slice();
    this.setState({ coins: c.coins, troops: c.troops, earned: c.earned, tax: c.tax, laws: c.laws || {}, log: c.log && c.log.length ? c.log : this.state.log, day: c.day || 1 });
  }
  applyUnlocked() {
    if (!this.tiles) return;
    for (const k in this.tiles) { const t = this.tiles[k]; if (!t.w) t.locked = !TWRules.START_CHUNKS.includes(this.chunkOf(k)); }
    this.unlocked.forEach(ch => this.chunkTiles(ch).forEach(q => { if (this.tiles[q] && !this.tiles[q].w) this.tiles[q].locked = false; }));
  }
  // Aktionen laufen nacheinander, damit keine verloren geht und der Server sie in Klick-Reihenfolge sieht
  act(a) {
    const run = async () => {
      try { const r = await TWApi.action(a); this.applyCity(r); return r; }
      catch (e) { this.toast(e.message); if (e.data) this.applyCity(e.data); return null; }
    };
    const p = (this.actQueue || Promise.resolve()).then(run);
    this.actQueue = p;
    return p;
  }
  rnd(s) { let v = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }
  hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }

  /* ---------- Wirtschaft ---------- */
  thLevel() { return TWRules.townHall(this.grid); }
  calc() { return TWRules.cityStats({ grid: this.grid, laws: this.state.laws, tax: this.state.tax }, this.regionIncome()); }
  regionIncome() { let s = 0; const o = this.state.own; if (!this.rById) return 0; for (const k in o) if (o[k] === 'me') { const h = this.rById[k]; if (h) s += h.yield; } return s; }
  buildingInfo(id, lvl) {
    const t = this.T[id], m = TWRules.lvlMult(lvl || 1), f = x => (Math.round(x * 10) / 10).toLocaleString('de-DE'), out = [];
    if (id === 'haus') return '+4 Bewohner je Stockwerk';
    if (t.inc) out.push('+' + f(t.inc * m) + '/s');
    if (t.troops) out.push('+' + f(t.troops * m) + ' Truppen/s');
    if (t.hap) out.push((t.hap > 0 ? '+' : '') + f(t.hap * (1 + 0.3 * ((lvl || 1) - 1))) + ' Zufr.');
    if (t.jobs) out.push(Math.round(t.jobs * (1 + 0.5 * ((lvl || 1) - 1))) + ' Jobs');
    if (t.water) out.push('aufs Wasser');
    return out.join(' · ') || 'Deko';
  }
  level() { const e = this.state.earned; const lv = Math.floor(Math.sqrt(e / 150)) + 1; const a = Math.pow(lv - 1, 2) * 150, b = Math.pow(lv, 2) * 150; return { lv, pct: (e - a) / (b - a) }; }
  toast(m) { clearTimeout(this.mt); this.setState({ msg: m }); this.mt = setTimeout(() => this.setState({ msg: '' }), 2200); }

  /* ---------- Weltkarte ---------- */
  async loadMap() {
    if (!window.d3 || !window.topojson) { setTimeout(() => this.loadMap(), 120); return; }
    try {
      const topo = await (await fetch('/assets/world.json')).json();
      const d3 = window.d3;
      let dn = null; try { dn = new Intl.DisplayNames(['de'], { type: 'region' }); } catch (e) {}
      const cg = topo.objects.countries.geometries, rg = topo.objects.regions.geometries;
      const cf = topojson.feature(topo, topo.objects.countries).features;
      const rf = topojson.feature(topo, topo.objects.regions).features;
      const nb = topojson.neighbors(rg);
      const fix = f => { if (f.geometry && d3.geoArea(f) > 2 * Math.PI) { const g = f.geometry, rw = p => p.map(r => r.slice().reverse());
        g.coordinates = g.type === 'Polygon' ? rw(g.coordinates) : g.coordinates.map(rw); } return f; };
      rf.forEach(fix); cf.forEach(fix);
      this.topo = topo; this.cNames = {};
      cf.forEach(f => { const p = f.properties; let n = p.admin; if (dn && p.iso_a2 && /^[A-Z]{2}$/.test(p.iso_a2)) { try { n = dn.of(p.iso_a2) || n; } catch (e) {} } this.cNames[p.adm0_a3] = n; });
      this.cFeats = cf.filter(f => f.properties.adm0_a3 !== 'ATA');
      this.regions = []; this.rById = {}; this.rByCountry = {};
      rf.forEach((f, i) => {
        const p = f.properties; if (p.adm0_a3 === 'ATA') return;
        const id = 'r' + i, fac = this.cFaction[p.adm0_a3] || null;
        const r = { id, i, f, cc: p.adm0_a3, name: p.name_de || p.name || 'Unbenannt', country: this.cNames[p.adm0_a3] || p.admin, faction: fac, centroid: d3.geoCentroid(f),
          ...TWRules.regionStats(i, fac) };
        this.regions.push(r); this.rById[id] = r; (this.rByCountry[r.cc] = this.rByCountry[r.cc] || []).push(r);
      });
      this.regions.forEach(r => r.nb = nb[r.i].map(j => this.rById['r' + j]).filter(Boolean).map(x => x.id));
      this.applyWorld(this.props.world);
      this.setState({ mapReady: true });
      if (this.state.home && this.sc) this.buildTerrain(this.saved);
      this.worldTimer = setInterval(async () => { try { this.applyWorld(await TWApi.world()); } catch (e) {} }, 15000);
    } catch (e) { this.toast('Weltkarte konnte nicht geladen werden'); }
  }
  // Besitzverhältnisse vom Server: eigene Regionen sind 'me', fremde 'p:Name'
  applyWorld(w) {
    if (!w || !w.owners) return;
    const own = {}, me = this.props.name;
    for (const r in w.owners) own[r] = w.owners[r] === me ? 'me' : 'p:' + w.owners[r];
    this.players = w.players;
    this.setState(st => ({ own, ownV: st.ownV + 1 }));
  }
  playerColor(name) { const h = this.hash(name) % 360; return 'hsl(' + h + ', 45%, 62%)'; }
  ownerName(o) { return o === 'me' ? 'Dir' : o === 'neutral' ? 'Niemandem' : o.startsWith('p:') ? o.slice(2) : 'dem ' + this.FACTIONS[o].name; }
  hexByKey(k) { return this.rById && this.rById[k]; }
  ownerOf(id) { const o = this.state.own[id]; if (o) return o; const r = this.rById[id]; return r && r.faction ? r.faction : 'neutral'; }
  myIds() { const o = this.state.own; return Object.keys(o).filter(k => o[k] === 'me'); }
  reachable() {
    const mine = this.myIds(), set = {};
    const hafen = Object.values(this.grid).some(c => c.type === 'hafen');
    const d3 = window.d3;
    mine.forEach(id => {
      const r = this.rById[id];
      r.nb.forEach(n => set[n] = 1);
      if (hafen) this.regions.forEach(x => { if (!set[x.id] && d3.geoDistance(r.centroid, x.centroid) * 6371 < 900) set[x.id] = 1; });
    });
    mine.forEach(id => delete set[id]);
    return set;
  }
  attackCheck(r) {
    if (this.ownerOf(r.id) === 'me') return { ok: false, why: 'Diese Region gehört bereits dir.' };
    if (this.ownerOf(r.id).startsWith('p:')) return { ok: false, why: 'Hier herrscht ' + this.ownerOf(r.id).slice(2) + '. Angriffe auf andere Spieler kommen bald.' };
    if (!this.reach[r.id]) return { ok: false, why: 'Zu weit weg. Erobere zuerst eine angrenzende Region' + (Object.values(this.grid).some(c => c.type === 'hafen') ? '.' : ' oder baue einen Hafen für Seewege.') };
    if (this.state.troops < r.def) return { ok: false, why: 'Dir fehlen ' + Math.ceil(r.def - this.state.troops) + ' Truppen. Baue Kasernen auf deiner Insel.' };
    return { ok: true };
  }
  async startHere() {
    const r = this.rById[this.state.selHex]; if (!r || r.faction || this.busy) return;
    this.busy = true;
    try {
      const w = await TWApi.start(r.id, r.name + " (" + r.country + ")");
      this.applyWorld(w);
      this.saved = { home: r.id };
      this.setState({ home: r.id, view: "insel" }, () => this.buildTerrain());
      this.toast("Willkommen in " + r.name + "!");
    } catch (e) { this.toast(e.message); try { this.applyWorld(await TWApi.world()); } catch (x) {} }
    this.busy = false;
  }
  async doAttack() {
    const r = this.rById[this.state.selHex]; if (!r || this.busy) return;
    const chk = this.attackCheck(r); if (!chk.ok) { this.toast(chk.why); return; }
    this.busy = true;
    try {
      const res = await TWApi.attack(r.id, r.name + " (" + r.country + ")");
      this.applyWorld(res);
      this.applyCity(res);
      this.toast(r.name + " erobert! +" + res.loot + " Beute");
    } catch (e) { this.toast(e.message); }
    this.busy = false;
  }
  colorOf(owner) { return owner === 'me' ? '#E9C46A' : owner === 'neutral' ? '#2B3B57' : owner.startsWith('p:') ? this.playerColor(owner.slice(2)) : this.FACTIONS[owner].color; }
  zoomBy(k) { if (this.svg) this.svg.transition().duration(350).call(this.zoom.scaleBy, k); }
  zoomTo(id) {
    const r = this.rById[id]; if (!r || !this.svg) return;
    const [[x0, y0], [x1, y1]] = this.gpath.bounds(r.f);
    const k = Math.max(1, Math.min(60, 0.35 / Math.max((x1 - x0) / 990, (y1 - y0) / 736)));
    const t = window.d3.zoomIdentity.translate(495, 368).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.svg.transition().duration(700).call(this.zoom.transform, t);
  }
  drawMap() {
    const host = this.mapEl, d3 = window.d3, st = this.state;
    if (!host || !d3 || !st.mapReady) return;
    if (!this.svg) {
      const svg = this.svg = d3.select(host).append('svg').attr('viewBox', '0 0 990 736').attr('preserveAspectRatio', 'xMidYMid meet')
        .style('width', '100%').style('height', '100%').style('display', 'block').attr('role', 'img').attr('aria-label', 'Weltkarte');
      svg.append('rect').attr('width', 990).attr('height', 736).attr('fill', '#0E1A2B');
      const g = this.gz = svg.append('g');
      const proj = d3.geoNaturalEarth1().fitExtent([[10, 20], [980, 716]], { type: 'FeatureCollection', features: this.cFeats });
      const path = this.gpath = d3.geoPath(proj);
      g.append('path').datum(d3.geoGraticule10()).attr('d', path).attr('fill', 'none').attr('stroke', '#16263D').attr('stroke-width', 0.6).attr('vector-effect', 'non-scaling-stroke');
      this.rSel = g.append('g').selectAll('path').data(this.regions).join('path')
        .attr('d', r => path(r.f)).attr('class', 'land').attr('vector-effect', 'non-scaling-stroke')
        .on('click', (e, r) => this.setState({ selHex: r.id }))
        .on('mouseenter', (e, r) => { const o = this.ownerOf(r.id); this.hoverLabel = r.name + ' · ' + r.country + (o === 'me' ? ' · dein Reich' : o.startsWith('p:') ? ' · ' + o.slice(2) : ''); this.forceUpdate(); });
      g.append('path').datum({ type: 'FeatureCollection', features: this.cFeats }).attr('d', path).attr('fill', 'none')
        .attr('stroke', '#0A111D').attr('stroke-width', 1.4).attr('vector-effect', 'non-scaling-stroke').style('pointer-events', 'none');
      this.selPath = g.append('path').attr('fill', 'none').attr('stroke', '#FFFFFF').attr('stroke-width', 2.5).attr('vector-effect', 'non-scaling-stroke').style('pointer-events', 'none');
      this.zoom = d3.zoom().scaleExtent([1, 80]).translateExtent([[-200, -200], [1190, 936]]).on('zoom', (e) => g.attr('transform', e.transform));
      svg.call(this.zoom).on('dblclick.zoom', null);
      this.svg.transition().duration(0).call(this.zoom.transform, d3.zoomIdentity.translate(495, 368).scale(5).translate(-path.centroid(this.rByCountry.DEU[0].f)[0], -path.centroid(this.rByCountry.DEU[0].f)[1]));
    }
    const sig = st.ownV + '|' + st.selHex + '|' + Object.keys(this.grid).length + '|' + Math.floor(st.troops);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.reach = this.reachable();
    const canAff = r => this.reach[r.id] && st.troops >= 0;
    this.rSel.attr('fill', r => this.colorOf(this.ownerOf(r.id)))
      .attr('stroke', r => canAff(r) ? '#F4D98B' : '#0E1A2B')
      .attr('stroke-width', r => canAff(r) ? 1.4 : 0.4)
      .attr('class', r => 'land' + (canAff(r) ? ' can' : ''));
    const s = st.selHex && this.rById[st.selHex];
    this.selPath.attr('d', s ? this.gpath(s.f) : null);
  }
  /* ---------- Insel (3D) ---------- */
  initScene(el) {
    const THREE = window.THREE;
    if (!THREE) { setTimeout(() => this.initScene(el), 100); return; }
    const W = el.clientWidth || 730, H = el.clientHeight || 728;
    const sc = this.sc = new THREE.Scene();
    sc.background = new THREE.Color('#BFE3EF'); sc.fog = new THREE.Fog('#BFE3EF', 70, 230);
    const cam = this.cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 300);
    const r = this.r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(W, H);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(r.domElement);
    this.hemi = new THREE.HemisphereLight('#FFF6E8', '#5B8FA8', 0.8); sc.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight('#FFF1D6', 0.85);
    sun.position.set(22, 34, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); sc.add(sun);
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#7CC4D4', roughness: 0.3, metalness: 0.1 });
    const water = this.water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.waterMat);
    water.rotation.x = -Math.PI / 2; water.receiveShadow = true; sc.add(water);
    this.world = new THREE.Group(); sc.add(this.world);
    this.meshes = {}; this.mats = {};
    const ghost = this.ghost = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 2), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.45 }));
    ghost.visible = false; sc.add(ghost);
    this.gulls = [];
    for (let i = 0; i < 4; i++) { const g = new THREE.Group(); const m = this.M('#FFFFFF');
      const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.25), m); w1.position.x = -0.45;
      const w2 = w1.clone(); w2.position.x = 0.45; g.add(w1, w2); g.userData = { a: i * 1.6, rad: 10 + i * 3, h: 9 + i, w1, w2 }; sc.add(g); this.gulls.push(g); }
    this.th = 0.8; this.ph = 0.85; this.dist = 38;
    this.buildTerrain(this.rById ? this.saved : undefined);
    const cv = r.domElement; let drag = false, moved = 0, px = 0, py = 0;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => { drag = true; moved = 0; px = e.clientX; py = e.clientY; });
    cv.addEventListener('pointerup', e => { if (drag && moved < 6) this.click(e); drag = false; });
    cv.addEventListener('pointerleave', () => { drag = false; ghost.visible = false; });
    cv.addEventListener('pointermove', e => {
      if (drag) { const dx = e.clientX - px, dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
        if (moved >= 6) { this.th -= dx * 0.008; this.ph = Math.max(0.3, Math.min(1.35, this.ph + dy * 0.008)); this.camUpd(); }
        px = e.clientX; py = e.clientY; }
      this.hover(e);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.dist = Math.max(16, Math.min(150, this.dist + e.deltaY * 0.03)); this.camUpd(); }, { passive: false });
    this.ray = new THREE.Raycaster();
    this.loadModels();
    this.ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); });
    this.ro.observe(el);
    const loop = (t) => {
      t = t || 0;
      if (this.state.view === 'insel') {
        this.waterMat.color.setHSL(0.53, 0.45, (this.state.night ? 0.32 : 0.63) + Math.sin(t / 1600) * 0.015);
        this.gulls.forEach(g => { const u = g.userData; u.a += 0.004; g.position.set(Math.cos(u.a) * u.rad, u.h + Math.sin(t / 700 + u.a) * 0.4, Math.sin(u.a) * u.rad); g.rotation.y = -u.a; const f = Math.sin(t / 120 + u.a * 3) * 0.5; u.w1.rotation.z = 0.3 + f; u.w2.rotation.z = -0.3 - f; });
        this.world.children.forEach(o => { if (o.userData.boat) o.userData.boat.position.y = 0.15 + Math.sin(t / 500) * 0.08; });
        this.animLife(t);
        r.render(sc, cam);
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  regionTraits(home) {
    const d3 = window.d3, tr = { coast: 0, seaDir: [0, 1], mountain: false, desert: false, lat: 0, seed: 7 };
    if (!home) { tr.coast = 1; return tr; }
    tr.lat = home.centroid[1]; tr.seed = home.i * 1.37 + 11;
    const DESERT = ['EGY', 'LBY', 'DZA', 'TUN', 'MAR', 'SAU', 'ARE', 'OMN', 'YEM', 'IRQ', 'JOR', 'KWT', 'QAT', 'MRT', 'MLI', 'NER', 'TCD', 'SDN', 'ESH', 'ISR', 'IRN', 'TKM'];
    const MC = ['CHE', 'AUT', 'NPL', 'BTN', 'AND', 'LIE', 'KGZ', 'TJK', 'AFG', 'BOL', 'PER'];
    const MR = ['Bayern', 'Tirol', 'Salzburg', 'Vorarlberg', 'Kärnten', 'Colorado', 'Wyoming', 'Montana', 'Utah', 'Idaho', 'Aostatal', 'Trentino-Südtirol', 'Bozen', 'Trient', 'Savoie', 'Haute-Savoie', 'Hautes-Alpes', 'Tibet', 'Himachal Pradesh', 'Uttarakhand', 'Sikkim', 'British Columbia', 'Alaska', 'Baden-Württemberg', 'Aragón', 'Asturias', 'Navarra'];
    tr.desert = DESERT.includes(home.cc);
    tr.mountain = MC.includes(home.cc) || MR.includes(home.name);
    try {
      const geom = this.topo.objects.regions.geometries[home.i];
      const coastM = topojson.mesh(this.topo, this.topo.objects.regions, (a, b) => a === b && a === geom);
      const allM = topojson.mesh(this.topo, this.topo.objects.regions, (a, b) => a === geom || b === geom);
      const cl = d3.geoLength(coastM), al = d3.geoLength(allM) || 1;
      tr.coast = Math.min(1, cl / al);
      if (cl > 0) {
        let sx = 0, sy = 0, n = 0;
        coastM.coordinates.forEach(line => line.forEach(([lo, la]) => { sx += lo - home.centroid[0]; sy += la - home.centroid[1]; n++; }));
        const len = Math.hypot(sx, sy) || 1; tr.seaDir = [sx / len, -sy / len];
      }
    } catch (e) {}
    return tr;
  }
  noise(x, y, s) {
    const h = (a, b) => this.rnd(a * 157.31 + b * 311.7 + s * 71.9);
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  buildTerrain(saved) {
    const T = window.THREE; if (!T || !this.sc) return;
    Object.keys(this.meshes).forEach(k => { this.world.remove(this.meshes[k]); delete this.meshes[k]; });
    this.grid = {};
    const home = this.state.home && this.rById && this.rById[this.state.home];
    const tr = this.traits = this.regionTraits(home);
    const N = 48, H = N / 2, CH = 6, S = tr.seed;
    this.half = H; this.CH = CH; this.tiles = {};
    const lat = Math.abs(tr.lat);
    this.biome = tr.desert ? { grass: '#E3C98F', grass2: '#D9BA78', beach: '#F0DDB0', rock: '#C79A62', tree: '#7FA35A' }
      : lat > 62 ? { grass: '#E6EDF0', grass2: '#D3DEE4', beach: '#C9D3D8', rock: '#8E9AA3', tree: '#3F6B4E' }
      : lat < 18 ? { grass: '#6DBE5A', grass2: '#5CAE4C', beach: '#F2E2A8', rock: '#8C8A80', tree: '#2F7A3A' }
      : { grass: '#8CC57A', grass2: '#7DB86C', beach: '#E8D39A', rock: '#9C968A', tree: '#3D7F45' };
    const island = tr.coast > 0.85, river = !tr.desert && this.rnd(S + 4) > 0.3;
    const rAng = this.rnd(S + 5) * Math.PI, rOff = (this.rnd(S + 6) - 0.5) * 10;
    const mAng = this.rnd(S + 8) * Math.PI * 2;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = (i - H + 0.5) / H, y = (j - H + 0.5) / H, k = (i - H) + ',' + (j - H);
      const n1 = this.noise(i / 9, j / 9, S), n2 = this.noise(i / 4, j / 4, S + 3);
      const inStart = Math.abs(i - H + 0.5) < 6.5 && Math.abs(j - H + 0.5) < 6.5;
      let water = false;
      if (island) water = Math.hypot(x, y) > 0.72 + (n1 - 0.5) * 0.35;
      else if (tr.coast > 0.02) { const sAmt = Math.min(0.75, 0.25 + tr.coast * 0.9); water = x * tr.seaDir[0] + y * tr.seaDir[1] > 1.05 - sAmt + (n1 - 0.5) * 0.4; }
      if (river && !water) {
        const px = (i - H) * Math.cos(rAng) + (j - H) * Math.sin(rAng), py = -(i - H) * Math.sin(rAng) + (j - H) * Math.cos(rAng);
        if (Math.abs(py - rOff - Math.sin(px / 5 + S) * 3.2) < 0.75) water = true;
      }
      if (tr.desert && !water && n2 > 0.86 && n1 > 0.6 && !inStart) water = true;
      if (water) { this.tiles[k] = { w: true }; continue; }
      let h = Math.floor(n1 * (tr.desert ? 1.6 : 2.6) + n2 * 0.6);
      if (tr.mountain) { const m = Math.max(0, x * Math.cos(mAng) + y * Math.sin(mAng)); h += Math.floor(m * m * 9 * (0.6 + n2 * 0.6)); }
      if (inStart) h = Math.min(h, 1);
      const treeType = tr.desert ? 'saguaro_cactus' : lat < 18 ? 'palm_tree' : (lat > 55 || h >= 3 || n1 > 0.62) ? 'pine_tree' : 'apple_tree';
      const tree = !inStart && n2 > (tr.desert ? 0.74 : 0.6) && h < 5 && this.rnd(i * 3.1 + j * 7.7 + S) > 0.35;
      const deco = tree || inStart ? null : (h >= 3 && this.rnd(i * 1.7 + j * 2.9 + S) > 0.72) ? 'rock_set' : this.rnd(i * 2.3 + j * 1.1 + S) > 0.93 ? 'bush_wildflowers' : null;
      this.tiles[k] = { w: false, h, locked: !inStart, tree, treeType, deco };
    }
    for (const k in this.tiles) { const t = this.tiles[k]; if (t.w) continue; const [i, j] = k.split(',').map(Number);
      t.coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const o = this.tiles[(i + a) + ',' + (j + b)]; return o && o.w; });
      if (t.coast && !t.tree && !t.deco && t.h <= 1) { const r = this.rnd(i * 4.7 + j * 3.3 + S); if (r > 0.88 && !tr.desert) t.deco = 'reeds_lily_pads'; else if (r > 0.8 && t.locked) t.deco = 'beach_set'; } }
    // Gespeicherten Stand übernehmen: gekaufte Grundstücke und Gebäude
    const restore = saved && home && saved.home === home.id && saved.grid && Object.keys(saved.grid).length;
    this.unlocked = restore ? (saved.unlocked || []).slice() : [];
    this.applyUnlocked();
    if (restore) for (const k in saved.grid) if (this.T[saved.grid[k].type]) {
      this.grid[k] = { ...saved.grid[k], floors: saved.grid[k].floors ? saved.grid[k].floors.slice() : undefined };
      const t = this.tiles[k]; if (t) { t.tree = false; t.deco = null; }
    }
    if (!home) [["haus", 2], ["haus", 1], ["markt"], ["park"], ["haus", 3], ["haus", 1], ["rathaus"]].forEach(([t, fl], n) => {
      const k = this.freeSpots()[0]; if (k) this.grid[k] = { type: t, lvl: 1, floors: t === "haus" ? Array.from({ length: fl }, (_, x) => this.HOUSE[(x + n * 3) % this.HOUSE.length]) : undefined }; });
    this.drawTerrain();
    Object.keys(this.grid).forEach(k => this.build(k));
    this.terrainFor = home ? home.id : null;
    this.dist = 58; this.camUpd(); this.spawnLife();
    // Neue Stadt oder alter Spielstand ohne Rathaus: Startgebäude beim Server anlegen
    if (home && !Object.values(this.grid).some(g => g.type === "rathaus")) {
      const colors = Array.from({ length: 21 }, (_, n) => this.HOUSE[(n * 5 + 1) % this.HOUSE.length]);
      this.act({ type: "init", spots: this.freeSpots().slice(0, 12), colors });
    }
    this.forceUpdate();
  }
  // Freie, ebene Felder der Baufläche, die mittleren zuerst
  freeSpots() {
    return Object.keys(this.tiles).filter(k => { const t = this.tiles[k]; return !t.w && !t.locked && !this.grid[k] && t.h <= 1; })
      .sort((a, b) => { const p = a.split(",").map(Number), q = b.split(",").map(Number); return Math.hypot(p[0] + 0.5, p[1] + 0.5) - Math.hypot(q[0] + 0.5, q[1] + 0.5); });
  }
  top(k) { const t = this.tiles && this.tiles[k]; return t && !t.w ? 0.35 + t.h * 0.6 : 0.35; }
  drawTerrain() {
    const T = window.THREE, B = this.biome;
    if (this.terrain) { this.sc.remove(this.terrain); this.terrain.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); }
    const land = [], trees = [];
    for (const k in this.tiles) { const t = this.tiles[k]; if (t.w) continue; const [i, j] = k.split(',').map(Number); land.push({ i, j, t }); if (t.tree && !this.grid[k]) trees.push({ i, j, t }); }
    const grp = this.terrain = new T.Group(), o = new T.Object3D(), c = new T.Color(), grey = new T.Color('#5E6873');
    const lm = new T.InstancedMesh(new T.BoxGeometry(2.2, 1, 2.2), new T.MeshStandardMaterial({ roughness: 0.9 }), land.length);
    lm.receiveShadow = true; lm.castShadow = true;
    land.forEach((L, n) => { const h = 1.2 + L.t.h * 0.6, topY = 0.35 + L.t.h * 0.6;
      o.position.set(L.i * 2.2, topY - h / 2, L.j * 2.2); o.scale.set(1, h, 1); o.updateMatrix(); lm.setMatrixAt(n, o.matrix);
      const col = L.t.h >= 6 && this.traits.mountain ? '#F4F6F8' : L.t.h >= 4 ? B.rock : (L.t.coast && L.t.h <= 1) ? B.beach : ((L.i + L.j) % 2 ? B.grass : B.grass2);
      c.set(col); c.offsetHSL(0, 0, (this.rnd(L.i * 13 + L.j * 7) - 0.5) * 0.05);
      if (L.t.locked) c.lerp(grey, 0.38);
      lm.setColorAt(n, c); });
    grp.add(lm);
    if (this.models) {
      const by = {};
      for (const k in this.tiles) { const t = this.tiles[k]; if (t.w || this.grid[k]) continue; const [i, j] = k.split(',').map(Number), y = 0.35 + t.h * 0.6, dim = t.locked;
        if (t.tree) (by[t.treeType] = by[t.treeType] || []).push({ x: i * 2.2 + (this.rnd(i * 5 + j) - 0.5) * 0.5, y, z: j * 2.2 + (this.rnd(i + j * 5) - 0.5) * 0.5, r: this.rnd(i * 7 + j * 3) * 6.28, s: 0.85 + this.rnd(i * 3 + j) * 0.35, dim });
        if (t.deco) (by[t.deco] = by[t.deco] || []).push({ x: i * 2.2, y, z: j * 2.2, r: this.rnd(i * 11 + j) * 6.28, s: 1, dim }); }
      const FIT = { pine_tree: 1.5, apple_tree: 1.9, palm_tree: 2.1, saguaro_cactus: 1.3, rock_set: 1.6, bush_wildflowers: 1.6, beach_set: 2.0, reeds_lily_pads: 1.8 };
      Object.keys(by).forEach(n => { const gI = this.instanced(n, by[n], FIT[n]); if (gI) { gI.traverse(o => o.userData.shared = true); grp.add(gI); } });
    } else if (trees.length) {
      const tm = new T.InstancedMesh(new T.ConeGeometry(0.55, 1.6, 7), new T.MeshStandardMaterial({ roughness: 0.8 }), trees.length * 2);
      tm.castShadow = true;
      trees.forEach((L, n) => { const topY = 0.35 + L.t.h * 0.6;
        [[-0.4, -0.3, 1], [0.45, 0.35, 0.8]].forEach(([dx, dz, s], m) => { o.position.set(L.i * 2.2 + dx, topY + 0.8 * s, L.j * 2.2 + dz); o.scale.set(s, s, s); o.updateMatrix(); tm.setMatrixAt(n * 2 + m, o.matrix);
          c.set(this.biome.tree); if (L.t.locked) c.lerp(grey, 0.3); tm.setColorAt(n * 2 + m, c); }); });
      grp.add(tm);
    }
    const lk = Object.keys(this.tiles).filter(k => !this.tiles[k].w && this.tiles[k].locked).length;
    this.sc.add(grp); this.lockedCount = lk;
  }
  chunkOf(k) { const [i, j] = k.split(',').map(Number); return Math.floor((i + this.half) / this.CH) + ',' + Math.floor((j + this.half) / this.CH); }
  chunkTiles(ch) { const [a, b] = ch.split(',').map(Number), out = []; for (let i = 0; i < this.CH; i++) for (let j = 0; j < this.CH; j++) out.push((a * this.CH + i - this.half) + ',' + (b * this.CH + j - this.half)); return out; }
  landCost() { return TWRules.landCost(this.unlocked.length); }
  buyLand(k) {
    const t = this.tiles[k];
    if (!t || t.w) { this.toast("Wähle ein Stück Land am Rand deiner Baufläche"); return; }
    if (!t.locked) { this.toast("Dieses Land gehört dir schon"); return; }
    if (this.unlocked.length >= TWRules.maxChunks(this.thLevel())) { this.toast("Mehr Land gibt es ab der nächsten Rathaus-Stufe"); return; }
    const ch = this.chunkOf(k), [a, b] = ch.split(",").map(Number);
    const open = q => TWRules.START_CHUNKS.includes(q) || this.unlocked.includes(q);
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, y]) => open((a + x) + "," + (b + y)))) { this.toast("Kaufe nur Land, das an deine Baufläche grenzt"); return; }
    if (this.state.coins < this.landCost()) { this.toast("Zu wenig Münzen. Das Grundstück kostet " + this.landCost() + "."); return; }
    this.act({ type: "buyLand", ch }).then(r => { if (r) this.toast("Neues Grundstück gekauft"); });
  }
  camUpd() { const d = this.dist; this.cam.position.set(Math.sin(this.th) * Math.cos(this.ph) * d, Math.sin(this.ph) * d, Math.cos(this.th) * Math.cos(this.ph) * d); this.cam.lookAt(0, 1.5, 0); }
  M(c) { const T = window.THREE; return this.mats[c] || (this.mats[c] = new T.MeshStandardMaterial({ color: c, roughness: 0.85 })); }
  B(w, h, d, c, x, y, z) { const T = window.THREE; const o = new T.Mesh(new T.BoxGeometry(w, h, d), this.M(c)); o.castShadow = o.receiveShadow = true; o.position.set(x || 0, y || 0, z || 0); return o; }
  C(rt, rb, h, c, x, y, z, seg) { const T = window.THREE; const o = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 16), this.M(c)); o.castShadow = o.receiveShadow = true; o.position.set(x || 0, y || 0, z || 0); return o; }
  S(rad, c, x, y, z) { const T = window.THREE; const o = new T.Mesh(new T.SphereGeometry(rad, 14, 10), this.M(c)); o.castShadow = true; o.position.set(x, y, z); return o; }
  roof(c, rot) { const T = window.THREE; const s = new T.Shape(); s.moveTo(-1.1, 0); s.lineTo(0, 0.9); s.lineTo(1.1, 0); s.lineTo(-1.1, 0);
    const o = new T.Mesh(new T.ExtrudeGeometry(s, { depth: 2.15, bevelEnabled: false }), this.M(c)); o.position.z = -1.075; o.castShadow = true; const g = new T.Group(); g.add(o); g.rotation.y = rot; return g; }
  windows(g, y, skipFront) {
    [[0, 1.01, 0], [0, -1.01, Math.PI], [1.01, 0, Math.PI / 2], [-1.01, 0, -Math.PI / 2]].forEach(([x, z, ry], n) => {
      if (n === 0 && skipFront) return;
      [-0.45, 0.45].forEach(off => { const f = this.B(0.4, 0.55, 0.06, '#FFFFFF'); const w = this.B(0.3, 0.45, 0.08, this.state.night ? '#FFD76A' : '#3D4F63');
        const ox = n < 2 ? off : 0, oz = n < 2 ? 0 : off; f.position.set(x + ox, y, z + oz); w.position.copy(f.position); f.rotation.y = w.rotation.y = ry; g.add(f, w); });
    });
  }
  build(k) {
    const T = window.THREE; if (!T || !this.world) return;
    if (this.meshes[k]) { this.world.remove(this.meshes[k]); delete this.meshes[k]; }
    const c = this.grid[k]; if (!c) return;
    const [i, j] = k.split(',').map(Number); const g = new T.Group(); g.position.set(i * 2.2, c.type === 'hafen' ? 0 : this.top(k) - 0.35, j * 2.2); g.userData.key = k;
    const MB = { markt: 'market_hall', werk: 'craftsman_workshop', hafen: 'harbor_pier', kaserne: 'barracks_fort', park: 'city_park', turm: 'lighthouse', baeckerei: 'bakery', rathaus: 'town_hall', kirche: 'village_church', muehle: 'dutch_windmill', farm: 'farm_tile', brunnen: 'lion_fountain', wachturm: 'watchtower', monument: 'lion_monument', banner: 'standing_banner', pflaster: 'cobblestone_tile', bruecke: 'stone_bridge' };
    if (this.models) {
      const water = c.type === 'hafen' || c.type === 'bruecke';
      g.position.y = water ? 0 : this.top(k);
      const rot = (this.hash(k) % 4) * Math.PI / 2;
      if (c.type === 'haus') {
        let y = 0;
        c.floors.forEach((col, h) => { const m = this.model(h === 0 ? 'townhouse_ground_floor' : 'townhouse_middle_floor', { scale: 0.68, tint: col, rot }); if (!m) return; m.position.y = y; g.add(m); y += this.floorH; });
        const rf = this.model('townhouse_gabled_roof', { scale: 0.68, rot }); if (rf) { rf.position.y = y; g.add(rf); }
      } else if (MB[c.type]) {
        let r2 = rot;
        if (c.type === 'bruecke') { const e = this.tiles[(i + 1) + ',' + j], w = this.tiles[(i - 1) + ',' + j]; r2 = (e && !e.w) || (w && !w.w) ? 0 : Math.PI / 2; }
        const m = this.model(MB[c.type], { fit: c.type === 'banner' ? 1.1 : c.type === 'pflaster' ? 2.2 : c.type === 'bruecke' ? 2.6 : 2.1, rot: r2 });
        if (m) g.add(m);
        if (c.type === 'turm' && this.state.night) { const l = new T.PointLight('#FFD76A', 1.2, 14); l.position.set(0, 3.6, 0); g.add(l); }
      }
      const lv = c.lvl || 1;
      if (lv > 1 && c.type !== "haus") g.children.forEach(m => m.scale.multiplyScalar(1 + 0.07 * (lv - 1)));
      if (c.busyUntil) this.scaffold(g);
      if (this.state.selTile === k) this.selMarker(g);
      this.world.add(g); this.meshes[k] = g; return;
    }
    if (c.type !== 'hafen') g.add(this.B(2.2, 0.6, 2.2, '#DCD3C2', 0, 0.05, 0));
    const top = 0.35;
    if (c.type === 'haus') {
      c.floors.forEach((col, h) => { const y = top + h * 1.6 + 0.8; const f = new T.Group(); f.position.y = y; f.add(this.B(2, 1.6, 2, col));
        if (h === 0) { f.add(this.B(0.55, 0.95, 0.08, '#7A5A44', 0, -0.32, 1.02)); this.windows(f, 0.15, true); } else this.windows(f, 0.1);
        g.add(f); });
      const ry = (i + j) % 2 ? Math.PI / 2 : 0; const rf = this.roof('#C9604F', ry); rf.position.y = top + c.floors.length * 1.6; g.add(rf);
      g.add(this.B(0.28, 0.7, 0.28, '#B5523F', 0.5, top + c.floors.length * 1.6 + 0.7, 0.45));
    } else if (c.type === 'markt') {
      g.add(this.B(1.9, 1.1, 1.9, '#F6D68B', 0, top + 0.55, 0));
      for (let s = 0; s < 5; s++) g.add(this.B(0.4, 0.08, 2.3, s % 2 ? '#FFFFFF' : '#E8735A', -0.8 + s * 0.4, top + 1.25, 0.15));
      g.add(this.B(1.6, 0.5, 0.5, '#B98A5A', 0, top + 0.25, 1.15));
      [['#E8735A', -0.5], ['#A8D5BA', 0], ['#F6D68B', 0.5]].forEach(([cc, x]) => g.add(this.S(0.15, cc, x, top + 0.6, 1.15)));
    } else if (c.type === 'werk') {
      g.add(this.B(2, 1.5, 2, '#9CB4C8', 0, top + 0.75, 0));
      for (let s = 0; s < 3; s++) { const rf = this.roof('#6F8AA3', Math.PI / 2); rf.scale.set(0.9, 0.5, 0.31); rf.position.set(0, top + 1.5, -0.66 + s * 0.66); g.add(rf); }
      g.add(this.C(0.2, 0.25, 2, '#8A4B3A', 0.6, top + 2.2, 0.6));
      g.add(this.B(0.7, 0.9, 0.08, '#5E6873', 0, top + 0.45, 1.02));
    } else if (c.type === 'kaserne') {
      g.add(this.B(2, 1.2, 2, '#B07A6A', 0, top + 0.6, 0));
      [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]].forEach(([x, z]) => { g.add(this.B(0.45, 1.9, 0.45, '#9A6656', x, top + 0.95, z)); g.add(this.B(0.55, 0.15, 0.55, '#7E5045', x, top + 1.95, z)); });
      for (let s = 0; s < 4; s++) { g.add(this.B(0.22, 0.22, 0.22, '#9A6656', -0.6 + s * 0.4, top + 1.31, 0.85)); g.add(this.B(0.22, 0.22, 0.22, '#9A6656', -0.6 + s * 0.4, top + 1.31, -0.85)); }
      g.add(this.C(0.04, 0.04, 1.6, '#5E6873', 0, top + 2, 0, 6)); g.add(this.B(0.6, 0.38, 0.04, '#E9C46A', 0.3, top + 2.6, 0));
      g.add(this.B(0.6, 0.8, 0.08, '#4A3A30', 0, top + 0.4, 1.02));
    } else if (c.type === 'hafen') {
      g.add(this.B(2.2, 0.2, 2.2, '#C9A27A', 0, 0.35, 0));
      [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]].forEach(([x, z]) => g.add(this.C(0.1, 0.1, 1, '#7A5432', x, 0, z, 8)));
      g.add(this.B(0.6, 0.6, 0.6, '#B5523F', -0.5, 0.75, -0.5)); g.add(this.B(0.5, 0.5, 0.5, '#9CC3E6', -0.5, 0.75, 0.2));
      g.add(this.C(0.08, 0.08, 2.4, '#5E6873', 0.6, 1.6, -0.6, 8)); g.add(this.B(1.4, 0.1, 0.1, '#5E6873', 0.1, 2.75, -0.6));
      const boat = new T.Group(); boat.add(this.B(1.6, 0.4, 0.7, '#E8735A', 0, 0, 0)); boat.add(this.B(0.06, 1.3, 0.06, '#FFFFFF', 0, 0.8, 0));
      boat.position.set(0.2, 0.15, 1.8); g.add(boat); g.userData.boat = boat;
    } else if (c.type === 'park') {
      g.add(this.B(2.1, 0.1, 2.1, '#8CC57A', 0, top + 0.02, 0));
      [[-0.5, -0.5, 1], [0.55, -0.3, 0.8], [-0.2, 0.55, 0.9]].forEach(([x, z, s]) => { g.add(this.C(0.08, 0.1, 0.6 * s, '#7A5432', x, top + 0.3 * s, z, 8));
        g.add(this.S(0.45 * s, '#5FA463', x, top + 0.85 * s, z)); g.add(this.S(0.3 * s, '#78BB6E', x + 0.15, top + 1.1 * s, z + 0.1)); });
      g.add(this.B(0.7, 0.1, 0.25, '#B98A5A', 0.5, top + 0.3, 0.6));
      [['#FF8FA3', 0.1, 0.1], ['#FFFFFF', -0.7, 0.2], ['#F6D68B', 0.8, 0.9]].forEach(([cc, x, z]) => g.add(this.S(0.07, cc, x, top + 0.12, z)));
    } else if (c.type === 'turm') {
      for (let s = 0; s < 5; s++) g.add(this.C(0.62 - s * 0.05, 0.67 - s * 0.05, 1, s % 2 ? '#E8735A' : '#F4F1EA', 0, top + 0.5 + s, 0));
      g.add(this.C(0.45, 0.45, 0.6, this.state.night ? '#FFE08A' : '#F6D68B', 0, top + 5.3, 0));
      g.add(this.C(0.05, 0.6, 0.6, '#C9604F', 0, top + 5.9, 0));
      if (this.state.night) { const l = new T.PointLight('#FFD76A', 1.2, 14); l.position.set(0, top + 5.3, 0); g.add(l); }
    }
    this.world.add(g); this.meshes[k] = g;
  }
  scaffold(g) {
    const wood = "#B98A5A", h = 2.6;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => g.add(this.B(0.1, h, 0.1, wood, x * 1.05, h / 2, z * 1.05)));
    [0.9, 1.8].forEach(y => { g.add(this.B(2.2, 0.08, 0.1, wood, 0, y, 1.05)); g.add(this.B(2.2, 0.08, 0.1, wood, 0, y, -1.05)); g.add(this.B(0.1, 0.08, 2.2, wood, 1.05, y, 0)); g.add(this.B(0.1, 0.08, 2.2, wood, -1.05, y, 0)); });
    g.add(this.B(0.5, 0.5, 0.5, "#E9C46A", 0.7, h + 0.25, 0.7));
  }
  selMarker(g) {
    const T = window.THREE, m = new T.Mesh(new T.RingGeometry(1.25, 1.45, 32), new T.MeshBasicMaterial({ color: "#F4D98B", transparent: true, opacity: 0.9, side: T.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.05; g.add(m);
  }
  pick(e) {
    const b = this.r.domElement.getBoundingClientRect();
    this.ray.setFromCamera({ x: (e.clientX - b.left) / b.width * 2 - 1, y: -(e.clientY - b.top) / b.height * 2 + 1 }, this.cam);
    const hit = this.ray.intersectObjects([this.water, this.world, this.terrain].filter(Boolean), true)[0];
    if (!hit) return null;
    let o = hit.object, key = null; while (o) { if (o.userData && o.userData.key) { key = o.userData.key; break; } o = o.parent; }
    if (key) return { key };
    const i = Math.round(hit.point.x / 2.2), j = Math.round(hit.point.z / 2.2);
    if (Math.abs(i) > this.half + 2 || Math.abs(j) > this.half + 2) return null;
    return { key: i + ',' + j };
  }
  hover(e) {
    const p = this.pick(e); if (!p) { this.ghost.visible = false; return; }
    const [i, j] = p.key.split(',').map(Number); const c = this.grid[p.key];
    const tt = this.tiles[p.key], base = this.top(p.key);
    const h = c && c.type === 'haus' ? base + c.floors.length * (this.floorH || 1.6) + 1.2 : c ? base + 2.05 : tt && !tt.w ? base + 0.2 : 0.15;
    this.ghost.position.set(i * 2.2, h, j * 2.2); this.ghost.visible = true;
    this.ghost.material.color.set(this.state.tool === 'weg' ? '#E8735A' : this.state.tool === 'land' ? '#F4D98B' : tt && tt.locked ? '#8D9BB0' : '#FFFFFF');
    if (this.state.tool === 'land' && tt && tt.locked) { const ch = this.chunkOf(p.key).split(',').map(Number); this.ghost.scale.set(this.CH, 1, this.CH); this.ghost.position.set(((ch[0] + 0.5) * this.CH - this.half - 0.5) * 2.2, base + 0.2, ((ch[1] + 0.5) * this.CH - this.half - 0.5) * 2.2); } else this.ghost.scale.set(1, 1, 1);
  }
  click(e) {
    const p = this.pick(e); if (!p) return;
    const k = p.key, c = this.grid[k], tool = this.state.tool, t = this.T[tool];
    if (tool === "land") { this.buyLand(k); return; }
    if (tool === "weg") {
      if (!c) return;
      if (c.type === "rathaus") { this.toast("Das Rathaus kannst du nicht abreißen"); return; }
      this.act({ type: "demolish", k }).then(r => { if (r) { this.toast("Abgerissen, +" + r.refund + " Münzen"); if (this.state.selTile === k && !this.grid[k]) this.setState({ selTile: null }); } });
      return;
    }
    // Auswählen, oder Klick auf ein bestehendes Gebäude (außer Aufstocken): Gebäude-Panel öffnen
    if (tool === "auswahl" || (c && !(tool === "haus" && c.type === "haus"))) { const prev = this.state.selTile; this.setState({ selTile: c ? k : null, tab: c ? "gebaeude" : this.state.tab === "gebaeude" ? "regeln" : this.state.tab }); if (prev) this.build(prev); if (c) this.build(k); return; }
    if (this.thLevel() < t.minTH) { this.toast(t.name + " gibt es ab Rathaus-Stufe " + t.minTH); return; }
    const color = this.HOUSE[Math.floor(Math.random() * this.HOUSE.length)];
    if (c) {
      if (c.floors.length >= TWRules.maxFloors(this.thLevel())) { this.toast(c.floors.length >= 5 ? "Höher geht es nicht" : "Mehr Stockwerke gibt es mit dem nächsten Rathaus-Ausbau"); return; }
      if (this.state.coins < t.cost) { this.toast("Zu wenig Münzen. Dir fehlen " + Math.ceil(t.cost - this.state.coins) + "."); return; }
      this.act({ type: "stack", k, color });
      return;
    }
    const [i, j] = k.split(",").map(Number), tt = this.tiles[k];
    if (t.water) {
      if (tt && !tt.w) { this.toast(t.name + " baust du ins Wasser an deiner Küste oder an einen Fluss"); return; }
      const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const o = this.tiles[(i + a) + "," + (j + b)]; return o && !o.w && !o.locked; });
      if (!shore) { this.toast(t.name + " muss an dein freigeschaltetes Land grenzen"); return; }
    } else if (!tt || tt.w) { this.toast("Hier ist Wasser. Nur Häfen und Brücken gehen aufs Wasser."); return; }
    else if (tt.locked) { this.toast("Dieses Land gehört dir noch nicht. Nutze „Land kaufen“."); return; }
    if (this.state.coins < t.cost) { this.toast("Zu wenig Münzen. Dir fehlen " + Math.ceil(t.cost - this.state.coins) + "."); return; }
    this.act({ type: "build", k, build: tool, color }).then(r => { if (r && tool === "kaserne") this.spawnLife(); });
  }
  upgradeSel() { const k = this.state.selTile; if (k) this.act({ type: "upgrade", k }).then(r => { if (r) this.toast("Ausbau gestartet"); }); }
  rushSel() { const k = this.state.selTile; if (k) this.act({ type: "rush", k }).then(r => { if (r) this.toast("Sofort fertig!"); }); }
  demolishSel() { const k = this.state.selTile, c = this.grid[k]; if (!c) return; this.act({ type: "demolish", k }).then(r => { if (r) { this.toast("Abgerissen, +" + r.refund + " Münzen"); if (!this.grid[k]) this.setState({ selTile: null, tab: "regeln" }); } }); }
  setTax(v) { this.setState({ tax: v }); clearTimeout(this.taxT); this.taxT = setTimeout(() => this.act({ type: "tax", value: v }), 300); }
  toggleLaw(id) { const on = !this.state.laws[id]; this.setState(x => ({ laws: { ...x.laws, [id]: on } })); this.act({ type: "law", id, on }); }

  /* ---------- 3D-Modelle ---------- */
  async loadModels() {
    const T = window.THREE;
    if (!T || !T.GLTFLoader) { setTimeout(() => this.loadModels(), 150); return; }
    try {
      const loader = new T.GLTFLoader(), out = {};
      await Promise.all(Game.MODELS.map(name => new Promise(res => {
        loader.load('/assets/models/' + name + '.glb', g => { out[name] = this.prepModel(g.scene); res(); }, undefined, () => res());
      })));
      this.models = out;
      this.floorH = 3 * 0.68;
      Object.keys(this.grid).forEach(k => this.build(k));
      this.drawTerrain(); this.gullModels(); this.spawnLife();
      this.setState({ modelsReady: true });
    } catch (e) { this.toast('Modelle konnten nicht geladen werden'); }
  }
  prepModel(scene) {
    const T = window.THREE;
    scene.updateMatrixWorld(true);
    const byMat = {};
    scene.traverse(o => {
      if (!o.isMesh) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      const m = o.material, key = m.uuid;
      const e = byMat[key] || (byMat[key] = { mat: m, pos: [], nrm: [] });
      e.pos.push(g.attributes.position.array); e.nrm.push(g.attributes.normal.array);
    });
    const group = new T.Group();
    Object.values(byMat).forEach(e => {
      const len = e.pos.reduce((a, b) => a + b.length, 0), P = new Float32Array(len), Nn = new Float32Array(len);
      let off = 0; e.pos.forEach((a, i) => { P.set(a, off); Nn.set(e.nrm[i], off); off += a.length; });
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(P, 3)); geo.setAttribute('normal', new T.BufferAttribute(Nn, 3));
      const mat = new T.MeshStandardMaterial({ color: e.mat.color, roughness: Math.max(0.6, e.mat.roughness ?? 0.85), metalness: 0, side: e.mat.side, transparent: e.mat.transparent, opacity: e.mat.opacity });
      if (e.mat.emissive && e.mat.emissive.getHex()) { mat.emissive = e.mat.emissive.clone(); mat.emissiveIntensity = e.mat.emissiveIntensity ?? 1; }
      mat.name = e.mat.name || '';
      const mesh = new T.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    });
    const box = new T.Box3().setFromObject(group), size = box.getSize(new T.Vector3());
    return { group, size, min: box.min };
  }
  model(name, opts) {
    const m = this.models && this.models[name]; if (!m) return null;
    opts = opts || {};
    const g = m.group.clone();
    if (opts.tint) g.traverse(o => { if (o.isMesh && /plaster/.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(opts.tint); } });
    const s = opts.scale || (opts.fit || 2.1) / Math.max(m.size.x, m.size.z);
    g.scale.setScalar(s); g.position.y = -m.min.y * s;
    const w = new window.THREE.Group(); w.add(g); if (opts.rot) w.rotation.y = opts.rot;
    w.userData.h = m.size.y * s;
    return w;
  }
  instanced(name, list, fit) {
    const T = window.THREE, m = this.models && this.models[name]; if (!m || !list.length) return null;
    const grp = new T.Group(), o = new T.Object3D(), c = new T.Color(), base = (fit || 1.6) / Math.max(m.size.x, m.size.z);
    m.group.children.forEach(src => {
      const im = new T.InstancedMesh(src.geometry, src.material, list.length); im.castShadow = true; im.receiveShadow = true;
      list.forEach((p, n) => { const s = base * (p.s || 1);
        o.position.set(p.x, p.y - m.min.y * s, p.z); o.rotation.set(0, p.r || 0, 0); o.scale.setScalar(s); o.updateMatrix(); im.setMatrixAt(n, o.matrix);
        c.setScalar(p.dim ? 0.68 : 1); im.setColorAt(n, c); });
      grp.add(im);
    });
    return grp;
  }
  gullModels() {
    if (!this.models || !this.models.seagull) return;
    this.gulls.forEach(g => { if (g.userData.m) return; g.userData.w1.visible = g.userData.w2.visible = false; const m = this.model('seagull', { fit: 1.3 }); m.rotation.y = Math.PI / 2; g.add(m); g.userData.m = m; });
  }
  spawnLife() {
    const T = window.THREE; if (!this.models || !this.sc) return;
    if (this.life) this.sc.remove(this.life);
    this.life = new T.Group(); this.walkers = []; this.ships = [];
    const free = Object.keys(this.tiles || {}).filter(k => { const t = this.tiles[k]; return !t.w && !t.locked; });
    if (free.length) {
      const nK = Math.min(4, Object.values(this.grid).filter(c => c.type === 'kaserne').length * 2);
      for (let n = 0; n < 7 + nK; n++) {
        const knight = n >= 7, m = this.model(knight ? 'knight_soldier' : 'villager', { fit: knight ? 0.55 : 0.5 });
        const k = free[Math.floor(this.rnd(n * 9.1 + 2) * free.length)], [i, j] = k.split(',').map(Number);
        m.position.set(i * 2.2 + (this.rnd(n) - 0.5), this.top(k), j * 2.2 + (this.rnd(n + 4) - 0.5));
        this.life.add(m); this.walkers.push({ m, tx: m.position.x, tz: m.position.z, sp: knight ? 0.025 : 0.018, ph: n });
      }
    }
    const tr = this.traits, H = this.half * 2.2;
    if (tr && (tr.coast > 0.02)) {
      ['merchant_ship', 'war_galleon', 'fishing_boat'].forEach((name, n) => {
        const m = this.model(name, { fit: name === 'fishing_boat' ? 2 : 3.4 }); if (!m) return;
        this.life.add(m); this.ships.push({ m, n, island: tr.coast > 0.85, d: H * (0.86 + n * 0.07), sp: 0.0006 + n * 0.0002, a: n * 2.1 });
      });
    }
    this.sc.add(this.life);
  }
  animLife(t) {
    const tr = this.traits;
    (this.walkers || []).forEach(w => {
      const p = w.m.position, dx = w.tx - p.x, dz = w.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.1) {
        const i = Math.round(p.x / 2.2), j = Math.round(p.z / 2.2);
        const opts = [];
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const k = (i + a) + ',' + (j + b), tt = this.tiles[k]; if (tt && !tt.w && !tt.locked && !this.grid[k]) opts.push([i + a, j + b]); }
        if (opts.length) { const q = opts[Math.floor(Math.random() * opts.length)]; w.tx = q[0] * 2.2 + (Math.random() - 0.5) * 1.2; w.tz = q[1] * 2.2 + (Math.random() - 0.5) * 1.2; }
        return;
      }
      p.x += dx / d * w.sp * 2.2; p.z += dz / d * w.sp * 2.2;
      const k = Math.round(p.x / 2.2) + ',' + Math.round(p.z / 2.2);
      p.y = this.top(k) + Math.abs(Math.sin(t / 110 + w.ph)) * 0.08;
      w.m.rotation.y = Math.atan2(dx, dz);
    });
    (this.ships || []).forEach(s => {
      s.a += s.sp;
      let x, z, dir;
      if (s.island) { x = Math.cos(s.a) * s.d; z = Math.sin(s.a) * s.d; dir = -s.a; }
      else { const sd = tr.seaDir, px = -sd[1], pz = sd[0], u = Math.sin(s.a) * this.half * 1.6; x = sd[0] * s.d + px * u; z = sd[1] * s.d + pz * u; dir = Math.atan2(px * Math.cos(s.a), pz * Math.cos(s.a)) - Math.PI / 2; }
      s.m.position.set(x, Math.sin(t / 600 + s.n) * 0.08 - 0.15, z); s.m.rotation.y = dir; s.m.rotation.z = Math.sin(t / 800 + s.n) * 0.04;
    });
  }

  /* ---------- Anzeige ---------- */
  renderVals() {
    if (!this._host) this._host = (el) => { if (el && !this.r) this.initScene(el); };
    if (!this._map) this._map = (el) => { if (el) { this.mapEl = el; } };
    const s = this.calc(), lv = this.level(), st = this.state, fmt = (n) => Math.floor(n).toLocaleString('de-DE');
    const isIsland = st.view === 'insel', isMap = !isIsland;
    const th = this.thLevel(), now = Date.now();
    const tools = Object.keys(this.T).filter(id => id !== "rathaus").map(id => { const t = this.T[id], locked = !t.tool && th < t.minTH;
      return { ...t, id, locked, info: id === "auswahl" ? "Gebäude ansehen und ausbauen" : id === "land" ? "6×6 Grundstück · " + this.unlocked.length + "/" + TWRules.maxChunks(th) : id === "weg" ? "Gibt die Hälfte zurück" : locked ? "ab Rathaus-Stufe " + t.minTH : this.buildingInfo(id, 1),
        costLabel: id === "land" ? this.landCost() : t.cost ? t.cost : "", selected: st.tool === id, notSelected: st.tool !== id, pick: () => this.setState({ tool: id }) }; });
    const busy = TWRules.busyCount(this.grid, now);
    let sel = null;
    const sk = st.selTile, sg = sk && this.grid[sk];
    if (sg) {
      const t = this.T[sg.type], lvl = sg.lvl || 1, fmtT = sec => { sec = Math.max(0, Math.ceil(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return h ? h + " h " + m + " min" : m ? m + " min " + (x ? x + " s" : "") : x + " s"; };
      const maxed = lvl >= t.maxLvl, needTH = sg.type !== "rathaus" && lvl >= th;
      const remain = sg.busyUntil ? (sg.busyUntil - now) / 1000 : 0, total = sg.busyUntil ? TWRules.upgradeTime(sg.type, lvl) : 1;
      sel = { name: t.name, color: t.color, lvl, maxLvl: t.maxLvl, isHouse: sg.type === "haus", floors: sg.floors ? sg.floors.length : 0, maxFloors: TWRules.maxFloors(th),
        now: this.buildingInfo(sg.type, lvl), next: !maxed && sg.type !== "haus" ? this.buildingInfo(sg.type, lvl + 1) : "",
        busy: !!sg.busyUntil, remain: fmtT(remain), pct: Math.round((1 - remain / total) * 100), rushCost: TWRules.rushCost(remain),
        canUp: !sg.busyUntil && !maxed && !needTH && sg.type !== "haus", upCost: TWRules.upgradeCost(sg.type, lvl), upTime: fmtT(TWRules.upgradeTime(sg.type, lvl)),
        why: sg.type === "haus" ? "Wohnhäuser wachsen durch Aufstocken: wähle Wohnhaus und klicke auf das Haus." : maxed ? "Höchste Stufe erreicht." : needTH ? "Baue zuerst dein Rathaus auf Stufe " + (lvl + 1) + " aus." : busy >= TWRules.BUILDERS && !sg.busyUntil ? "Alle Bauarbeiter sind beschäftigt." : "",
        builderFull: busy >= TWRules.BUILDERS, isTH: sg.type === "rathaus",
        unlocks: sg.type === "rathaus" && lvl < TWRules.MAX_TH ? Object.keys(this.T).filter(id => this.T[id].minTH === lvl + 1).map(id => this.T[id].name).join(", ") : "",
        upgrade: () => this.upgradeSel(), rush: () => this.rushSel(), demolish: () => this.demolishSel(), close: () => { this.setState({ selTile: null, tab: "regeln" }); this.build(sk); } };
    }
    const tabs = (sel ? [['gebaeude', 'Gebäude']] : []).concat([['regeln', 'Regeln'], ['stadt', 'Insel'], ['clan', 'Clan']]).map(([id, label]) => ({ label, active: st.tab === id, inactive: st.tab !== id, pick: () => this.setState({ tab: id }) }));
    const views = [['insel', 'Insel'], ['karte', 'Weltkarte']].map(([id, label]) => ({ label, active: st.view === id, inactive: st.view !== id, pick: () => this.setState({ view: id }) }));
    const laws = this.LAWS.map(l => ({ ...l, track: st.laws[l.id] ? '#E9C46A' : '#33445F', align: st.laws[l.id] ? 'flex-end' : 'flex-start', border: st.laws[l.id] ? '#8C7638' : '#22314A',
      toggle: () => this.toggleLaw(l.id) }));
    const cn = s.counts, n = (x) => cn[x] || 0;
    const regionCount = Object.values(st.own).filter(v => v === 'me').length;
    const stats = [
      { k: 'Gebäude', v: Object.keys(this.grid).length }, { k: 'Wohnhäuser', v: n('haus') }, { k: 'Betriebe', v: n('markt') + n('werk') + n('hafen') + n('kaserne') },
      { k: 'Besetzte Jobs', v: Math.round(s.staff * 100) + ' %' }, { k: 'Steuern', v: (Math.round(s.pop * st.tax / 100 * 1.2 * 10) / 10).toLocaleString('de-DE') + '/s' },
      { k: 'Insgesamt verdient', v: fmt(st.earned) }
    ];
    const voices = [];
    if (st.tax > 18) voices.push('Die Steuern sind viel zu hoch!');
    if (s.staff < 1) voices.push('Es gibt mehr Jobs als Leute. Baut mehr Wohnhäuser!');
    if (s.jobs === 0 || s.pop > s.jobs * 1.5) voices.push('Wir brauchen Arbeit. Ein Markt wäre toll.');
    if (n('werk') + n('kaserne') > n('park')) voices.push('So laut hier. Wo bleibt ein Park?');
    if (st.laws.wehr) voices.push('Wehrpflicht? Mein Sohn wollte doch Bäcker werden.');
    if (regionCount > 3) voices.push('Unser Reich wächst. Man spricht von uns bis ins Ausland!');
    if (s.hap > 75) voices.push('Ich liebe diese Insel!');
    if (!voices.length) voices.push('Alles in Ordnung hier.');

    let mapVals = { mapWorld: false, mapPick: false, mapRegion: false, hasHex: false, noHex: false, canAttack: false, hasReason: false, pickFree: false, pickTaken: false };
    let empire = [], factions = [];
    if (isMap && st.mapReady) {
      const mine = this.myIds(), ccs = {}; mine.forEach(id => ccs[this.rById[id].cc] = 1);
      empire = [{ k: 'Regionen', v: regionCount }, { k: 'Länder', v: Object.keys(ccs).length }, { k: 'Ertrag', v: '+' + (Math.round(s.reg * 10) / 10).toLocaleString('de-DE') + '/s' }, { k: 'Truppen', v: fmt(st.troops) }, { k: 'Spieler', v: this.players || 1 }];
      factions = Object.keys(this.FACTIONS).map(f => ({ name: this.FACTIONS[f].name, color: this.FACTIONS[f].color, lands: this.FACTIONS[f].c.length + ' Länder · ' + this.FACTIONS[f].c.slice(0, 3).map(c => this.cNames[c] || c).join(', ') }));
      const r = st.selHex && this.rById[st.selHex];
      if (!st.home) {
        mapVals.mapPick = true;
        if (r) Object.assign(mapVals, { hasHex: true, hName: r.name, hCountry: r.country, pickFree: this.ownerOf(r.id) === 'neutral', pickTaken: this.ownerOf(r.id) !== 'neutral', pickReason: r.faction ? 'Diese Region gehört einem KI-Reich.' : 'Hier herrscht schon ' + this.ownerOf(r.id).slice(2) + '.' });
      } else {
        mapVals.mapWorld = true; mapVals.mapRegion = true;
        if (r) {
          if (!this.reach) this.reach = this.reachable();
          const ow = this.ownerOf(r.id), chk = this.attackCheck(r), all = this.rByCountry[r.cc], cm = all.filter(x => this.ownerOf(x.id) === 'me').length;
          Object.assign(mapVals, { hasHex: true, hName: r.name, hCountry: r.country, hDef: r.def, hYield: r.yield.toLocaleString('de-DE'), hColor: this.colorOf(ow),
            hOwner: (ow === 'me' ? (r.id === st.home ? 'Deine Heimat' : 'Deine Region') : ow === 'neutral' ? 'Unbesetzt' : ow.startsWith('p:') ? 'Gehört ' + ow.slice(2) : 'Besetzt vom ' + this.FACTIONS[ow].name) + ' · ' + r.country,
            canAttack: chk.ok, hasReason: !chk.ok, reason: chk.why || '', cMine: cm, cTotal: all.length, cPct: Math.round(cm / all.length * 100) });
        } else Object.assign(mapVals, { noHex: true, hCountry: 'Land', cMine: 0, cTotal: 0, cPct: 0 });
      }
    }
    const lvPct = Math.max(0, Math.min(1, lv.pct)), circ = 2 * Math.PI * 22;
    return {
      owner: this.props.name, coins: fmt(st.coins), income: (Math.round(s.income * 10) / 10).toLocaleString('de-DE'), pop: s.pop, jobs: s.jobs, happy: Math.round(s.hap),
      troops: fmt(st.troops), troopRate: (Math.round(s.troopRate * 100) / 100).toLocaleString('de-DE'), regionCount,
      level: lv.lv, ringDash: (lvPct * circ).toFixed(1) + ' ' + circ.toFixed(1), clanPct: Math.min(100, Math.round(lv.lv / 5 * 100)),
      tools, tabs, views, laws, stats, voices: voices.slice(0, 3), tax: st.tax, buildingCount: Object.keys(this.grid).length,
      onTax: (e) => this.setTax(Number(e.target.value)), sel, tabBau: isIsland && st.tab === 'gebaeude' && !!sel, builders: (TWRules.BUILDERS - busy) + '/' + TWRules.BUILDERS, th,
      isIsland, isMap, tabRegeln: isIsland && (st.tab === 'regeln' || (st.tab === 'gebaeude' && !sel)), tabStadt: isIsland && st.tab === 'stadt', tabClan: isIsland && st.tab === 'clan',
      islandDisplay: isIsland ? 'flex' : 'none', islandBlock: isIsland ? 'block' : 'none', mapBlock: isMap ? 'block' : 'none',
      mapLoading: isMap && !st.mapReady, showLegend: isMap && st.mapReady,
      legend: [{ color: '#E9C46A', label: 'Dein Reich' }, { color: 'hsl(200, 45%, 62%)', label: 'Andere Spieler' }, { color: '#2B3B57', label: 'Freies Land' }].concat(Object.keys(this.FACTIONS).map(f => ({ color: this.FACTIONS[f].color, label: this.FACTIONS[f].name }))),
      empire, factions, log: st.log, ...mapVals,
      planned: [{ t: 'Inseln besuchen', d: 'Durch die Städte anderer Spieler laufen und Sterne vergeben.' }, { t: 'Clan-Gebiete', d: 'Eroberte Länder gehören dem ganzen Clan und werden gemeinsam verteidigt.' }, { t: 'Clan-Krieg', d: 'Rivalen greifen deine Gebiete an. Mauern und Kasernen schützen sie.' }],
      attack: () => this.doAttack(), startHere: () => this.startHere(), hoverLabel: this.hoverLabel || 'Fahre über eine Region',
      zoomIn: () => this.zoomBy(1.8), zoomOut: () => this.zoomBy(1 / 1.8), zoomHome: () => this.zoomTo(this.state.home || (this.rByCountry && this.rByCountry.DEU[0].id)),
      islandTitle: st.home && this.rById ? this.rById[st.home].name : 'Startinsel', islandSub: st.home && this.rById ? this.rById[st.home].country + ' · echte Form deiner Region' : 'Wähle auf der Weltkarte dein Startgebiet',
      hasMsg: !!st.msg, msg: st.msg, hostRef: this._host, mapRef: this._map, logout: () => TWApi.logout(),
      toggleNight: () => { const night = !st.night; this.setState({ night }, () => {
        if (!this.sc) return; this.sc.background.set(night ? '#1B2B44' : '#BFE3EF'); this.sc.fog.color.set(night ? '#1B2B44' : '#BFE3EF');
        this.hemi.intensity = night ? 0.35 : 0.8; this.sun.intensity = night ? 0.2 : 0.85; Object.keys(this.grid).forEach(k => this.build(k)); }); }
    };
  }
}

Game.MODELS = ['apple_tree', 'bakery', 'barracks_fort', 'beach_set', 'bush_wildflowers', 'city_park', 'cobblestone_tile', 'craftsman_workshop',
  'dutch_windmill', 'farm_tile', 'fishing_boat', 'harbor_pier', 'knight_soldier', 'lighthouse', 'lion_fountain', 'lion_monument', 'market_hall',
  'merchant_ship', 'palm_tree', 'pine_tree', 'reeds_lily_pads', 'rock_set', 'saguaro_cactus', 'seagull', 'standing_banner', 'stone_bridge',
  'town_hall', 'townhouse_gabled_roof', 'townhouse_ground_floor', 'townhouse_middle_floor', 'village_church', 'villager', 'war_galleon', 'watchtower'];
