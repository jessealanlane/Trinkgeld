const SUPABASE_URL = 'https://cgmahwvvmxzznzrrqgxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnbWFod3Z2bXh6em56cnJxZ3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczOTQ3NDksImV4cCI6MjEwMjk3MDc0OX0.V9SOl-RLB_D9tJxuuwiy7h7XEzTpdVu8LbxcoTrvjnM';

function getStoreIdFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    let s = params.get('store');
    if (!s && location.hash) {
      const m = location.hash.match(/store=([a-z0-9_-]+)/i) || location.hash.match(/^#([a-z0-9_-]+)/i);
      if (m) s = m[1];
    }
    s = s ? String(s).toLowerCase() : '';
    if (s && /^[a-z0-9_-]+$/.test(s)) return s;
  } catch (e) {}
  return '';
}

function getStoreId() {
  const urlStore = getStoreIdFromUrl();
  if (urlStore) return urlStore;
  try {
    if (window.__store_id) return String(window.__store_id).toLowerCase();
    const s = sessionStorage.getItem('current_store') || localStorage.getItem('current_store');
    return String(s || 'koeln').toLowerCase();
  } catch (e) {
    return String(window.__store_id || 'koeln').toLowerCase();
  }
}

const SESSION_STORAGE_KEY = 'cloud_supabase_session_v1';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch (e) {
    return null;
  }
}

function saveSession(session) {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
}

function getSessionUserEmail(session) {
  if (!session) return '';
  if (session.user && session.user.email) return String(session.user.email);
  if (session.user && session.user.user_metadata && session.user.user_metadata.email) return String(session.user.user_metadata.email);
  return '';
}

