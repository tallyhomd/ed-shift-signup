/* ============================================================
   Clinician Shift Sign-Up — Nov 2026 through Feb 2027
   Weekday shift board. Data lives in a GitHub repository file.
   ============================================================ */

'use strict';

const CONFIG = {
  owner: 'tallyhomd',
  repo: 'ed-shift-signup', // public site code
  dataRepo: 'ed-shift-signup-data', // private schedule data
  branch: 'main',
  file: 'data.json',
  // Access token (reversed + base64) is added once the site is
  // connected. Empty = preview mode: full UI, nothing saved.
  tokenEnc: '',
  months: [
    { y: 2026, m: 10 },
    { y: 2026, m: 11 },
    { y: 2027, m: 0 },
    { y: 2027, m: 1 },
  ],
  defaultStart: '11:00',
  defaultEnd: '21:00',
};

const HOLIDAYS = {
  '2026-11-26': 'Thanksgiving',
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
  '2026-12-25': 'Christmas Day',
  '2026-12-31': "New Year's Eve",
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'MLK Day',
  '2027-02-15': "Presidents' Day",
};

/* ---------- State ---------- */

const state = {
  data: { signups: {} },
  monthIdx: 0,
  lastSync: null,
  loadError: false,
  editing: null, // { dateKey, entryId } when editing
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- Helpers ---------- */

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${pad(m)}${ampm}`;
}

function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* sandboxed — ignore */
  }
}

function token() {
  if (!CONFIG.tokenEnc) return null;
  try {
    return atob(CONFIG.tokenEnc).split('').reverse().join('');
  } catch {
    return null;
  }
}
const isLive = () => Boolean(token());

/* ---------- Storage layer ---------- */

function seedData() {
  return { signups: {} };
}

async function loadData() {
  // In preview mode there is no server truth yet — keep local changes.
  if (!isLive()) {
    const cached = safeGet('shift-cache');
    if (cached) {
      try {
        state.data = JSON.parse(cached);
        return;
      } catch {
        /* fall through */
      }
    }
    state.data = seedData();
    return;
  }
  try {
    const { data } = await ghGetFile();
    state.data = data && typeof data === 'object' && data.signups ? data : seedData();
    state.lastSync = new Date();
    state.loadError = false;
    cacheLocally();
  } catch (err) {
    const cached = safeGet('shift-cache');
    if (cached) {
      try {
        state.data = JSON.parse(cached);
      } catch {
        state.data = seedData();
      }
    } else {
      state.data = seedData();
    }
    state.loadError = true;
  }
}

function cacheLocally() {
  safeSet('shift-cache', JSON.stringify(state.data));
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function b64decodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function ghGetFile() {
  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.dataRepo}/contents/${CONFIG.file}?ref=${CONFIG.branch}`,
    {
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const json = await res.json();
  return { data: JSON.parse(b64decodeUtf8(json.content)), sha: json.sha };
}

async function ghPutFile(data, sha) {
  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.dataRepo}/contents/${CONFIG.file}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({
        message: 'Update shift sign-ups',
        content: b64encodeUtf8(JSON.stringify(data, null, 2)),
        sha: sha,
        branch: CONFIG.branch,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `GitHub write failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.content.sha;
}

/* Apply a change and persist it. `mutator(data)` edits a data object in place. */
async function persist(mutator) {
  if (!isLive()) {
    mutator(state.data);
    cacheLocally();
    render();
    toast('Preview mode — sign-up not saved yet');
    return;
  }

  setSyncStatus('Saving…');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data, sha } = await ghGetFile();
      mutator(data);
      const newSha = await ghPutFile(data, sha);
      state.data = data;
      state.lastSync = new Date();
      cacheLocally();
      render();
      toast('Saved');
      return;
    } catch (err) {
      if (err.status === 409 || err.status === 422) continue; // someone saved first — retry with their version
      setSyncStatus('Could not reach GitHub — check your connection', true);
      toast('Could not save — please try again');
      return;
    }
  }
  toast('Someone just updated the schedule — please try again');
}

/* ---------- Rendering ---------- */

const MONTH_NAMES = (y, m) =>
  new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });

function renderMonthTabs() {
  const nav = $('#month-tabs');
  nav.innerHTML = '';
  CONFIG.months.forEach((mo, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'month-tab';
    btn.textContent = MONTH_NAMES(mo.y, mo.m);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === state.monthIdx);
    btn.addEventListener('click', () => {
      state.monthIdx = i;
      render();
    });
    nav.appendChild(btn);
  });
}

function monthCells(y, m) {
  // Monday-first weekday grid: returns rows of 5 (Mon-Fri)
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // 0 = Monday
  const cells = [];
  const cursor = new Date(y, m, 1 - lead);
  const totalDays = new Date(y, m + 1, 0).getDate();
  const rows = Math.ceil((lead + totalDays) / 7);
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push({
        y: cursor.getFullYear(),
        m: cursor.getMonth(),
        d: cursor.getDate(),
        key: iso(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
        out: cursor.getMonth() !== m,
        weekend: cursor.getDay() === 0 || cursor.getDay() === 6,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    cells.push(row.filter((c) => !c.weekend)); // Mon-Fri only
  }
  return cells;
}

function todayKey() {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
}

function entryTimesLabel(entry) {
  if (entry.start === CONFIG.defaultStart && entry.end === CONFIG.defaultEnd) return null;
  return `${fmtTime(entry.start)} – ${fmtTime(entry.end)}`;
}

function renderCalendar() {
  const { y, m } = CONFIG.months[state.monthIdx];
  const wrap = $('#calendar');
  wrap.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', `${MONTH_NAMES(y, m)} shift calendar`);

  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((d) => {
    const h = document.createElement('div');
    h.className = 'cal-headcell';
    h.textContent = d;
    grid.appendChild(h);
  });

  const today = todayKey();
  for (const row of monthCells(y, m)) {
    for (const cell of row) {
      if (cell.out) {
        const div = document.createElement('div');
        div.className = 'cal-cell out';
        div.innerHTML = `<span class="cal-out-label">${new Date(cell.y, cell.m, cell.d).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>`;
        grid.appendChild(div);
        continue;
      }

      const entries = (state.data.signups[cell.key] || []).slice().sort((a, b) => a.start.localeCompare(b.start));
      const cellEl = document.createElement('article');
      cellEl.className = 'cal-cell' + (cell.key === today ? ' today' : '') + (entries.length ? ' covered' : '');
      cellEl.setAttribute('role', 'gridcell');

      const holiday = HOLIDAYS[cell.key];
      cellEl.innerHTML = `
        <div class="cal-top">
          <span class="cal-daynum">${new Date(cell.y, cell.m, cell.d).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</span>
          ${holiday ? `<span class="cal-holiday">${holiday}</span>` : ''}
        </div>
        <span class="cal-shift">${fmtTime(CONFIG.defaultStart)} – ${fmtTime(CONFIG.defaultEnd)}</span>
        <div class="cal-signups"></div>
        <button type="button" class="cal-signup-btn" data-date="${cell.key}">+ Sign up</button>
      `;

      const list = cellEl.querySelector('.cal-signups');
      if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'signup-note';
        empty.textContent = 'Open';
        list.appendChild(empty);
      } else {
        for (const entry of entries) {
          const rowEl = document.createElement('div');
          rowEl.className = 'signup-row';
          const times = entryTimesLabel(entry);
          rowEl.innerHTML = `
            <span class="signup-name"></span>
            <span class="signup-actions">
              <button type="button" class="signup-edit" aria-label="Edit sign-up for ${entry.name}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              <button type="button" class="signup-remove" aria-label="Remove sign-up for ${entry.name}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </span>
          `;
          rowEl.querySelector('.signup-name').textContent = entry.name;
          if (times) {
            const timeEl = document.createElement('span');
            timeEl.className = 'signup-time';
            timeEl.textContent = times;
            rowEl.appendChild(timeEl);
          }
          rowEl.querySelector('.signup-edit').addEventListener('click', () => openDialog(cell.key, entry.id));
          rowEl.querySelector('.signup-remove').addEventListener('click', () => {
            persist((data) => {
              data.signups[cell.key] = (data.signups[cell.key] || []).filter((e) => e.id !== entry.id);
              if (data.signups[cell.key].length === 0) delete data.signups[cell.key];
            });
          });
          list.appendChild(rowEl);
          if (entry.note) {
            const note = document.createElement('p');
            note.className = 'signup-note';
            note.textContent = entry.note;
            list.appendChild(note);
          }
        }
      }

      cellEl.querySelector('.cal-signup-btn').addEventListener('click', () => openDialog(cell.key));
      grid.appendChild(cellEl);
    }
  }

  wrap.appendChild(grid);
}

function setSyncStatus(text, isError = false) {
  const el = $('#sync-status');
  el.textContent = text;
  el.style.color = isError ? 'var(--color-danger)' : '';
}

function updateSyncStatus() {
  if (!isLive()) {
    setSyncStatus('Preview mode — sign-ups are not being saved yet');
    return;
  }
  if (state.loadError) {
    setSyncStatus('Offline — showing the last loaded schedule', true);
    return;
  }
  if (state.lastSync) {
    setSyncStatus(`Synced from GitHub at ${fmtClock(state.lastSync)}`);
  } else {
    setSyncStatus('Synced from GitHub');
  }
}

function renderNotices() {
  const el = $('#notice');
  if (!isLive()) {
    el.hidden = false;
    el.innerHTML = `<strong>Preview mode.</strong> Everything works, but sign-ups won't be saved until the schedule goes live.`;
  } else {
    el.hidden = true;
  }
}

function render() {
  renderMonthTabs();
  renderCalendar();
  renderNotices();
  updateSyncStatus();
}

/* ---------- Dialog ---------- */

const dialog = $('#signup-dialog');

function openDialog(dateKey, entryId = null) {
  state.editing = entryId ? { dateKey, entryId } : null;
  const entries = state.data.signups[dateKey] || [];
  const entry = entryId ? entries.find((e) => e.id === entryId) : null;

  $('#dialog-title').textContent = entry ? 'Edit sign-up' : 'Sign up';
  $('#dialog-date').textContent = fmtDayLabel(dateKey);
  $('#f-name').value = entry ? entry.name : '';
  $('#f-start').value = entry ? entry.start : CONFIG.defaultStart;
  $('#f-end').value = entry ? entry.end : CONFIG.defaultEnd;
  $('#f-note').value = entry ? entry.note || '' : '';
  $('#name-error').hidden = true;
  $('#time-error').hidden = true;

  const removeBtn = $('#remove-btn');
  removeBtn.hidden = !entry;
  removeBtn.textContent = 'Remove sign-up';
  removeBtn.dataset.armed = '';

  dialog.dataset.date = dateKey;
  dialog.showModal();
  if (!entry) $('#f-name').focus();
}

function closeDialog() {
  dialog.close();
}

$('#cancel-btn').addEventListener('click', closeDialog);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dialog.open) closeDialog();
});

