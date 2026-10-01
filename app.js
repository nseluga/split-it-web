// Guest page. All split data reaches the DOM via textContent / setAttribute only (never innerHTML).
(function () {
  const { computeSplit } = SplitMath;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const token = params.get('s');
  const useMock = !!params.get('mock') && params.get('mock') !== '0';
  const money = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const S = { split: null, me: null, active: null, tab: 'items', inflight: 0, lastMutationEnd: 0, fetching: false, again: false, fresh: new Set(), seen: null, loadedOnce: false, offlineBanner: false, failBanner: false };
  let api, unsub = null, pollTimer = null, queue = Promise.resolve();

  // ---------- tiny helpers ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  // Remembered identity per split. In mock mode ?mock=<n> namespaces it so two tabs can act as two phones.
  const skey = 'splitit:' + token + (useMock ? ':' + params.get('mock') : '');
  const store = {
    get: () => { try { return JSON.parse(localStorage.getItem(skey)); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(skey, JSON.stringify(v)); } catch {} },
    clear: () => { try { localStorage.removeItem(skey); } catch {} },
  };
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }
  function show(view) {
    for (const v of ['loading', 'error', 'name', 'main']) $('v-' + v).hidden = v !== view;
  }
  function showError(title, body, canRetry) {
    stopLive(); $('err-title').textContent = title; $('err-body').textContent = body;
    $('err-retry').hidden = !canRetry; show('error'); document.title = 'Split It';
  }
  function updateBanner() {
    const offline = !navigator.onLine;
    const msg = offline ? "You're offline. Taps won't save until you're back." : S.failBanner ? "Can't reach the server. Trying again…" : '';
    $('banner').hidden = !msg; $('banner-text').textContent = msg;
    document.documentElement.style.setProperty('--banner-h', msg ? $('banner').offsetHeight + 'px' : '0px');
  }

  // ---------- data ----------
  const byId = (id) => S.split && S.split.participants.find((p) => p.id === id);
  const nameKey = (n) => n.trim().toLowerCase();

  function applySplit(next) {
    const keys = new Set();
    for (const it of next.items) for (const pid of it.claimed_by) keys.add(it.id + '|' + pid);
    if (S.seen) for (const k of keys) if (!S.seen.has(k)) S.fresh.add(k);
    S.seen = keys; S.split = next;
    if (S.active && !byId(S.active)) S.active = S.me;
    document.title = next.title + ' · Split It';
  }

  async function load() {
    show('loading');
    if (!token) return showError('This link is missing its split code', 'Ask the host to share the link again.', false);
    try {
      const s = await api.getSplit(token);
      if (!s) return showError("This split isn't available", 'The link may be wrong, or the split expired (they last 30 days). Ask the host for a new link.', false);
      S.split = s; applySplit(s); S.loadedOnce = true;
      const saved = store.get();
      if (saved && saved.name) {
        let p = byId(saved.pid) || s.participants.find((x) => nameKey(x.name) === nameKey(saved.name));
        if (!p) { const pid = await api.join(token, saved.name); await refetch(true); p = byId(pid); }
        if (p) return enter(p.id);
      }
      showName();
    } catch (e) {
      showError(e.network ? "Can't reach the server" : 'Something went wrong', e.network ? 'Check your connection and try again.' : 'Try again in a moment.', true);
    }
  }

  async function refetch(force) {
    if (!S.loadedOnce) return;
    if (S.fetching) { S.again = true; return; }
    if (S.inflight > 0 && !force) { S.again = true; return; }
    S.fetching = true; const started = Date.now();
    try {
      const s = await api.getSplit(token);
      S.failBanner = false;
      if (!s) { showError('This split was deleted', 'The host removed it. Ask them for a new link if you still need to settle up.', false); return; }
      if (S.inflight === 0 && started >= S.lastMutationEnd) { applySplit(s); if (!$('v-main').hidden) render(); }
      else S.again = true;
    } catch (e) { S.failBanner = true; }
    finally {
      S.fetching = false; updateBanner();
      if (S.again) { S.again = false; setTimeout(refetch, S.failBanner ? 2000 : 0); }
    }
  }

  function startLive() {
    stopLive();
    try { unsub = api.subscribe(token, () => refetch()); } catch {}
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refetch(); }, 10000);
  }
  function stopLive() { if (unsub) { try { unsub(); } catch {} unsub = null; } clearInterval(pollTimer); }

  // ---------- name screen ----------
  function showName() {
    const s = S.split;
    $('name-eyebrow').textContent = `Hosted by ${s.host_name}`;
    $('name-title').textContent = s.title;
    $('name-error').hidden = true;
    const chips = $('name-chips'); chips.replaceChildren();
    for (const p of s.participants) chips.append(h('button', { type: 'button', class: 'chip', text: p.name, onclick: () => join(p.name, true) }));
    $('name-existing').hidden = s.participants.length === 0;
    show('name'); $('name-input').focus({ preventScroll: true });
  }
  function nameProblem(raw) {
    const n = raw.trim();
    if (!n) return 'Type your name so your friends can see which items are yours.';
    if (n.length > 80) return 'That name is too long (80 characters max).';
    return '';
  }
  async function join(raw, fromChip) {
    const err = $('name-error'); const problem = nameProblem(raw);
    if (problem) { err.textContent = problem; err.hidden = false; $('name-input').focus(); return; }
    const name = raw.trim(); err.hidden = true;
    $('name-go').disabled = true;
    try {
      const existing = S.split.participants.find((p) => nameKey(p.name) === nameKey(name));
      const pid = await api.join(token, name);
      store.set({ pid, name: existing ? existing.name : name });
      await refetch(true);
      if (existing && !fromChip) toast(`Welcome back, ${existing.name}. That's you.`);
      enter(pid);
    } catch (e) {
      err.textContent = e.network ? "Couldn't reach the server. Check your connection and try again." : /full/i.test(e.message) ? 'This split is full (30 people).' : "Couldn't join. Try again.";
      err.hidden = false;
    } finally { $('name-go').disabled = false; }
  }

  // ---------- main ----------
  function enter(pid) {
    S.me = pid; S.active = pid; S.tab = 'items';
    show('main'); render(); startLive();
  }

  function render() {
    const s = S.split; if (!s) return;
    const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key;
    const me = byId(S.me), active = byId(S.active) || me;
    $('main-eyebrow').textContent = `Hosted by ${s.host_name} · ${s.participants.length} ${s.participants.length === 1 ? 'person' : 'people'}`;
    $('main-title').textContent = s.title;
    $('whoami').textContent = `You're ${me ? me.name : ''}.`;
    renderWho(); 
    for (const t of ['items', 'totals']) { const b = $('tab-' + t); b.setAttribute('aria-current', S.tab === t ? 'page' : 'false'); }
    const split = computeSplit(s); const row = split.rows.find((r) => r.id === active.id);
    if (S.tab === 'items') renderItems(active); else renderTotals(split, row, active);
    $('bar').hidden = S.tab !== 'items';
    $('bar-label').textContent = active.id === S.me ? 'Your total' : `${active.name}'s total`;
    $('bar-total').textContent = money(row.totalCents);
    S.fresh.clear();
    if (focus) { const el = document.querySelector(`[data-key="${CSS.escape(focus)}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  function renderWho() {
    const box = $('who-chips'); box.replaceChildren();
    for (const p of S.split.participants) {
      box.append(h('button', { type: 'button', class: 'chip' + (p.id === S.active ? ' on' : ''), 'aria-pressed': p.id === S.active ? 'true' : 'false', 'data-key': 'who-' + p.id,
        text: p.id === S.me ? `${p.name} (you)` : p.name, onclick: () => { S.active = p.id; render(); } }));
    }
    box.append(h('button', { type: 'button', class: 'chip add', 'data-key': 'who-add', text: '+ Add person', onclick: openAdd }));
  }

  function share(item, pid) { // this person's cents on an item, per the contract's remainder rule
    const ps = S.split.participants, order = item.claimed_by;
    const k = order.length, i = order.indexOf(pid); if (i < 0) return 0;
    return Math.floor(item.price_cents / k) + (i < item.price_cents % k ? 1 : 0);
  }

  function renderItems(active) {
    const list = h('ul', { class: 'items' });
    const mine = S.split.items.some((i) => i.claimed_by.includes(active.id));
    for (const it of S.split.items) {
      const on = it.claimed_by.includes(active.id);
      const pills = it.claimed_by.map((pid) => {
        const p = byId(pid); if (!p) return null;
        return h('span', { class: 'pill' + (pid === active.id ? ' mine' : '') + (S.fresh.has(it.id + '|' + pid) ? ' pop' : ''), text: pid === S.me ? 'You' : p.name });
      });
      const k = it.claimed_by.length;
      const sub = k === 0 ? h('span', { class: 'nobody', text: 'Nobody yet' }) : h('span', { class: 'pills' }, pills);
      const priceCol = h('span', { class: 'price' }, h('span', { text: money(it.price_cents) }),
        k > 1 && on ? h('span', { class: 'each', text: `your share ${money(share(it, active.id))}` }) : k > 1 ? h('span', { class: 'each', text: `${k} ways` }) : null);
      const label = `${it.quantity > 1 ? it.quantity + ' × ' : ''}${it.name}, ${money(it.price_cents)}. ${k ? 'Claimed by ' + it.claimed_by.map((id) => (byId(id) || {}).name).join(', ') : 'Nobody yet'}.`;
      list.append(h('li', {}, h('button', { type: 'button', class: 'item' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'aria-label': label, 'data-key': 'item-' + it.id, onclick: () => toggle(it.id) },
        h('span', { class: 'check', 'aria-hidden': 'true' }),
        h('span', { class: 'what' }, h('span', { class: 'iname', text: (it.quantity > 1 ? it.quantity + ' × ' : '') + it.name }), sub),
        priceCol)));
    }
    const hint = h('p', { class: 'hint', text: mine ? '' : active.id === S.me ? 'Tap everything you had.' : `Tap everything ${active.name} had.` });
    $('panel').replaceChildren(hint, list);
    hint.hidden = mine;
  }

  function renderTotals(split, row, active) {
    const s = S.split, isMe = active.id === S.me;
    const card = h('section', { class: 'card' },
      h('h2', { text: isMe ? 'Your total' : `${active.name}'s total` }),
      h('p', { class: 'big', text: money(row.totalCents) }),
      h('dl', { class: 'break' },
        h('dt', { text: 'Items' }), h('dd', { text: money(row.itemsCents) }),
        h('dt', { text: 'Tax' }), h('dd', { text: money(row.taxCents) }),
        h('dt', { text: 'Tip' }), h('dd', { text: money(row.tipCents) })));
    const pay = h('section', { class: 'card' });
    if (active.is_host) pay.append(h('h2', { text: 'Host' }), h('p', { class: 'muted', text: `${active.name} is the host, so there's no one to pay back here.` }));
    else if (row.totalCents === 0) pay.append(h('h2', { text: `Pay ${s.host_name}` }), h('p', { class: 'muted', text: 'Nothing to pay yet. Tap the items on the Items tab first.' }));
    else {
      pay.append(h('h2', { text: `Pay ${s.host_name}` }));
      const note = PayLinks.noteFor(s.title);
      const venmo = PayLinks.venmoUrl(s.venmo_handle, row.totalCents, note), cash = PayLinks.cashAppUrl(s.cashapp_tag, row.totalCents);
      if (venmo) pay.append(h('a', { class: 'btn pay venmo block', href: venmo, rel: 'noopener', text: `Pay ${money(row.totalCents)} with Venmo` }));
      if (cash) pay.append(h('a', { class: 'btn pay cashapp block', href: cash, rel: 'noopener', text: `Pay ${money(row.totalCents)} with Cash App` }));
    }
    const un = split.unclaimed, unItems = s.items.filter((i) => i.claimed_by.length === 0);
    const everyone = h('section', { class: 'card' }, h('h2', { text: 'Everyone' }),
      h('ul', { class: 'rows' }, split.rows.slice(0, -1).map((r) =>
        h('li', { class: r.id === active.id ? 'on' : '' }, h('span', { text: r.name + (r.id === S.me ? ' (you)' : '') }), h('span', { class: 'amt', text: money(r.totalCents) })))));
    if (unItems.length) {
      everyone.append(h('div', { class: 'unclaimed' },
        h('p', {}, h('strong', { text: `Still unclaimed: ${money(un.totalCents)}` })),
        h('p', { class: 'muted small', text: unItems.map((i) => i.name).join(', ') }),
        h('button', { type: 'button', class: 'btn', text: 'Go claim items', onclick: () => setTab('items') })));
    } else everyone.append(h('p', { class: 'muted small ok', text: 'Everything is claimed.' }));
    everyone.append(h('p', { class: 'muted small', text: `Receipt total ${money(s.items.reduce((a, i) => a + i.price_cents, 0) + s.tax_cents + s.tip_cents)}, with tax and tip shared in proportion to what each person had.` }));
    $('panel').replaceChildren(card, pay, everyone);
  }

  function setTab(t) { S.tab = t; render(); window.scrollTo(0, 0); }

  // ---------- claiming: optimistic with rollback ----------
  function toggle(itemId) {
    const item = S.split.items.find((i) => i.id === itemId), pid = S.active;
    if (!item || !byId(pid)) return;
    const prev = item.claimed_by.slice(), claimed = !prev.includes(pid);
    const set = new Set(prev); claimed ? set.add(pid) : set.delete(pid);
    item.claimed_by = S.split.participants.filter((p) => set.has(p.id)).map((p) => p.id);
    if (claimed) S.fresh.add(itemId + '|' + pid);
    S.seen && (claimed ? S.seen.add(itemId + '|' + pid) : S.seen.delete(itemId + '|' + pid));
    S.inflight++; render();
    queue = queue.then(() => api.setClaim(token, pid, itemId, claimed)).then(() => {}, (e) => {
      const live = S.split.items.find((i) => i.id === itemId);
      if (live) live.claimed_by = prev;
      S.seen && (claimed ? S.seen.delete(itemId + '|' + pid) : S.seen.add(itemId + '|' + pid));
      toast(e.network || !navigator.onLine ? "Couldn't save. Check your connection and tap again." : "Couldn't save that tap. Try again.");
      render();
    }).then(() => { S.inflight--; S.lastMutationEnd = Date.now(); if (S.inflight === 0) refetch(); });
  }

  // ---------- add a person ----------
  const dlg = $('add-dialog');
  function openAdd() { $('add-input').value = ''; $('add-error').hidden = true; dlg.showModal(); $('add-input').focus(); }
  $('add-cancel').addEventListener('click', () => dlg.close());
  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('add-input').value, err = $('add-error'), problem = nameProblem(raw);
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const name = raw.trim(), existing = S.split.participants.find((p) => nameKey(p.name) === nameKey(name));
    if (existing) { S.active = existing.id; dlg.close(); render(); toast(`${existing.name} is already here. Now tapping for ${existing.name}.`); return; }
    $('add-go').disabled = true;
    try {
      const pid = await api.join(token, name);
      await refetch(true); S.active = pid; dlg.close(); render(); toast(`Now tapping for ${name}.`);
    } catch (ex) {
      err.textContent = ex.network ? "Couldn't reach the server. Try again." : /full/i.test(ex.message) ? 'This split is full (30 people).' : "Couldn't add them. Try again."; err.hidden = false;
    } finally { $('add-go').disabled = false; }
  });

  // ---------- wiring ----------
  $('name-form').addEventListener('submit', (e) => { e.preventDefault(); join($('name-input').value); });
  $('err-retry').addEventListener('click', () => (api ? load() : location.reload()));
  $('banner-retry').addEventListener('click', () => { refetch(); });
  $('bar-go').addEventListener('click', () => setTab('totals'));
  $('tab-items').addEventListener('click', () => setTab('items'));
  $('tab-totals').addEventListener('click', () => setTab('totals'));
  $('not-you').addEventListener('click', () => { store.clear(); stopLive(); S.me = S.active = null; showName(); $('name-input').value = ''; });
  addEventListener('online', () => { updateBanner(); refetch(); });
  addEventListener('offline', updateBanner);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refetch(); });

  try { api = createApi(useMock); } catch (e) { api = null; }
  if (!api) showError("Can't reach the server", 'The page could not load everything it needs. Check your connection and try again.', true);
  else { updateBanner(); load(); }
})();
