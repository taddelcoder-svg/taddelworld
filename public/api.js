/* Verbindung zum Spiel-Server. Das Anmelde-Token bleibt im Browser gespeichert,
   damit das Gerät angemeldet bleibt. */
const TWApi = (() => {
  const KEY = 'tw_token';
  let token = null;
  try { token = localStorage.getItem(KEY); } catch (e) {}

  async function call(method, path, body, keepalive) {
    const res = await fetch(path, {
      method, keepalive: !!keepalive,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && path !== '/api/login') { setToken(null); }
    if (!res.ok) throw new Error(data.fehler || 'Der Server antwortet gerade nicht.');
    return data;
  }
  function setToken(t) {
    token = t;
    try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) {}
  }

  return {
    hasToken: () => !!token,
    async register(name, password) { const r = await call('POST', '/api/register', { name, password }); setToken(r.token); return r; },
    async login(name, password) { const r = await call('POST', '/api/login', { name, password }); setToken(r.token); return r; },
    async logout() { try { await call('POST', '/api/logout'); } catch (e) {} setToken(null); location.reload(); },
    me: () => call('GET', '/api/me'),
    world: () => call('GET', '/api/world'),
    saveCity: (city, troopGain, leaving) => call('PUT', '/api/city', { city, troopGain }, leaving),
    start: region => call('POST', '/api/world/start', { region }),
    attack: region => call('POST', '/api/world/attack', { region })
  };
})();
