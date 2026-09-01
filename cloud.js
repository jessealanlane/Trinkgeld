(function () {
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
  try {
    if (window.__store_id) return String(window.__store_id).toLowerCase();
  } catch (e) {}
  const urlStore = getStoreIdFromUrl();
  if (urlStore) return urlStore;
  try {
    const s = sessionStorage.getItem('current_store') || localStorage.getItem('current_store');
    return String(s || 'koeln').toLowerCase();
  } catch (e) {
    return String(window.__store_id || 'koeln').toLowerCase();
  }
}

const SESSION_STORAGE_KEY = 'cloud_supabase_session_v1';
const CLOUD_ADMIN_EMAIL = 'jessealanlane@gmail.com';
const nativeLocalStorage = window.localStorage;

function protoGet(key) {
  return Storage.prototype.getItem.call(nativeLocalStorage, key);
}
function protoSet(key, value) {
  return Storage.prototype.setItem.call(nativeLocalStorage, key, value);
}
function protoRem(key) {
  return Storage.prototype.removeItem.call(nativeLocalStorage, key);
}

let rawGet = protoGet;
let rawSet = protoSet;
let rawRem = protoRem;

function usesConstrainedWebKitStorage() {
  try {
    const ua = String(navigator.userAgent || '');
    const iOS = /iPhone|iPad|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
    const desktopSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPR|Android/i.test(ua);
    return iOS || desktopSafari;
  } catch (e) {
    return false;
  }
}

function isLargeCafeKey(key) {
  return /(^|_)(workEntries|dailyCalculations)$/.test(String(key || ''));
}

function isCafeStateKey(key) {
  const k = String(key || '');
  if (k === SESSION_STORAGE_KEY || k === 'current_store') return false;
  if (SHARED_KEYS && SHARED_KEYS.indexOf(k) !== -1) return true;
  return /^(koeln|bonn|apostelnstr|ehrenstr)_/.test(k);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function loadSession() {
  try {
    const raw = protoGet(SESSION_STORAGE_KEY);
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
      protoRem(SESSION_STORAGE_KEY);
      return;
    }
    protoSet(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
}

function getSessionUserEmail(session) {
  if (!session) return '';
  if (session.user && session.user.email) return String(session.user.email);
  if (session.user && session.user.user_metadata && session.user.user_metadata.email) return String(session.user.user_metadata.email);
  return '';
}

function isCloudAdmin(session) {
  return getSessionUserEmail(session).trim().toLowerCase() === CLOUD_ADMIN_EMAIL;
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

async function restRequest(method, pathWithQuery, accessToken, bodyObj, extraHeaders) {
  const headers = {
    apikey: SUPABASE_ANON_KEY
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && String(pathWithQuery || '').indexOf('/rpc/') === -1) {
    headers.Prefer = 'return=minimal';
  }
  if (extraHeaders && typeof extraHeaders === 'object') {
    Object.keys(extraHeaders).forEach(function (key) {
      if (extraHeaders[key] != null) headers[key] = extraHeaders[key];
    });
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

  if (method === 'GET' || String(pathWithQuery || '').indexOf('/rpc/') !== -1) {
    return await res.json().catch(() => null);
  }
  return null;
}

function parseStoredJsonObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return {};
}

function mergeStoredJsonObjects(cloudRaw, localRaw) {
  const cloudObj = parseStoredJsonObject(cloudRaw);
  const localObj = parseStoredJsonObject(localRaw);
  const merged = Object.assign({}, cloudObj);
  Object.keys(localObj).forEach(function (date) {
    const incoming = localObj[date];
    const current = merged[date];
    if (current == null) {
      merged[date] = incoming;
      return;
    }
    const inTs = incoming && typeof incoming === 'object' ? String(incoming.timestamp || '') : '';
    const curTs = current && typeof current === 'object' ? String(current.timestamp || '') : '';
    if (inTs && (!curTs || inTs >= curTs)) {
      merged[date] = incoming;
    }
  });
  return JSON.stringify(merged);
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

const WORK_ENTRY_PAGE = 1000;

function toWorkEntryRow(storeId, entry, deleted) {
  const payload = entry && typeof entry === 'object' ? entry : {};
  const entryId = String(payload.timestamp || '').trim();
  const workDate = String(payload.workDate || '').trim();
  if (!entryId || !workDate) throw new Error('Schicht ohne Datum oder ID.');
  return {
    store_id: String(storeId || getStoreId() || 'koeln').toLowerCase(),
    entry_id: entryId,
    work_date: workDate,
    payload: payload,
    updated_at: new Date().toISOString(),
    deleted_at: deleted ? new Date().toISOString() : null
  };
}

async function fetchWorkEntries(storeId, workDate) {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth', entries: [] };
  const sid = encodeURIComponent(String(storeId || getStoreId() || 'koeln').toLowerCase());
  let path = `/rest/v1/work_entries?store_id=eq.${sid}&deleted_at=is.null&select=payload&order=updated_at.asc`;
  if (workDate) path += `&work_date=eq.${encodeURIComponent(String(workDate))}`;
  const entries = [];
  let offset = 0;
  while (true) {
    const rows = await restRequest(
      'GET',
      `${path}&limit=${WORK_ENTRY_PAGE}&offset=${offset}`,
      session.access_token
    );
    const page = Array.isArray(rows) ? rows : [];
    if (page.length === 0) break;
    const firstId = page[0] && page[0].payload && page[0].payload.timestamp;
    if (offset > 0 && firstId && entries.some(function (entry) { return entry.timestamp === firstId; })) break;
    page.forEach(function (row) {
      if (row && row.payload && typeof row.payload === 'object') entries.push(row.payload);
    });
    if (page.length < WORK_ENTRY_PAGE) break;
    offset += WORK_ENTRY_PAGE;
    if (offset > 50000) break;
  }
  return { ok: true, entries: entries };
}

async function upsertWorkEntry(storeId, entry) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const row = toWorkEntryRow(storeId, entry, false);
  await restRequest(
    'POST',
    '/rest/v1/work_entries?on_conflict=store_id,entry_id',
    session.access_token,
    row,
    { Prefer: 'resolution=merge-duplicates,return=minimal' }
  );
  return true;
}

async function upsertWorkEntries(storeId, entries) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const rows = [];
  (Array.isArray(entries) ? entries : []).forEach(function (entry) {
    try { rows.push(toWorkEntryRow(storeId, entry, false)); } catch (e) {}
  });
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    await restRequest(
      'POST',
      '/rest/v1/work_entries?on_conflict=store_id,entry_id',
      session.access_token,
      rows.slice(i, i + batchSize),
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );
  }
  return rows.length;
}

async function deleteWorkEntry(storeId, entryId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const sid = encodeURIComponent(String(storeId || getStoreId() || 'koeln').toLowerCase());
  const eid = encodeURIComponent(String(entryId || ''));
  await restRequest(
    'PATCH',
    `/rest/v1/work_entries?store_id=eq.${sid}&entry_id=eq.${eid}`,
    session.access_token,
    { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  );
  return true;
}

async function deleteWorkEntriesForDate(storeId, workDate) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const sid = encodeURIComponent(String(storeId || getStoreId() || 'koeln').toLowerCase());
  await restRequest(
    'PATCH',
    `/rest/v1/work_entries?store_id=eq.${sid}&work_date=eq.${encodeURIComponent(String(workDate || ''))}&deleted_at=is.null`,
    session.access_token,
    { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  );
  return true;
}

async function seedWorkEntriesIfEmpty(storeId, entries) {
  const existing = await fetchWorkEntries(storeId);
  if (!existing.ok) return { ok: false, seeded: 0 };
  if (existing.entries.length > 0) return { ok: true, seeded: 0 };
  const seeded = await upsertWorkEntries(storeId, entries);
  return { ok: true, seeded: seeded };
}

async function fetchDeletedWorkEntryIds(storeId) {
  const session = await getSession();
  if (!session) return [];
  const sid = encodeURIComponent(String(storeId || getStoreId() || 'koeln').toLowerCase());
  const path = `/rest/v1/work_entries?store_id=eq.${sid}&deleted_at=not.is.null&select=entry_id`;
  const ids = [];
  let offset = 0;
  while (true) {
    const rows = await restRequest(
      'GET',
      `${path}&limit=${WORK_ENTRY_PAGE}&offset=${offset}`,
      session.access_token
    );
    const page = Array.isArray(rows) ? rows : [];
    if (page.length === 0) break;
    page.forEach(function (row) {
      if (row && row.entry_id) ids.push(String(row.entry_id));
    });
    if (page.length < WORK_ENTRY_PAGE) break;
    offset += WORK_ENTRY_PAGE;
    if (offset > 50000) break;
  }
  return ids;
}

function parseStoredWorkEntries(storeId, keys) {
  const sid = String(storeId || 'koeln').toLowerCase();
  const raw = sid === 'koeln'
    ? (keys && keys.workEntries)
    : ((keys && (keys[sid + '_workEntries'] || keys.workEntries)) || null);
  if (raw == null) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function pushMissingWorkEntries(storeId, entries) {
  const existing = await fetchWorkEntries(storeId);
  if (!existing.ok) return 0;
  const have = {};
  existing.entries.forEach(function (entry) {
    if (entry && entry.timestamp) have[String(entry.timestamp)] = true;
  });
  const missing = (Array.isArray(entries) ? entries : []).filter(function (entry) {
    return entry && entry.timestamp && !have[String(entry.timestamp)];
  });
  if (!missing.length) return 0;
  await upsertWorkEntries(storeId, missing);
  return missing.length;
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

const TIPS_SYNC_KEYS = ['tipData', 'dailyCalculations', 'lockedTips'];

const SETTINGS_SYNC_KEYS = [
  'departments',
  'tipPaymentPeriods',
  'kitchenProcedureSettings',
  'spuelerProcedureSettings',
  'baristaProcedureSettings',
  'tipProcedurePeriods',
  'punctuality_enabled',
  'punctualityPeriods',
  'tipProcedureSettings',
  'accessControlSettings'
];

const STORE_SPECIFIC_SYNC_KEYS = [
  'koeln_employees',
  'koeln_personalTipsTimeout',
  'koeln_lastWorkDate'
];

function autoSyncStorageKeys(storeId) {
  return TIPS_SYNC_KEYS.concat(SETTINGS_SYNC_KEYS).concat(STORE_SPECIFIC_SYNC_KEYS);
}

function appStateStorageKey(storeId, key) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  if (key.startsWith('koeln_')) {
    return sid === 'koeln' ? key : key.replace(/^koeln_/, `${sid}_`);
  }
  if (SHARED_KEYS.indexOf(key) !== -1) {
    return sid === 'koeln' ? key : `${sid}_${key}`;
  }
  return key;
}

function tipStorageKey(storeId, key) {
  return appStateStorageKey(storeId, key);
}

function localAppStateRevisionStorageKey(storeId) {
  return `${String(storeId || getStoreId() || 'koeln').toLowerCase()}_app_state_local_revision`;
}

function localTipRevisionStorageKey(storeId) {
  return `${String(storeId || getStoreId() || 'koeln').toLowerCase()}_app_state_local_tip_revision`;
}

function markLocalAppStateModified(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const now = new Date().toISOString();
  try {
    localStorage.setItem(localAppStateRevisionStorageKey(sid), now);
  } catch (e) {}
}

function markLocalAppStateSynced(storeId, syncedAt) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const value = syncedAt || new Date().toISOString();
  try {
    localStorage.setItem(localAppStateRevisionStorageKey(sid), value);
  } catch (e) {}
}

function markLocalTipStateModified(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const now = new Date().toISOString();
  try {
    localStorage.setItem(localTipRevisionStorageKey(sid), now);
  } catch (e) {}
}

function markLocalTipStateSynced(storeId, syncedAt) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const value = syncedAt || new Date().toISOString();
  try {
    localStorage.setItem(localTipRevisionStorageKey(sid), value);
  } catch (e) {}
}

function getLocalAppStateRevision(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  try {
    return localStorage.getItem(localAppStateRevisionStorageKey(sid)) || '';
  } catch (e) {
    return '';
  }
}

function getLocalTipStateRevision(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  try {
    return localStorage.getItem(localTipRevisionStorageKey(sid)) || '';
  } catch (e) {
    return '';
  }
}

function getCloudStateTimestamp(cloudRow, cloudState) {
  if (cloudState && cloudState.exportedAt) return String(cloudState.exportedAt);
  if (cloudRow && cloudRow.updated_at) return String(cloudRow.updated_at);
  return '';
}

function isLocalAppStateNewerThanCloud(storeId, cloudRow, cloudState) {
  const localRev = getLocalAppStateRevision(storeId);
  if (!localRev) return false;
  const cloudTs = getCloudStateTimestamp(cloudRow, cloudState);
  if (!cloudTs) return true;
  const localMs = Date.parse(localRev);
  const cloudMs = Date.parse(cloudTs);
  if (Number.isNaN(localMs)) return false;
  if (Number.isNaN(cloudMs)) return true;
  return localMs > cloudMs;
}

function isLocalTipStateNewerThanCloud(storeId, cloudRow, cloudState) {
  return isLocalAppStateNewerThanCloud(storeId, cloudRow, cloudState);
}

function readLocalStorageKeys(storeId) {
  const out = {};
  storeKeySetFor(storeId).forEach(function (k) {
    try {
      const v = rawGet(k);
      if (v !== null && v !== undefined) out[k] = v;
    } catch (e) {}
  });
  return out;
}

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

function installConstrainedStorageShim() {
  if (!usesConstrainedWebKitStorage()) return;
  const memory = {};

  ALL_STORE_IDS.forEach(function (id) {
    storeKeySetFor(id).forEach(function (k) {
      if (!isLargeCafeKey(k)) return;
      try {
        const v = protoGet(k);
        if (v !== null && v !== undefined) memory[k] = v;
        protoRem(k);
      } catch (e) {}
    });
  });

  rawGet = function (key) {
    const k = String(key);
    if (isCafeStateKey(k)) {
      if (Object.prototype.hasOwnProperty.call(memory, k)) return memory[k];
      try {
        return protoGet(k);
      } catch (e) {
        return null;
      }
    }
    return protoGet(k);
  };
  rawSet = function (key, value) {
    const k = String(key);
    if (isCafeStateKey(k)) {
      if (value == null) {
        delete memory[k];
        try { protoRem(k); } catch (e) {}
        return;
      }
      const str = String(value);
      memory[k] = str;
      if (!isLargeCafeKey(k)) {
        try { protoSet(k, str); } catch (e) {}
      }
      return;
    }
    return protoSet(k, value);
  };
  rawRem = function (key) {
    const k = String(key);
    if (isCafeStateKey(k)) {
      delete memory[k];
      try { protoRem(k); } catch (e) {}
      return;
    }
    return protoRem(k);
  };

  localStorage.getItem = function (key) {
    return rawGet(key);
  };
  localStorage.setItem = function (key, value) {
    return rawSet(key, value);
  };
  localStorage.removeItem = function (key) {
    return rawRem(key);
  };
  window.__constrainedWebKitStorage = true;
}

installConstrainedStorageShim();

function valueToStorageString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function collectStoreState(storeId) {
  const keys = storeKeySetFor(storeId);
  const values = {};
  keys.forEach(k => {
    try {
      const v = rawGet(k);
      if (v !== null && v !== undefined) values[k] = v;
    } catch (e) {}
  });
  return { version: 1, storeId, keys: values, exportedAt: new Date().toISOString() };
}

function hasLocalDataForStore(storeId) {
  const keys = storeKeySetFor(storeId);
  for (const k of keys) {
    try {
      const v = rawGet(k);
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
      try { rawRem(k); } catch (e) {}
    });
  });
}

