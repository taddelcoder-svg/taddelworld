/* Oberfläche: Anmeldung und das Zeichnen der Leisten und Seitenpanels.
   Die Werte kommen aus game.renderVals(), Klicks laufen über data-a. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = {
    crown: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E9C46A" stroke-width="1.8" aria-hidden="true"><path d="M3 18h18l-2-9-4 4-3-7-3 7-4-4z"/><path d="M5 21h14"/></svg>',
    coins: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E9C46A" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>',
    sword: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F08A6C" stroke-width="2" aria-hidden="true"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/></svg>',
    people: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7CC4D4" stroke-width="2" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/></svg>',
    smile: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8FD18A" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>',
    map: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B9A4F0" stroke-width="2" aria-hidden="true"><path d="M4 21V4l8 3 8-3v13l-8 3-8-3"/><path d="M12 7v13"/></svg>',
    moon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EEF2F7" stroke-width="2" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    logout: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EEF2F7" stroke-width="2" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
    hammer: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E3C38A" stroke-width="2" aria-hidden="true"><path d="M14 6l4 4"/><path d="M10 4l6 2 2 2-2 2-6-2z"/><path d="M11 9l-8 8 3 3 8-8"/></svg>',
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4D98B" stroke-width="2" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>'
  };

  let game = null, acts = {}, last = {};
  // Jede Region bekommt ihr eigenes Präfix, damit gleiche HTML-Teile gleiche Aktions-IDs behalten
  function actor(prefix) { let n = 0; return fn => { const id = prefix + (n++); acts[id] = fn; return id; }; }
  function put(el, html) { if (last[el] !== html) { $(el).innerHTML = html; last[el] = html; } }

  function renderTop(v, a) {
    const pill = (icon, big, small, col) => `<div class="pill">${icon}<div><b>${big}</b><small style="color:${col}">${small}</small></div></div>`;
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-right:10px">
        <div class="crest">${ICON.crown}</div>
        <div><div class="cinzel" style="font-size:20px">LÖWEN-INSELN</div><div class="muted" style="font-size:12px">Reich von ${esc(v.owner)} · Stufe ${v.level}</div></div>
      </div>
      ${pill(ICON.coins, v.coins, '+' + v.income + '/s', '#C9B27A')}
      ${pill(ICON.sword, v.troops, '+' + v.troopRate + '/s Truppen', '#E3A08A')}
      ${pill(ICON.people, v.pop, v.jobs + ' Jobs', '#9CCFDB')}
      ${pill(ICON.smile, v.happy + '%', 'Zufrieden', '#A9D9A5')}
      ${pill(ICON.map, v.regionCount, 'Regionen', '#CDBEF5')}
      ${v.isIsland ? pill(ICON.hammer, v.builders, 'Bauarbeiter frei', '#E3C38A') : ''}
      <div style="flex-grow:1"></div>
      <div class="seg">${v.views.map(x => `<button class="${x.active ? 'on' : ''}" data-a="${a(x.pick)}">${x.label}</button>`).join('')}</div>
      <div style="width:52px;height:52px;position:relative;display:flex;align-items:center;justify-content:center" title="Fortschritt zur nächsten Stufe">
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="#16223A" stroke="#2A3B58" stroke-width="4"/><circle cx="26" cy="26" r="22" fill="none" stroke="#E9C46A" stroke-width="4" stroke-linecap="round" stroke-dasharray="${v.ringDash}" transform="rotate(-90 26 26)"/></svg>
        <span class="cinzel" style="position:absolute;font-size:16px">${v.level}</span>
      </div>
      <button class="iconbtn" aria-label="Tag oder Nacht" data-a="${a(v.toggleNight)}">${ICON.moon}</button>
      <button class="iconbtn" aria-label="Abmelden" title="Abmelden" data-a="${a(v.logout)}">${ICON.logout}</button>`;
  }

  function renderLeft(v, a) {
    return `
      <div style="padding:16px 16px 8px;display:flex;justify-content:space-between;align-items:baseline"><span class="cinzel" style="font-size:15px">BAUEN</span><span class="muted" style="font-size:12px">${v.buildingCount} Gebäude</span></div>
      <div class="scroll" style="flex-grow:1;padding:0 12px 12px;display:flex;flex-direction:column;gap:6px">
        ${v.tools.map(t => `<button class="tool ${t.selected ? 'on' : ''} ${t.locked ? 'locked' : ''}" data-a="${a(t.pick)}"><span class="sw" style="background:${t.color}"></span><span><span class="nm">${esc(t.name)}</span><span class="in">${esc(t.info)}</span></span><span class="co">${t.costLabel}</span></button>`).join('')}
      </div>
      <p class="muted" style="font-size:12px;margin:0;padding:12px 16px 16px;line-height:1.5;border-top:1px solid var(--line)">Klick aufs Land baut, Klick auf ein Wohnhaus stockt auf. Ziehen dreht, Mausrad zoomt.</p>`;
  }

  function renderRight(v, a) {
    let h = '';
    if (v.isIsland) h += `<div class="tabs">${v.tabs.map(t => `<button class="${t.active ? 'on' : ''}" data-a="${a(t.pick)}">${t.label}</button>`).join('')}</div>`;
    h += '<div class="scroll" style="flex-grow:1;padding:16px;display:flex;flex-direction:column;gap:14px">';
    if (v.tabBau) { const b = v.sel; h += `
      <div class="card" style="border-color:var(--gold);display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:36px;height:36px;border-radius:10px;background:${b.color};flex-shrink:0"></span>
          <span style="flex-grow:1"><b style="font-size:17px;display:block">${esc(b.name)}</b><span class="muted" style="font-size:12px">${b.isHouse ? b.floors + " von " + b.maxFloors + " Stockwerken" : "Stufe " + b.lvl + " von " + b.maxLvl}</span></span>
          <button class="iconbtn" style="width:36px;height:36px;font-size:18px" aria-label="Schließen" data-a="${a(b.close)}">×</button>
        </div>
        <div class="row" style="background:var(--panel)"><span class="muted">Jetzt</span><b style="font-weight:600;text-align:right">${esc(b.now)}</b></div>
        ${b.next ? `<div class="row" style="background:var(--panel)"><span class="muted">Stufe ${b.lvl + 1}</span><b style="font-weight:600;color:var(--gold2);text-align:right">${esc(b.next)}</b></div>` : ""}
        ${b.busy ? `<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Wird ausgebaut</span><span class="muted">noch ${b.remain}</span></div><div class="bar"><i style="width:${b.pct}%"></i></div></div>
          <button class="cta" data-a="${a(b.rush)}">Sofort fertig · ${b.rushCost} Münzen</button>` : ""}
        ${b.canUp && !b.builderFull ? `<button class="cta" data-a="${a(b.upgrade)}">Ausbauen · ${b.upCost} Münzen · ${b.upTime}</button>` : ""}
        ${b.why ? `<div class="note" style="border-style:dashed">${esc(b.why)}</div>` : ""}
        ${b.unlocks ? `<div class="note">Rathaus-Stufe ${b.lvl + 1} schaltet frei: <b>${esc(b.unlocks)}</b>, mehr Land und höhere Gebäudestufen.</div>` : ""}
        ${b.isTH ? "" : `<button class="law" style="justify-content:center;min-height:44px;color:#F08A6C" data-a="${a(b.demolish)}">Abreißen</button>`}
      </div>`; }
    if (v.tabRegeln) h += `
      <div class="card" style="display:flex;flex-direction:column;gap:8px">
        <label for="steuer" style="display:flex;justify-content:space-between;font-weight:600;font-size:14px"><span>Steuersatz</span><span style="color:var(--gold2)">${v.tax}%</span></label>
        <input id="steuer" type="range" min="0" max="30" step="1" value="${v.tax}" data-c="${a(v.onTax)}">
        <span class="muted" style="font-size:12px;line-height:1.45">Mehr Steuern bringen mehr Geld, machen die Bewohner aber unzufriedener.</span>
      </div>
      <span class="cinzel" style="font-size:14px">GESETZE</span>
      ${v.laws.map(l => `<button class="law ${l.track === '#E9C46A' ? 'on' : ''}" data-a="${a(l.toggle)}"><span style="flex-grow:1"><b style="font-size:14px;font-weight:600;display:block">${esc(l.name)}</b><span class="muted" style="font-size:12px">${esc(l.info)}</span></span><span class="switch"><i></i></span></button>`).join('')}`;
    if (v.tabStadt) h += `
      <span class="cinzel" style="font-size:14px">DEINE INSEL</span>
      ${v.stats.map(s => `<div class="row"><span class="muted">${s.k}</span><b style="font-weight:600">${s.v}</b></div>`).join('')}
      <span class="cinzel" style="font-size:14px;margin-top:8px">STIMMEN</span>
      ${v.voices.map(t => `<div class="voice">„${esc(t)}“</div>`).join('')}`;
    if (v.tabClan) h += `
      <div class="card" style="border-color:var(--gold);background:var(--card2);display:flex;flex-direction:column;gap:8px">
        <span class="cinzel" style="font-size:17px">Clans und Kriege</span>
        <span style="font-size:13px;color:var(--soft);line-height:1.5">Ab Stufe 5 trittst du einem Clan bei, verteidigst gemeinsam Gebiete auf der Weltkarte und führst Clan-Kriege.</span>
        <div class="bar"><i style="width:${v.clanPct}%"></i></div><span style="font-size:12px;color:#D9C68E">Stufe ${v.level} von 5</span>
      </div>
      ${v.planned.map(p => `<div class="card"><b style="font-size:14px;font-weight:600;display:block">${p.t}</b><span class="muted" style="font-size:12px;line-height:1.45">${p.d}</span></div>`).join('')}`;
    if (v.mapPick) {
      h += `<span class="cinzel" style="font-size:20px;line-height:1.25;letter-spacing:0">Wähle dein Startgebiet</span>
        <span style="font-size:13px;color:var(--soft);line-height:1.5">Jeder Spieler beginnt in einer echten Region der Welt, etwa einem Bundesland, einem US-Staat oder einer Provinz. Jede Region kann nur ein Spieler haben. Zoome hinein und klicke eine freie Region an.</span>`;
      if (v.hasHex) h += `<div class="card" style="border-color:var(--gold);display:flex;flex-direction:column;gap:6px">
          <span class="muted" style="font-size:12px">${esc(v.hCountry)}</span><b style="font-size:18px">${esc(v.hName)}</b>
          ${v.pickFree ? `<button class="cta" style="margin-top:6px" data-a="${a(v.startHere)}">Hier beginnen</button>` : `<span style="font-size:13px;color:#E3A08A;line-height:1.45">${esc(v.pickReason)} Wähle ein freies Gebiet.</span>`}</div>`;
    }
    if (v.mapWorld) h += `
      <span class="cinzel" style="font-size:15px">DEIN WELTREICH</span>
      <div class="grid2">${v.empire.map(e => `<div class="stat"><span>${e.k}</span><b>${e.v}</b></div>`).join('')}</div>`;
    if (v.mapRegion) {
      if (v.hasHex) h += `
        <div class="card" style="border-color:var(--line2);display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:10px"><span style="width:30px;height:30px;border-radius:8px;background:${v.hColor};flex-shrink:0"></span>
            <span><b style="font-size:16px;display:block">${esc(v.hName)}</b><span class="muted" style="font-size:12px">${esc(v.hOwner)}</span></span></div>
          <div class="grid2"><div class="stat" style="background:var(--panel)"><span>Verteidigung</span><b style="color:#F08A6C">${v.hDef}</b></div><div class="stat" style="background:var(--panel)"><span>Ertrag</span><b style="color:var(--gold)">+${v.hYield}/s</b></div></div>
          <div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span class="muted">${esc(v.hCountry)}: deine Regionen</span><span>${v.cMine} von ${v.cTotal}</span></div><div class="bar"><i style="width:${v.cPct}%"></i></div></div>
          ${v.canAttack ? `<button class="cta" data-a="${a(v.attack)}">Erobern · ${v.hDef} Truppen</button>` : `<div class="note" style="border-style:dashed">${esc(v.reason)}</div>`}
        </div>`;
      else h += `<div class="note">Klicke eine Region an, um sie dir anzusehen oder anzugreifen. Gold gestrichelte Regionen kannst du gerade erreichen.</div>`;
    }
    if (v.isMap) h += `
      <span class="cinzel" style="font-size:14px">CHRONIK</span>
      ${v.log.map(l => `<div style="display:flex;gap:10px;font-size:13px;color:var(--soft);line-height:1.4"><span style="color:#6F7F96;flex-shrink:0">${esc(l.t)}</span><span>${esc(l.m)}</span></div>`).join('')}`;
    return h + '</div>';
  }

  function renderOverlay(v, a) {
    let h = '';
    if (v.isIsland) h += `<div class="float" style="left:16px;top:16px;pointer-events:none"><div class="cinzel" style="font-size:15px">${esc(v.islandTitle)}</div><div class="muted" style="font-size:12px">${esc(v.islandSub)}</div></div>`;
    if (v.mapLoading) h += `<div class="float" style="left:50%;top:50%;transform:translate(-50%,-50%)">Weltkarte wird geladen…</div>`;
    if (v.showLegend) h += `
      <div style="position:absolute;right:16px;top:16px;display:flex;flex-direction:column;gap:6px">
        <button class="iconbtn" aria-label="Hineinzoomen" data-a="${a(v.zoomIn)}">+</button>
        <button class="iconbtn" aria-label="Herauszoomen" data-a="${a(v.zoomOut)}">−</button>
        <button class="iconbtn" aria-label="Zur Heimat" data-a="${a(v.zoomHome)}">${ICON.home}</button>
      </div>
      <div class="float" style="left:16px;top:16px">${esc(v.hoverLabel)}</div>
      <div class="float" style="left:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;font-size:12px">
        ${v.legend.map(l => `<div style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:4px;background:${l.color};border:1px solid #3A4D6E"></span>${l.label}</div>`).join('')}
      </div>`;
    if (v.hasMsg) h += `<div class="toast" role="status">${esc(v.msg)}</div>`;
    return h;
  }

  function render() {
    acts = {};
    const v = game.renderVals();
    put('top', renderTop(v, actor('t')));
    put('left', renderLeft(v, actor('l')));
    put('right', renderRight(v, actor('r')));
    put('overlay', renderOverlay(v, actor('o')));
    $('left').style.display = v.isIsland ? 'flex' : 'none';
    $('island').style.display = v.isIsland ? 'block' : 'none';
    $('map').style.display = v.isMap ? 'block' : 'none';
    v.hostRef($('island')); v.mapRef($('map'));
  }

  // Die Leisten werden jede Sekunde neu gezeichnet. Ein Klick (Drücken + Loslassen) könnte dazwischen
  // verloren gehen, deshalb lösen Maus und Finger schon beim Drücken aus, die Tastatur über click.
  const run = e => { const el = e.target.closest('[data-a]'); if (el && acts[el.dataset.a]) { acts[el.dataset.a](e); return true; } return false; };
  document.addEventListener('pointerdown', e => { if (e.button === 0 && run(e)) e.preventDefault(); });
  document.addEventListener('click', e => { if (e.detail === 0) run(e); });
  document.addEventListener('change', e => { const el = e.target.closest('[data-c]'); if (el && acts[el.dataset.c]) acts[el.dataset.c](e); });

  async function startGame() {
    $('loading').hidden = false; $('auth').hidden = true;
    try {
      const [me, world] = await Promise.all([TWApi.me(), TWApi.world()]);
      game = new Game({ name: me.name, city: me.city, world, now: me.now, offline: me.offline });
      $('loading').hidden = true; $('app').hidden = false;
      game.onChange(render);
      render();
      game.start();
    } catch (e) { $('loading').hidden = true; showAuth(e.message); }
  }

  let registerMode = false;
  function showAuth(msg) {
    $('auth').hidden = false;
    $('authErr').textContent = msg && TWApi.hasToken() ? msg : '';
  }
  function setMode(reg) {
    registerMode = reg;
    $('authBtn').textContent = reg ? 'Konto erstellen' : 'Anmelden';
    $('authSwitch').textContent = reg ? 'Schon ein Konto? Anmelden' : 'Noch kein Konto? Registrieren';
    $('authLead').textContent = reg ? 'Einmal registrieren, danach bleibt dieses Gerät angemeldet.' : 'Melde dich an, um weiterzubauen.';
    $('authPw').autocomplete = reg ? 'new-password' : 'current-password';
    $('authErr').textContent = '';
  }
  $('authSwitch').addEventListener('click', () => setMode(!registerMode));
  $('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('authName').value.trim(), pw = $('authPw').value;
    if (name.length < 3) { $('authErr').textContent = 'Der Name braucht mindestens 3 Zeichen.'; return; }
    if (pw.length < 6) { $('authErr').textContent = 'Das Passwort braucht mindestens 6 Zeichen.'; return; }
    $('authBtn').disabled = true;
    try { await (registerMode ? TWApi.register(name, pw) : TWApi.login(name, pw)); startGame(); }
    catch (err) { $('authErr').textContent = err.message; }
    $('authBtn').disabled = false;
  });
  ['authName', 'authPw'].forEach(id => $(id).addEventListener('input', () => { $('authErr').textContent = ''; }));

  setMode(false);
  if (TWApi.hasToken()) startGame(); else { $('loading').hidden = true; showAuth(); }
})();