async function supabaseAuthRequest(pathWithQuery, bodyObj) {
  const res = await fetch(`${SUPABASE_URL}${pathWithQuery}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyObj || {})
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && (data.error_description || data.msg || data.message || data.error) ? (data.error_description || data.msg || data.message || data.error) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function refreshIfNeeded(session) {
  if (!session) return null;
  const exp = session.expires_at;
  if (!exp || typeof exp !== 'number') return session;
  if (exp - nowSeconds() > 60) return session;
  if (!session.refresh_token) return session;

  const data = await supabaseAuthRequest('/auth/v1/token?grant_type=refresh_token', {
    refresh_token: session.refresh_token
  });
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    expires_at: nowSeconds() + (data.expires_in || 0),
    user: data.user || session.user
  };
  saveSession(next);
  return next;
}

async function getSession() {
  const session = loadSession();
  if (!session) return null;
  return await refreshIfNeeded(session);
}

async function signIn(email, password) {
  const data = await supabaseAuthRequest('/auth/v1/token?grant_type=password', { email, password });
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    expires_at: nowSeconds() + (data.expires_in || 0),
    user: data.user
  };
  saveSession(session);
  return session;
}

async function signOut() {
  saveSession(null);
}

async function getAllowedStoreIds() {
  const session = await getSession();
  if (!session) return [];
  const email = getSessionUserEmail(session).trim().toLowerCase();
  if (!email) return [];
  const rows = await restRequest(
    'GET',
    `/rest/v1/store_access?select=store_id&email=eq.${encodeURIComponent(email)}`,
    session.access_token
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => String(row && row.store_id || '').toLowerCase())
    .filter(id => ALL_STORE_IDS.includes(id));
}

async function restRequest(method, pathWithQuery, accessToken, bodyObj) {
  const headers = {
    apikey: SUPABASE_ANON_KEY
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    headers.Prefer = 'return=minimal';
  }

  const res = await fetch(`${SUPABASE_URL}${pathWithQuery}`, {
    method,
    headers,
    body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data && (data.message || data.error || data.hint) ? (data.message || data.error || data.hint) : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (method === 'GET') {
    return await res.json().catch(() => null);
  }
  return null;
}

async function replaceAppStateRow(storeId, state) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');

  const encodedStoreId = encodeURIComponent(storeId);
  await restRequest('DELETE', `/rest/v1/app_state?store_id=eq.${encodedStoreId}`, session.access_token);

  const row = { store_id: storeId, state: state, updated_at: new Date().toISOString() };
  try {
    await restRequest('POST', '/rest/v1/app_state', session.access_token, row);
  } catch (e) {
    if (String(e && e.message || '').toLowerCase().includes('duplicate')) {
      await restRequest('PATCH', `/rest/v1/app_state?store_id=eq.${encodedStoreId}`, session.access_token, row);
      return true;
    }
    throw e;
  }
  return true;
}

const SHARED_KEYS = [
  'departments',
  'workEntries',
  'dailyCalculations',
  'tipData',
  'tipPaymentPeriods',
  'kitchenProcedureSettings',
  'spuelerProcedureSettings',
  'baristaProcedureSettings',
  'tipProcedurePeriods',
  'punctuality_enabled',
  'punctualityPeriods',
  'tipProcedureSettings',
  'accessControlSettings',
  'lockedTips'
];

const KOELN_PREFIX_KEYS = [
  'koeln_employees',
  'koeln_notes',
  'koeln_personalTipsTimeout',
  'koeln_lastWorkDate'
];

const STORE_LABELS = {
  koeln: 'Köln',
  bonn: 'Bonn',
  apostelnstr: 'CROP Apostelnstr',
  ehrenstr: 'CROP - Ehren'
};

const ALL_STORE_IDS = Object.keys(STORE_LABELS);

function storeKeySetFor(storeId) {
  const keys = [];
  if (storeId === 'koeln') {
    SHARED_KEYS.forEach(k => keys.push(k));
    KOELN_PREFIX_KEYS.forEach(k => keys.push(k));
    keys.push('koeln_gate_hash');
  } else {
    SHARED_KEYS.forEach(k => keys.push(`${storeId}_${k}`));
    KOELN_PREFIX_KEYS.forEach(k => keys.push(k.replace(/^koeln_/, `${storeId}_`)));
    keys.push(`${storeId}_gate_hash`);
  }
  return keys;
}

function collectStoreState(storeId) {
  const keys = storeKeySetFor(storeId);
  const values = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null && v !== undefined) values[k] = v;
    } catch (e) {}
  });
  return { version: 1, storeId, keys: values, exportedAt: new Date().toISOString() };
}

function hasLocalDataForStore(storeId) {
  const keys = storeKeySetFor(storeId);
  for (const k of keys) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null && v !== undefined) return true;
    } catch (e) {}
  }
  return false;
}

function evictOtherStoreData(keepStoreId) {
  const keep = String(keepStoreId || '').toLowerCase();
  ALL_STORE_IDS.forEach(storeId => {
    if (storeId === keep) return;
    storeKeySetFor(storeId).forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
  });
}

function applyStoreState(state) {
  if (!state || !state.keys || typeof state.keys !== 'object') return;
  const storeId = String((state && state.storeId) || getStoreId() || 'koeln').toLowerCase();
  evictOtherStoreData(storeId);
  Object.entries(state.keys).forEach(([k, v]) => {
    try {
      if (v === null || v === undefined) {
        localStorage.removeItem(k);
      } else {
        localStorage.setItem(k, String(v));
      }
    } catch (e) {}
  });
}

async function uploadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  if (!hasLocalDataForStore(storeId)) {
    throw new Error(`Keine lokalen Daten für ${storeId} gefunden. Upload abgebrochen.`);
  }
  const state = collectStoreState(storeId);
  await replaceAppStateRow(storeId, state);
  return true;
}

async function downloadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  evictOtherStoreData(storeId);
  const rows = await restRequest('GET', `/rest/v1/app_state?select=state&store_id=eq.${encodeURIComponent(storeId)}&limit=1`, session.access_token);
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (row && row.state) applyStoreState(row.state);
  return !!(row && row.state);
}

async function uploadAllStores() {
  const results = [];
  const allowed = await getAllowedStoreIds();
  const storeIds = allowed.length ? allowed : ALL_STORE_IDS;
  for (const storeId of storeIds) {
    if (!hasLocalDataForStore(storeId)) continue;
    await uploadStore(storeId);
    results.push(STORE_LABELS[storeId] || storeId);
  }
  if (results.length === 0) {
    throw new Error('Keine lokalen Daten gefunden. Upload abgebrochen.');
  }
  return results;
}

async function downloadAllStores() {
  await downloadStore(getStoreId());
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

async function refreshCloudUI() {
  let session = null;
  try {
    session = await getSession();
  } catch (e) {}
  const isLoggedIn = !!session;
  setText('cloudStatus', isLoggedIn ? `Angemeldet: ${getSessionUserEmail(session)}` : 'Nicht angemeldet');
  setVisible('cloudLoginRow', !isLoggedIn);
  setVisible('cloudLoggedInRow', isLoggedIn);
  setVisible('cloudActionsRow', isLoggedIn);
}

function setCloudErr(msg) {
  const errEl = document.getElementById('cloudError');
  if (!errEl) return;
  errEl.textContent = msg || '';
  errEl.style.display = msg ? 'block' : 'none';
}

function setCloudOk(msg) {
  const okEl = document.getElementById('cloudOk');
  if (!okEl) return;
  okEl.textContent = msg || '';
  okEl.style.display = msg ? 'block' : 'none';
}

async function autoLoadCurrentStore() {
  const session = await getSession();
  if (!session) return { skipped: true, found: false, storeId: getStoreId() };
  const storeId = getStoreId();
  const found = await downloadStore(storeId);
  return { skipped: false, found, storeId };
}

async function autoLoadAllStores() {
  const session = await getSession();
  if (!session) return { skipped: true };
  await downloadAllStores();
  return { skipped: false };
}

function bindCloudUI() {
  const loginBtn = document.getElementById('cloudLoginBtn');
  const logoutBtn = document.getElementById('cloudLogoutBtn');
  const uploadStoreBtn = document.getElementById('cloudUploadStoreBtn');
  const uploadAllBtn = document.getElementById('cloudUploadAllBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      setCloudErr('');
      setCloudOk('');
      const email = (document.getElementById('cloudEmail')?.value || '').trim();
      const password = (document.getElementById('cloudPassword')?.value || '').trim();
      if (!email || !password) {
        setCloudErr('Bitte E-Mail und Passwort eingeben.');
        return;
      }
      try {
        await signIn(email, password);
        await refreshCloudUI();
        setCloudOk('Angemeldet. Lade Standort…');
        const current = await autoLoadCurrentStore();
        setCloudOk(current.found
          ? `Angemeldet. Geladen: ${STORE_LABELS[current.storeId] || current.storeId}.`
          : `Angemeldet. Keine Cloud-Daten für ${STORE_LABELS[current.storeId] || current.storeId}.`);
      } catch (e) {
        setCloudErr(e && e.message ? e.message : 'Anmeldung fehlgeschlagen.');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      setCloudErr('');
      setCloudOk('');
      try {
        await signOut();
        if (document.getElementById('hubTitle')) {
          location.replace('index.html');
          return;
        }
        setCloudOk('Abgemeldet.');
        await refreshCloudUI();
      } catch (e) {
        setCloudErr(e && e.message ? e.message : 'Abmeldung fehlgeschlagen.');
      }
    });
  }

  if (uploadStoreBtn) {
    uploadStoreBtn.addEventListener('click', async () => {
      setCloudErr('');
      setCloudOk('');
      try {
        const storeId = getStoreId();
        if (!confirm(`Cloud-Daten für "${storeId}" werden komplett durch die Daten dieses Geräts ersetzt. Fortfahren?`)) return;
        await uploadStore(storeId);
        const found = await downloadStore(storeId);
        setCloudOk(found
          ? `Gespeichert und geladen: ${STORE_LABELS[storeId] || storeId}.`
          : `Gespeichert: ${STORE_LABELS[storeId] || storeId}.`);
      } catch (e) {
        setCloudErr(e && e.message ? e.message : 'Upload fehlgeschlagen.');
      }
    });
  }

  if (uploadAllBtn) {
    uploadAllBtn.addEventListener('click', async () => {
      setCloudErr('');
      setCloudOk('');
      try {
        if (!confirm('Cloud-Daten werden komplett durch die Daten dieses Geräts ersetzt (nur wo lokale Daten vorhanden sind). Fortfahren?')) return;
        const uploadedStores = await uploadAllStores();
        const storeId = getStoreId();
        await downloadStore(storeId);
        setCloudOk(`Gespeichert: ${uploadedStores.join(', ')}. Geladen: ${STORE_LABELS[storeId] || storeId}.`);
      } catch (e) {
        setCloudErr(e && e.message ? e.message : 'Upload fehlgeschlagen.');
      }
    });
  }
}

window.cloud = {
  signIn,
  signOut,
  getSession,
  getSessionUserEmail,
  getAllowedStoreIds,
  uploadStore,
  downloadStore,
  uploadAllStores,
  downloadAllStores,
  autoLoadCurrentStore,
  autoLoadAllStores,
  STORE_LABELS,
  ALL_STORE_IDS
};

document.addEventListener('DOMContentLoaded', async () => {
  const onHub = /hub\.html$/i.test(location.pathname) || document.getElementById('hubTitle');
  if (onHub) {
    try {
      const session = await getSession();
      if (!session) {
        location.replace('index.html');
        return;
      }
      const allowed = await getAllowedStoreIds();
      if (!allowed.includes(getStoreId())) {
        location.replace('index.html');
        return;
      }
    } catch (e) {
      location.replace('index.html');
      return;
    }
  }
  if (!document.getElementById('cloudStatus')) return;
  bindCloudUI();
  await refreshCloudUI();
  try {
    const session = await getSession();
    if (!session) return;
    setCloudOk('Lade Standort…');
    const current = await autoLoadCurrentStore();
    setCloudOk(current.found
      ? `Geladen: ${STORE_LABELS[current.storeId] || current.storeId}.`
      : `Keine Cloud-Daten für ${STORE_LABELS[current.storeId] || current.storeId}.`);
  } catch (e) {
    setCloudErr(e && e.message ? e.message : 'Automatisches Laden fehlgeschlagen.');
  }
});