function applyStoreState(state) {
  if (!state || !state.keys || typeof state.keys !== 'object') return;
  const storeId = String((state && state.storeId) || getStoreId() || 'koeln').toLowerCase();
  evictOtherStoreData(storeId);
  Object.entries(state.keys).forEach(([k, v]) => {
    try {
      const str = valueToStorageString(v);
      if (str === null) {
        rawRem(k);
      } else {
        rawSet(k, str);
      }
    } catch (e) {}
  });
}

function applyStoreStateWithLocalMerge(storeId, cloudState, cloudRow) {
  if (!cloudState || !cloudState.keys || typeof cloudState.keys !== 'object') {
    return { keptLocalChanges: false, applied: false };
  }
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  let session = null;
  try {
    session = loadSession();
  } catch (e) {}
  const keepLocalSettings = isCloudAdmin(session) && isLocalAppStateNewerThanCloud(sid, cloudRow, cloudState);
  const localSnapshot = readLocalStorageKeys(sid);
  const mergedKeys = { ...cloudState.keys };

  TIPS_SYNC_KEYS.forEach(function (key) {
    const storageKey = appStateStorageKey(sid, key);
    const localRaw = localSnapshot[storageKey];
    if (localRaw === undefined) return;
    if (key === 'lockedTips') {
      const cloudLocks = parseStoredJsonObject(cloudState.keys[storageKey]);
      const localLocks = parseStoredJsonObject(localRaw);
      mergedKeys[storageKey] = JSON.stringify(usesConstrainedWebKitStorage()
        ? Object.assign({}, localLocks, cloudLocks)
        : Object.assign({}, cloudLocks, localLocks));
    } else {
      mergedKeys[storageKey] = mergeStoredJsonObjects(cloudState.keys[storageKey], localRaw);
    }
  });

  if (keepLocalSettings) {
    SETTINGS_SYNC_KEYS.concat(STORE_SPECIFIC_SYNC_KEYS).forEach(function (key) {
      const storageKey = appStateStorageKey(sid, key);
      if (localSnapshot[storageKey] !== undefined) {
        mergedKeys[storageKey] = localSnapshot[storageKey];
      }
    });
  }

  applyStoreState({
    version: cloudState.version || 1,
    storeId: cloudState.storeId || sid,
    keys: mergedKeys,
    exportedAt: cloudState.exportedAt
  });
  if (!keepLocalSettings) {
    markLocalAppStateSynced(sid, getCloudStateTimestamp(cloudRow, cloudState));
  }
  return { keptLocalChanges: keepLocalSettings, applied: true };
}

