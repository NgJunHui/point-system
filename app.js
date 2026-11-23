(() => {
  'use strict';

  const STORAGE_KEY = 'team-shuffle:v1';
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 12;
  const MAX_POINTS = 99999;
  const AWARDS = [-1, 1, 2, 3];
  const TEAM_COLORS = 12; // number of --team-N dot colours defined in styles.css

  const ICON_MINUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h10M8 3v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const app = document.getElementById('app');
  const dialog = document.getElementById('confirm');
  const toastEl = document.getElementById('toast');

  /* ----------------------------------------------------------------
     State
     people: [{ id, name, points }]   points live on the person, so they survive reshuffles
     teams:  [[id, ...], ...]          current allocation, null while setting up
     awards: [n, ...]                  group points given to each team in the current game
  ----------------------------------------------------------------- */
  const emptyState = () => ({ draft: '', teamCount: 2, people: [], teams: null, awards: [], game: 1 });

  let state = load();

  const ui = {
    view: 'teams',      // 'teams' | 'standings'
    editing: false,     // editing players mid-session
    openId: null,       // member whose inline editor is open
    enter: false,       // play the card entrance on next render
    flash: new Map(),   // id -> 'up' | 'down' for the pulse on changed numbers
    flashTeam: null,
  };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object' && Array.isArray(saved.people)) {
        const s = { ...emptyState(), ...saved };
        const ids = new Set(s.people.map((p) => p.id));
        const teamsValid = Array.isArray(s.teams) && s.teams.every((t) => Array.isArray(t) && t.every((id) => ids.has(id)));
        if (!teamsValid) s.teams = null;
        if (s.teams && (!Array.isArray(s.awards) || s.awards.length !== s.teams.length)) s.awards = s.teams.map(() => 0);
        return s;
      }
    } catch { /* storage unavailable or corrupt: start fresh */ }
    return emptyState();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
  }

  /* ----------------------------------------------------------------
     Helpers
  ----------------------------------------------------------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
  const signed = (n) => (n > 0 ? `+${n}` : fmt(n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // 1 -> 1st, 2 -> 2nd, 11 -> 11th, 22 -> 22nd
  function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  }
  const teamName = (i) => `Team ${i + 1}`;
  const byId = (id) => state.people.find((p) => p.id === id);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSetup = () => !state.teams || ui.editing;
  const clampPoints = (n) => Math.max(-MAX_POINTS, Math.min(MAX_POINTS, n));

  function parseNames(text) {
    return text
      .split(/[\n,;\t]+/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function firstDuplicate(names) {
    const seen = new Set();
    for (const name of names) {
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) return name;
      seen.add(key);
    }
    return null;
  }

  const maxTeams = (n) => Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, n));
  const clampTeams = (k, n) => Math.min(Math.max(k, MIN_TEAMS), maxTeams(n));

  // 17 into 3 -> [6, 6, 5]
  function splitSizes(n, k) {
    const base = Math.floor(n / k);
    const extra = n % k;
    return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
  }

  function randInt(max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Deal shuffled players round-robin so team sizes never differ by more than one.
  function deal(ids, k) {
    const teams = Array.from({ length: k }, () => []);
    shuffle(ids).forEach((id, i) => teams[i % k].push(id));
    return teams;
  }

  /* ----------------------------------------------------------------
     Views
  ----------------------------------------------------------------- */
  function stepper(label) {
    return `
      <div class="stepper" role="group" aria-label="${label}">
        <button type="button" data-action="teams" data-delta="-1" data-key="teams-dec" aria-label="Fewer teams">${ICON_MINUS}</button>
        <button type="button" data-action="teams" data-delta="1" data-key="teams-inc" aria-label="More teams">${ICON_PLUS}</button>
      </div>`;
  }

  function setupView() {
    const editing = Boolean(ui.editing && state.teams);
    return `
      <section class="setup">
        <header class="hero">
          <h1 class="large-title">${editing ? 'Edit players' : 'Who’s playing?'}</h1>
          <p class="subtitle">${editing ? 'Points stay with each name. Teams get reshuffled.' : 'One name per line, or paste a list.'}</p>
        </header>

        <div class="group group-names">
          <label class="visually-hidden" for="names">Player names</label>
          <textarea id="names" class="names" data-key="names" spellcheck="false" autocomplete="off" autocapitalize="words"
            placeholder="Alex&#10;Sam&#10;Jordan&#10;…">${esc(state.draft)}</textarea>
          <div class="group-foot">
            <span data-out="count"></span>
            <span class="warn" data-out="dupe"></span>
          </div>
        </div>

        <div class="group">
          <div class="row">
            <span class="row-label">Teams</span>
            <span class="row-value" data-out="teams"></span>
            ${stepper('Number of teams')}
          </div>
          <div class="row">
            <span class="row-label">Team sizes</span>
            <span class="row-value" data-out="sizes"></span>
          </div>
        </div>

        <div class="setup-actions">
          <button type="button" class="btn-primary" data-action="make" data-key="make">${editing ? 'Shuffle teams' : 'Make teams'}</button>
          ${editing ? '<button type="button" class="btn-text" data-action="cancel-edit">Cancel</button>' : ''}
        </div>
      </section>`;
  }

  function playView() {
    const n = state.people.length;
    const k = state.teams.length;
    const index = ui.view === 'teams' ? 0 : 1;
    return `
      <section class="play">
        <header class="hero">
          <h1 class="large-title">Game ${state.game}</h1>
          <p class="subtitle">${plural(n, 'player')} · ${plural(k, 'team')}</p>
        </header>

        <div class="segmented" style="--index:${index}" role="group" aria-label="View">
          <span class="segmented-thumb" aria-hidden="true"></span>
          <button type="button" data-action="view" data-view="teams" data-key="view-teams" aria-pressed="${index === 0}">Teams</button>
          <button type="button" data-action="view" data-view="standings" data-key="view-standings" aria-pressed="${index === 1}">Standings</button>
        </div>

        <div class="panel" id="panel">${ui.view === 'teams' ? teamsView() : standingsView()}</div>

        <div class="actions">
          <div class="group">
            <div class="row">
              <span class="row-label">Teams next game</span>
              <span class="row-value" data-out="teams"></span>
              ${stepper('Teams next game')}
            </div>
          </div>
          <button type="button" class="btn-primary" data-action="next" data-key="next">Next game</button>
          <div class="text-actions">
            <button type="button" class="btn-text" data-action="edit">Edit players</button>
            <button type="button" class="btn-text is-danger" data-action="reset">Reset points</button>
            <button type="button" class="btn-text is-danger" data-action="start-over">Start over</button>
          </div>
        </div>
      </section>`;
  }

  function teamsView() {
    const k = state.teams.length;
    const cols = k === 4 ? 2 : Math.min(k, 3);
    return `
      <div class="teams${ui.enter ? ' is-entering' : ''}" style="--cols:${cols}">
        ${state.teams.map(teamCard).join('')}
      </div>`;
  }

  function teamCard(ids, i) {
    const name = teamName(i);
    const award = state.awards[i] || 0;
    const members = ids
      .map(byId)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const buttons = AWARDS.map((d) => {
      const amount = plural(Math.abs(d), 'point');
      const label = d > 0 ? `Add ${amount} to everyone on ${name}` : `Remove ${amount} from everyone on ${name}`;
      return `<button type="button" class="award${d < 0 ? ' is-minus' : ''}" data-action="award" data-team="${i}" data-delta="${d}" data-key="award-${i}-${d}" aria-label="${label}">${signed(d)}</button>`;
    }).join('');

    return `
      <article class="team" style="--team: var(--team-${i % TEAM_COLORS}); --i:${i}" aria-labelledby="team-${i}">
        <header class="team-head">
          <span class="team-dot" aria-hidden="true"></span>
          <h2 class="team-name" id="team-${i}">${name}</h2>
          <span class="team-award${ui.flashTeam === i ? ' is-bumped' : ''}"><b>${signed(award)}</b> this game</span>
        </header>
        <ul class="members">${members.map(memberRow).join('')}</ul>
        <div class="award-bar" role="group" aria-label="Points for everyone on ${name}">${buttons}</div>
      </article>`;
  }

  function memberRow(p) {
    const open = ui.openId === p.id;
    const flash = ui.flash.get(p.id);
    const name = esc(p.name);
    return `
      <li class="member${open ? ' is-open' : ''}" data-member="${p.id}">
        <button type="button" class="member-row" data-action="toggle" data-id="${p.id}" data-key="row-${p.id}"
          aria-expanded="${open}" aria-controls="edit-${p.id}">
          <span class="member-name">${name}</span>
          <span class="member-pts${flash ? ` is-bumped is-${flash}` : ''}" aria-label="${fmt(p.points)} points">${fmt(p.points)}</span>
        </button>
        <div class="member-edit" id="edit-${p.id}"${open ? '' : ' inert'}>
          <div class="member-edit-inner">
            <div class="member-edit-row">
              <label class="edit-label" for="pts-${p.id}">Points</label>
              <button type="button" class="adjust" data-action="adjust" data-id="${p.id}" data-delta="-1" data-key="dec-${p.id}" aria-label="Remove a point from ${name}">${ICON_MINUS}</button>
              <input type="number" class="pts-input" id="pts-${p.id}" data-id="${p.id}" data-key="pts-${p.id}" value="${p.points}" step="1">
              <button type="button" class="adjust" data-action="adjust" data-id="${p.id}" data-delta="1" data-key="inc-${p.id}" aria-label="Add a point to ${name}">${ICON_PLUS}</button>
            </div>
          </div>
        </div>
      </li>`;
  }

  function standingsView() {
    const sorted = [...state.people].sort(
      (a, b) => b.points - a.points || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    // Everyone on the same points shares a placing; placings run 1st, 2nd, 3rd with no gaps.
    const placings = [];
    for (const p of sorted) {
      const last = placings[placings.length - 1];
      if (last && last.points === p.points) last.people.push(p);
      else placings.push({ points: p.points, people: [p] });
    }

    const sections = placings.map((g, i) => {
      const rows = g.people
        .map((p) => `<li class="standing"><span class="standing-name">${esc(p.name)}</span></li>`)
        .join('');

      return `
        <li class="placing" aria-labelledby="place-${i}">
          <div class="placing-head">
            <h2 class="placing-rank" id="place-${i}">${ordinal(i + 1)}</h2>
            <span class="placing-pts">${fmt(g.points)} ${Math.abs(g.points) === 1 ? 'point' : 'points'}</span>
          </div>
          <ul class="placing-list">${rows}</ul>
        </li>`;
    }).join('');

    return `<ol class="standings" aria-label="Standings">${sections}</ol>`;
  }

  /* ----------------------------------------------------------------
     Rendering
  ----------------------------------------------------------------- */
  function render() {
    const focusKey = document.activeElement?.dataset?.key;
    const setup = isSetup();

    app.innerHTML = setup ? setupView() : playView();
    syncControls();

    ui.enter = false;
    ui.flash = new Map();
    ui.flashTeam = null;

    if (focusKey) {
      app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
  }

  const out = (name) => app.querySelector(`[data-out="${name}"]`);

  // Updates counts, previews and button states in place so typing never loses focus.
  function syncControls() {
    const setup = isSetup();
    const names = setup ? parseNames(state.draft) : null;
    const n = setup ? names.length : state.people.length;
    const k = clampTeams(state.teamCount, n);

    out('teams').textContent = k;
    app.querySelector('[data-key="teams-dec"]').disabled = k <= MIN_TEAMS;
    app.querySelector('[data-key="teams-inc"]').disabled = k >= maxTeams(n);

    if (!setup) return;

    out('count').textContent =
      n === 0 ? 'No players yet' : n === 1 ? '1 player — add one more' : plural(n, 'player');
    const dupe = firstDuplicate(names);
    out('dupe').textContent = dupe ? `${dupe} is listed twice` : '';
    out('sizes').textContent = n >= MIN_TEAMS ? splitSizes(n, k).join(' · ') : '—';
    app.querySelector('[data-action="make"]').disabled = n < MIN_TEAMS;
  }

  function setView(view) {
    if (ui.view === view) return;
    ui.view = view;
    ui.openId = null;
    const seg = app.querySelector('.segmented');
    seg.style.setProperty('--index', view === 'teams' ? 0 : 1);
    seg.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));

    const panel = document.getElementById('panel');
    panel.innerHTML = view === 'teams' ? teamsView() : standingsView();
    panel.classList.remove('is-switching');
    void panel.offsetWidth;
    panel.classList.add('is-switching');
  }

  // Opening/closing happens in place so the height transition can run.
  function toggleMember(id) {
    const next = ui.openId === id ? null : id;
    if (ui.openId) setOpen(ui.openId, false);
    if (next) setOpen(next, true);
    ui.openId = next;
  }

  function setOpen(id, open) {
    const li = app.querySelector(`[data-member="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.toggle('is-open', open);
    li.querySelector('.member-row').setAttribute('aria-expanded', String(open));
    li.querySelector('.member-edit').inert = !open;
  }

  function scrollTop() {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /* ----------------------------------------------------------------
     Actions
  ----------------------------------------------------------------- */
  function changeTeams(delta) {
    const n = isSetup() ? parseNames(state.draft).length : state.people.length;
    state.teamCount = clampTeams(clampTeams(state.teamCount, n) + delta, n);
    save();
    syncControls();
  }

  async function makeTeams() {
    const names = parseNames(state.draft);
    if (names.length < MIN_TEAMS) return;
    const k = clampTeams(state.teamCount, names.length);
    const editing = Boolean(ui.editing && state.teams);

    let people;
    if (editing) {
      // Match names back to existing people so their points carry over.
      const pool = new Map();
      for (const p of state.people) {
        const key = p.name.toLocaleLowerCase();
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(p);
      }
      people = names.map((name) => {
        const match = pool.get(name.toLocaleLowerCase())?.shift();
        return match ? { ...match, name } : { id: uid(), name, points: 0 };
      });

      const lost = [...pool.values()].flat().filter((p) => p.points !== 0);
      if (lost.length) {
        const list = lost.map((p) => `${p.name} (${fmt(p.points)})`);
        const who = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
        const ok = await confirmDialog({
          title: lost.length === 1 ? `Remove ${lost[0].name}?` : `Remove ${lost.length} players?`,
          message: `${who} will lose ${lost.length === 1 ? 'their' : 'all their'} points.`,
          confirm: 'Remove',
          destructive: true,
        });
        if (!ok) return;
      }
    } else {
      people = names.map((name) => ({ id: uid(), name, points: 0 }));
      state.game = 1;
    }

    state.people = people;
    state.teamCount = k;
    state.teams = deal(people.map((p) => p.id), k);
    state.awards = state.teams.map(() => 0);

    ui.editing = false;
    ui.openId = null;
    ui.view = 'teams';
    ui.enter = true;
    hideToast();
    save();
    render();
    scrollTop();
  }

  function award(i, delta) {
    const before = JSON.stringify(state);
    const ids = state.teams[i];
    for (const id of ids) {
      const p = byId(id);
      if (p) p.points = clampPoints(p.points + delta);
      ui.flash.set(id, delta > 0 ? 'up' : 'down');
    }
    state.awards[i] = (state.awards[i] || 0) + delta;
    ui.flashTeam = i;
    save();
    render();

    showToast(`${teamName(i)} ${signed(delta)} each`, () => {
      state = JSON.parse(before);
      save();
      render();
    });
  }

  function adjust(id, delta) {
    const p = byId(id);
    if (!p) return;
    p.points = clampPoints(p.points + delta);
    ui.flash.set(id, delta > 0 ? 'up' : 'down');
    hideToast();
    save();
    render();
  }

  // Typed values commit on change without a full re-render, so a click on +/- right after typing still lands.
  function setPoints(input) {
    const p = byId(input.dataset.id);
    if (!p) return;
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value)) {
      input.value = p.points;
      return;
    }
    p.points = clampPoints(Math.trunc(value));
    input.value = p.points;
    const pts = input.closest('.member').querySelector('.member-pts');
    pts.textContent = fmt(p.points);
    pts.setAttribute('aria-label', `${fmt(p.points)} points`);
    hideToast();
    save();
  }

  async function nextGame() {
    const k = clampTeams(state.teamCount, state.people.length);
    const ok = await confirmDialog({
      title: `Start game ${state.game + 1}?`,
      message: `Everyone gets shuffled into ${k} new teams. Points carry over.`,
      confirm: 'Shuffle',
    });
    if (!ok) return;

    state.teamCount = k;
    state.teams = deal(state.people.map((p) => p.id), k);
    state.awards = state.teams.map(() => 0);
    state.game += 1;

    ui.openId = null;
    ui.view = 'teams';
    ui.enter = true;
    hideToast();
    save();
    render();
    scrollTop();
  }

  function editPlayers() {
    state.draft = state.people.map((p) => p.name).join('\n');
    state.teamCount = state.teams.length;
    ui.editing = true;
    ui.openId = null;
    hideToast();
    save();
    render();
    scrollTop();
  }

  function cancelEdit() {
    ui.editing = false;
    render();
    scrollTop();
  }

  async function resetPoints() {
    const ok = await confirmDialog({
      title: 'Reset all points?',
      message: 'Everyone goes back to 0 and the game count restarts. Teams stay as they are.',
      confirm: 'Reset',
      destructive: true,
    });
    if (!ok) return;

    state.people.forEach((p) => { p.points = 0; });
    state.awards = state.teams.map(() => 0);
    state.game = 1;
    hideToast();
    save();
    render();
  }

  async function startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      message: 'This clears all teams and points. Your player list stays so you can shuffle again.',
      confirm: 'Start over',
      destructive: true,
    });
    if (!ok) return;

    state = {
      ...emptyState(),
      draft: state.people.map((p) => p.name).join('\n'),
      teamCount: state.teams.length,
    };
    ui.editing = false;
    ui.openId = null;
    ui.view = 'teams';
    hideToast();
    save();
    render();
    scrollTop();
  }

  /* ----------------------------------------------------------------
     Confirm alert
  ----------------------------------------------------------------- */
  function confirmDialog({ title, message, confirm, destructive = false }) {
    return new Promise((resolve) => {
      const okBtn = dialog.querySelector('[data-result="confirm"]');
      const cancelBtn = dialog.querySelector('[data-result="cancel"]');
      dialog.querySelector('#confirm-title').textContent = title;
      dialog.querySelector('#confirm-message').textContent = message;
      okBtn.textContent = confirm;
      okBtn.classList.toggle('is-destructive', destructive);
      okBtn.classList.toggle('is-preferred', !destructive);
      cancelBtn.classList.toggle('is-preferred', destructive);

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('cancel', onCancel);
        const close = () => {
          dialog.classList.remove('is-closing');
          dialog.close();
          resolve(result);
        };
        if (reducedMotion()) return close();
        dialog.classList.add('is-closing');
        setTimeout(close, 150);
      };
      const onClick = (e) => {
        const btn = e.target.closest('[data-result]');
        if (btn) finish(btn.dataset.result === 'confirm');
        else if (e.target === dialog) finish(false); // backdrop
      };
      const onCancel = (e) => {
        e.preventDefault();
        finish(false);
      };

      dialog.addEventListener('click', onClick);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
      (destructive ? cancelBtn : okBtn).focus();
    });
  }

  /* ----------------------------------------------------------------
     Toast with undo
  ----------------------------------------------------------------- */
  let toastTimer = 0;
  let toastUndo = null;

  function showToast(text, undo) {
    toastEl.querySelector('.toast-text').textContent = text;
    toastUndo = undo;
    toastEl.hidden = false;
    toastEl.classList.remove('is-in');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-in');
    armToast();
  }

  function armToast() {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
    toastUndo = null;
  }

  toastEl.querySelector('.toast-undo').addEventListener('click', () => {
    const undo = toastUndo;
    hideToast();
    undo?.();
  });
  toastEl.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  toastEl.addEventListener('pointerleave', () => { if (!toastEl.hidden) armToast(); });

  /* ----------------------------------------------------------------
     Events
  ----------------------------------------------------------------- */
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const delta = Number(el.dataset.delta);

    switch (el.dataset.action) {
      case 'teams': return changeTeams(delta);
      case 'make': return makeTeams();
      case 'cancel-edit': return cancelEdit();
      case 'view': return setView(el.dataset.view);
      case 'toggle': return toggleMember(el.dataset.id);
      case 'adjust': return adjust(el.dataset.id, delta);
      case 'award': return award(Number(el.dataset.team), delta);
      case 'next': return nextGame();
      case 'edit': return editPlayers();
      case 'reset': return resetPoints();
      case 'start-over': return startOver();
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.id !== 'names') return;
    state.draft = e.target.value;
    save();
    syncControls();
  });

  app.addEventListener('change', (e) => {
    if (e.target.matches('.pts-input')) setPoints(e.target);
  });

  app.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.id === 'names' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      makeTeams();
    } else if (t.matches?.('.pts-input')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        t.blur();
      } else if (e.key === 'Escape') {
        t.value = byId(t.dataset.id)?.points ?? 0;
        t.blur();
      }
    }
  });

  render();
})();