$('#remove-btn').addEventListener('click', () => {
  const btn = $('#remove-btn');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Really remove?';
    setTimeout(() => {
      btn.dataset.armed = '';
      btn.textContent = 'Remove sign-up';
    }, 3000);
    return;
  }
  const { dateKey, entryId } = state.editing;
  closeDialog();
  persist((data) => {
    data.signups[dateKey] = (data.signups[dateKey] || []).filter((e) => e.id !== entryId);
    if (data.signups[dateKey].length === 0) delete data.signups[dateKey];
  });
});

$('#signup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const start = $('#f-start').value || CONFIG.defaultStart;
  const end = $('#f-end').value || CONFIG.defaultEnd;
  const note = $('#f-note').value.trim();

  const nameOk = Boolean(name);
  const timeOk = start < end;
  $('#name-error').hidden = nameOk;
  $('#time-error').hidden = timeOk;
  if (!nameOk || !timeOk) return;

  const dateKey = dialog.dataset.date;
  const editingId = state.editing ? state.editing.entryId : null;
  closeDialog();

  persist((data) => {
    if (!data.signups[dateKey]) data.signups[dateKey] = [];
    if (editingId) {
      const idx = data.signups[dateKey].findIndex((en) => en.id === editingId);
      if (idx >= 0) data.signups[dateKey][idx] = { ...data.signups[dateKey][idx], name, start, end, note };
    } else {
      data.signups[dateKey].push({ id: newId(), name, start, end, note, ts: Date.now() });
    }
  });
});

/* ---------- Toast, export, theme ---------- */

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shift-schedule-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#theme-toggle').innerHTML =
    theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
}

$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  safeSet('shift-theme', next);
});

/* ---------- Init ---------- */

(async function init() {
  applyTheme(safeGet('shift-theme') || 'dark');
  renderMonthTabs();
  $('#calendar').innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton-cell"></div>').join('');
  await loadData();
  cacheLocally();
  render();
})();