function applyStoreStateWithLocalTipMerge(storeId, cloudState, cloudRow) {
  const result = applyStoreStateWithLocalMerge(storeId, cloudState, cloudRow);
  return {
    keptLocalTips: result.keptLocalChanges,
    keptLocalChanges: result.keptLocalChanges,
    applied: result.applied
  };
}

async function upsertAppStateRow(storeId, state) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const encodedStoreId = encodeURIComponent(sid);
  const row = { store_id: sid, state: state, updated_at: new Date().toISOString() };
  const existing = await restRequest(
    'GET',
    `/rest/v1/app_state?select=store_id&store_id=eq.${encodedStoreId}&limit=1`,
    session.access_token
  );
  if (Array.isArray(existing) && existing.length > 0) {
    await restRequest('PATCH', `/rest/v1/app_state?store_id=eq.${encodedStoreId}`, session.access_token, row);
  } else {
    await restRequest('POST', '/rest/v1/app_state', session.access_token, row);
  }
  return true;
}

async function collectSettingsKeyPayload(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const localCollected = collectStoreState(sid);
  const keys = {};
  SETTINGS_SYNC_KEYS.concat(STORE_SPECIFIC_SYNC_KEYS).forEach(function (logical) {
    const storageKey = appStateStorageKey(sid, logical);
    if (localCollected.keys[storageKey] !== undefined) {
      keys[logical] = localCollected.keys[storageKey];
    }
  });
  return keys;
}

async function syncSettingsStateToCloud(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth' };

  const allowed = await getAllowedStoreIds();
  if (allowed.length && !allowed.includes(sid)) return { ok: false, reason: 'access' };

  const result = await restRequest(
    'POST',
    '/rest/v1/rpc/merge_store_settings_keys',
    session.access_token,
    {
      p_store_id: sid,
      p_keys: await collectSettingsKeyPayload(sid)
    }
  );

  const exportedAt = result && result.exportedAt ? result.exportedAt : new Date().toISOString();
  markLocalAppStateSynced(sid, exportedAt);
  return { ok: true, exportedAt: exportedAt };
}

async function syncAppStateToCloud(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth' };

  const allowed = await getAllowedStoreIds();
  if (allowed.length && !allowed.includes(sid)) return { ok: false, reason: 'access' };

  if (!isCloudAdmin(session)) {
    return syncSettingsStateToCloud(sid);
  }

  const rows = await restRequest(
    'GET',
    `/rest/v1/app_state?select=state,updated_at&store_id=eq.${encodeURIComponent(sid)}&limit=1`,
    session.access_token
  );
  const cloudRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const cloudState = cloudRow && cloudRow.state ? cloudRow.state : { version: 1, storeId: sid, keys: {} };
  const cloudKeys = cloudState.keys && typeof cloudState.keys === 'object' ? cloudState.keys : {};
  const localCollected = collectStoreState(sid);
  const mergedKeys = { ...cloudKeys };

  autoSyncStorageKeys(sid).forEach(function (key) {
    const storageKey = appStateStorageKey(sid, key);
    if (localCollected.keys[storageKey] === undefined) return;
    if (TIPS_SYNC_KEYS.indexOf(key) !== -1) {
      mergedKeys[storageKey] = mergeStoredJsonObjects(cloudKeys[storageKey], localCollected.keys[storageKey]);
    } else {
      mergedKeys[storageKey] = localCollected.keys[storageKey];
    }
  });

  const newState = {
    version: 1,
    storeId: sid,
    keys: mergedKeys,
    exportedAt: new Date().toISOString()
  };

  await upsertAppStateRow(sid, newState);
  markLocalAppStateSynced(sid, newState.exportedAt);
  return { ok: true, exportedAt: newState.exportedAt };
}

async function syncTipStateToCloud(storeId) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth' };

  const allowed = await getAllowedStoreIds();
  if (allowed.length && !allowed.includes(sid)) return { ok: false, reason: 'access' };

  const localCollected = collectStoreState(sid);
  const tipKey = appStateStorageKey(sid, 'tipData');
  const calcKey = appStateStorageKey(sid, 'dailyCalculations');
  const lockKey = appStateStorageKey(sid, 'lockedTips');

  const result = await restRequest(
    'POST',
    '/rest/v1/rpc/merge_store_tip_keys',
    session.access_token,
    {
      p_store_id: sid,
      p_tip_data: parseStoredJsonObject(localCollected.keys[tipKey]),
      p_daily_calculations: parseStoredJsonObject(localCollected.keys[calcKey]),
      p_locked_tips: parseStoredJsonObject(localCollected.keys[lockKey])
    }
  );

  const exportedAt = result && result.exportedAt ? result.exportedAt : new Date().toISOString();
  markLocalTipStateSynced(sid, exportedAt);
  return { ok: true, exportedAt: exportedAt };
}

async function uploadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  if (!isCloudAdmin(session)) throw new Error('Nur der Administrator darf Cloud-Daten speichern.');
  if (!hasLocalDataForStore(storeId)) {
    throw new Error(`Keine lokalen Daten für ${storeId} gefunden. Upload abgebrochen.`);
  }
  const state = collectStoreState(storeId);
  await replaceAppStateRow(storeId, state);
  markLocalAppStateSynced(storeId, state.exportedAt);
  try {
    await pushMissingWorkEntries(storeId, parseStoredWorkEntries(storeId, state.keys));
  } catch (e) {}
  return true;
}

function applyStaffBundle(storeId, bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  let applied = false;
  function putStorage(storageKey, value) {
    if (value === null || value === undefined) return;
    if (isLargeCafeKey(storageKey)) return;
    const str = typeof value === 'string' ? value : valueToStorageString(value);
    if (str === null || str === '') return;
    rawSet(storageKey, str);
    applied = true;
  }
  function putLogical(logical, value) {
    putStorage(appStateStorageKey(sid, logical), value);
  }
  if (bundle.keys && typeof bundle.keys === 'object') {
    Object.keys(bundle.keys).forEach(function (k) {
      putStorage(k, bundle.keys[k]);
      const logical = String(k || '').replace(/^(koeln|bonn|apostelnstr|ehrenstr)_/, '');
      if (logical && logical !== k) {
        putStorage(appStateStorageKey(sid, logical), bundle.keys[k]);
      } else if (SHARED_KEYS.indexOf(k) !== -1) {
        putStorage(appStateStorageKey(sid, k), bundle.keys[k]);
      }
    });
  }
  putLogical('koeln_employees', bundle.employees);
  putLogical('koeln_lastWorkDate', bundle.lastWorkDate);
  putLogical('departments', bundle.departments);
  putLogical('koeln_personalTipsTimeout', bundle.timeout);
  putLogical('accessControlSettings', bundle.accessControl);
  return applied;
}

async function fetchStoreStaffBundle(storeId, session) {
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  try {
    const small = await restRequest(
      'POST',
      '/rest/v1/rpc/get_store_small_state',
      session.access_token,
      { p_store_id: sid }
    );
    if (small && small.keys) return small;
  } catch (e) {}
  return await restRequest(
    'POST',
    '/rest/v1/rpc/get_store_staff_bundle',
    session.access_token,
    { p_store_id: sid }
  );
}

async function fetchDayCalculation(storeId, workDate) {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth', calculation: null };
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const date = String(workDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'date', calculation: null };
  return await restRequest(
    'POST',
    '/rest/v1/rpc/get_store_day_calculation',
    session.access_token,
    { p_store_id: sid, p_work_date: date }
  );
}

async function clearStoreTipDay(storeId, workDate) {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'auth' };
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const date = String(workDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'date' };
  return await restRequest(
    'POST',
    '/rest/v1/rpc/clear_store_tip_day',
    session.access_token,
    { p_store_id: sid, p_work_date: date }
  );
}

function applyDayCalculation(storeId, workDate, calculation) {
  if (!workDate || calculation == null) return false;
  let parsed = calculation;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { return false; }
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  const key = appStateStorageKey(sid, 'dailyCalculations');
  const current = parseStoredJsonObject(rawGet(key));
  current[String(workDate)] = parsed;
  rawSet(key, JSON.stringify(current));
  return true;
}

async function downloadStore(storeId) {
  const session = await getSession();
  if (!session) throw new Error('Nicht angemeldet.');
  const sid = String(storeId || getStoreId() || 'koeln').toLowerCase();
  let found = false;

  try {
    const bundle = await fetchStoreStaffBundle(sid, session);
    if (applyStaffBundle(sid, bundle)) found = true;
  } catch (e) {}

  try {
    const rows = await restRequest(
      'GET',
      `/rest/v1/app_state?select=state,updated_at&store_id=eq.${encodeURIComponent(sid)}&limit=1`,
      session.access_token
    );
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (row && row.state) {
      const mergeResult = applyStoreStateWithLocalMerge(sid, row.state, row);
      if (mergeResult.keptLocalChanges && isCloudAdmin(session)) {
        try {
          await syncAppStateToCloud(sid);
        } catch (e) {}
      }
      found = true;
    }
  } catch (e) {
    if (!found) throw e;
  }
  try {
    const bundle = await fetchStoreStaffBundle(sid, session);
    if (applyStaffBundle(sid, bundle)) found = true;
  } catch (e) {}
  return found;
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
  const admin = isCloudAdmin(session);
  const panel = document.getElementById('cloudPanel');
  if (panel) panel.style.display = admin ? '' : 'none';
  setText('cloudStatus', isLoggedIn ? `Angemeldet: ${getSessionUserEmail(session)}` : 'Nicht angemeldet');
  setVisible('cloudLoginRow', !isLoggedIn && admin);
  setVisible('cloudLoggedInRow', isLoggedIn && admin);
  setVisible('cloudActionsRow', isLoggedIn && admin);
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

async function handleSignOutClick(event) {
  if (event) event.preventDefault();
  setCloudErr('');
  setCloudOk('');
  try {
    await signOut();
    location.replace('index.html');
  } catch (e) {
    setCloudErr(e && e.message ? e.message : 'Abmeldung fehlgeschlagen.');
  }
}

function bindCloudUI() {
  const loginBtn = document.getElementById('cloudLoginBtn');
  const logoutBtn = document.getElementById('cloudLogoutBtn');
  const hubLogoutLink = document.getElementById('hubLogoutLink');
  const uploadStoreBtn = document.getElementById('cloudUploadStoreBtn');
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

  if (logoutBtn) logoutBtn.addEventListener('click', handleSignOutClick);
  if (hubLogoutLink) hubLogoutLink.addEventListener('click', handleSignOutClick);

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
}

async function changePassword(oldPassword, newPassword, newPasswordRepeat) {
  const oldPw = String(oldPassword || '');
  const next = String(newPassword || '');
  const again = String(newPasswordRepeat || '');
  if (!oldPw || !next || !again) throw new Error('Bitte alle Felder ausfüllen.');
  if (next !== again) throw new Error('Die neuen Passwörter stimmen nicht überein.');
  if (next.length < 6) throw new Error('Das neue Passwort muss mindestens 6 Zeichen haben.');
  if (next === oldPw) throw new Error('Das neue Passwort muss sich vom aktuellen unterscheiden.');

  const session = await getSession();
  const email = getSessionUserEmail(session).trim();
  if (!session || !email) throw new Error('Nicht angemeldet.');

  let verified = null;
  try {
    verified = await signIn(email, oldPw);
  } catch (e) {
    throw new Error('Aktuelles Passwort ist falsch.');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${verified.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ password: next })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && (data.msg || data.message || data.error_description || data.error)
      ? (data.msg || data.message || data.error_description || data.error)
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  await signIn(email, next);
  return true;
}

function bindPasswordChangeUI() {
  const openBtn = document.getElementById('changePasswordBtn');
  const modal = document.getElementById('passwordModal');
  const saveBtn = document.getElementById('pwSaveBtn');
  const cancelBtn = document.getElementById('pwCancelBtn');
  const errEl = document.getElementById('pwError');
  const okEl = document.getElementById('pwOk');
  if (!openBtn || !modal) return;

  const oldEl = document.getElementById('pwOld');
  const newEl = document.getElementById('pwNew');
  const againEl = document.getElementById('pwNew2');

  function setPwErr(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.style.display = msg ? 'block' : 'none';
  }
  function setPwOk(msg) {
    if (!okEl) return;
    okEl.textContent = msg || '';
    okEl.style.display = msg ? 'block' : 'none';
  }
  function clearPwFields() {
    if (oldEl) oldEl.value = '';
    if (newEl) newEl.value = '';
    if (againEl) againEl.value = '';
    setPwErr('');
    setPwOk('');
  }
  function openPwModal() {
    clearPwFields();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (oldEl) oldEl.focus();
  }
  function closePwModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    clearPwFields();
  }

  openBtn.addEventListener('click', function (e) {
    e.preventDefault();
    openPwModal();
  });
  if (cancelBtn) cancelBtn.addEventListener('click', closePwModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closePwModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('open')) closePwModal();
  });
  if (againEl) {
    againEl.addEventListener('keydown', function (e) {
      if (e && e.key === 'Enter' && saveBtn) saveBtn.click();
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      setPwErr('');
      setPwOk('');
      saveBtn.disabled = true;
      try {
        await changePassword(oldEl && oldEl.value, newEl && newEl.value, againEl && againEl.value);
        setPwOk('Passwort wurde in der Cloud gespeichert.');
        setTimeout(closePwModal, 900);
      } catch (e) {
        setPwErr(e && e.message ? e.message : 'Passwort konnte nicht geändert werden.');
      } finally {
        saveBtn.disabled = false;
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
  downloadAllStores,
  autoLoadCurrentStore,
  autoLoadAllStores,
  syncAppStateToCloud,
  syncTipStateToCloud,
  markLocalAppStateModified,
  markLocalTipStateModified,
  fetchWorkEntries,
  upsertWorkEntry,
  upsertWorkEntries,
  deleteWorkEntry,
  deleteWorkEntriesForDate,
  seedWorkEntriesIfEmpty,
  pushMissingWorkEntries,
  fetchDeletedWorkEntryIds,
  fetchDayCalculation,
  applyDayCalculation,
  clearStoreTipDay,
  changePassword,
  rawGet,
  rawSet,
  STORE_LABELS,
  ALL_STORE_IDS
};

document.addEventListener('DOMContentLoaded', async () => {
  bindPasswordChangeUI();
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
      const switchLink = document.getElementById('switchStoreLink');
      if (switchLink && allowed.length > 1) {
        switchLink.style.display = '';
      }
    } catch (e) {
      location.replace('index.html');
      return;
    }
  }
  const hasCloudUI = !!document.getElementById('cloudStatus');
  const onTrinkgeld = /trinkgeld\.html$/i.test(location.pathname);
  if (!hasCloudUI && !onTrinkgeld) return;

  if (hasCloudUI) {
    bindCloudUI();
    await refreshCloudUI();
  }

  try {
    const session = await getSession();
    if (!session) return;
    const showStatus = hasCloudUI && isCloudAdmin(session);
    if (showStatus) setCloudOk('Lade Standort…');
    const current = await autoLoadCurrentStore();
    if (showStatus) {
      setCloudOk(current.found
        ? `Geladen: ${STORE_LABELS[current.storeId] || current.storeId}.`
        : `Keine Cloud-Daten für ${STORE_LABELS[current.storeId] || current.storeId}.`);
    }
  } catch (e) {
    if (hasCloudUI) {
      setCloudErr(e && e.message ? e.message : 'Automatisches Laden fehlgeschlagen.');
    }
  } finally {
    if (onTrinkgeld && typeof window.reloadTrinkgeldStoreState === 'function') {
      try { window.reloadTrinkgeldStoreState(); } catch (err) {}
    }
    if (onTrinkgeld && typeof window.flushTrinkgeldTipCloudSync === 'function') {
      try { window.flushTrinkgeldTipCloudSync(); } catch (err) {}
    }
  }
});
})();
