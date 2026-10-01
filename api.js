// Backend access: the real Supabase RPC client, and an in-page mock of the same contract (?mock=1).
// Interface: getSplit(token) / join(token,name) / setClaim(token,pid,itemId,claimed) / subscribe(token,cb)->unsub.
// Network failures throw errors with .network = true.
(function (root) {
  const netErr = (e) => Object.assign(new Error((e && e.message) || 'Network error'), { network: true, cause: e });
  const isNet = (e) => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed|fetch|abort|timed out|timeout/i.test(String((e && e.message) || e));

  function real(cfg) {
    if (!root.supabase) throw netErr(new Error('Could not load the Supabase client'));
    const sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    async function rpc(fn, args) {
      let res;
      // the timeout keeps a hung request from leaving the page loading forever
      try { res = await sb.rpc(fn, args).abortSignal(AbortSignal.timeout(12000)); } catch (e) { throw netErr(e); }
      if (res.error) { if (isNet(res.error)) throw netErr(res.error); throw Object.assign(new Error(res.error.message || 'Request failed'), { server: true }); }
      return res.data;
    }
    return {
      getSplit: (t) => rpc('get_split', { p_token: t }),
      join: async (t, name) => (await rpc('join_split', { p_token: t, p_name: name })).participant_id,
      setClaim: (t, pid, itemId, claimed) => rpc('set_claim', { p_token: t, p_participant_id: pid, p_item_id: itemId, p_claimed: claimed }),
      subscribe(t, cb) {
        // refetch on every (re)subscribe too: a change that landed while not subscribed was never delivered
        const ch = sb.channel('split:' + t).on('broadcast', { event: 'changed' }, cb).subscribe((st) => { if (st === 'SUBSCRIBED') cb(); });
        return () => sb.removeChannel(ch);
      },
    };
  }

  // ---- mock: state in localStorage so two tabs share it; BroadcastChannel stands in for realtime ----
  // Special tokens: "demo*" (seeded on first open, e.g. demo2), "expired" (null), "down" (always a network error).
  function mock() {
    const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('split-it-mock') : null;
    const key = (t) => 'mock-split:' + t;
    const wait = () => new Promise((r) => setTimeout(r, 120));
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    const load = (t) => { try { return JSON.parse(localStorage.getItem(key(t))); } catch { return null; } };
    const save = (t, s) => { localStorage.setItem(key(t), JSON.stringify(s)); bc && bc.postMessage(t); };
    const seed = (t) => {
      const pid = uid();
      const it = (name, quantity, price_cents) => ({ id: uid(), name, quantity, price_cents, claimed_by: [] });
      const items = [it('Margherita pizza', 1, 1800), it('Spaghetti carbonara', 1, 2100), it('Caesar salad', 1, 1400), it('Garlic bread (to share)', 1, 899),
        it('Tiramisu', 2, 1600), it('Sparkling water', 2, 700), it('House red, carafe', 1, 2850)].map((x, position) => ({ ...x, position }));
      return { token: t, title: "Luigi's", host_name: 'Nate', venmo_handle: 'nate-s', cashapp_tag: 'nates', tax_cents: 912, tip_cents: 1800,
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
        participants: [{ id: pid, name: 'Nate', position: 0, is_host: true }], items };
    };
    const tweak = (t, fn) => { const s = load(t); if (!s) throw new Error('unknown split'); fn(s); save(t, s); };
    const guard = (t) => { if (t === 'down' || root.__mock.fail || !navigator.onLine) throw netErr(new Error('Failed to fetch')); };
    root.__mock = { // console helpers for demos/tests; set __mock.fail = true to make every call fail like a dropped connection
      fail: false, deleted: new Set(),
      deleteSplit: (t) => { root.__mock.deleted.add(t); localStorage.removeItem(key(t)); bc && bc.postMessage(t); },
      reset: (t) => { localStorage.removeItem(key(t)); bc && bc.postMessage(t); },
    };
    return {
      async getSplit(t) {
        await wait(); guard(t);
        if (t === 'expired') return null;
        let s = load(t);
        if (!s && t.startsWith('demo') && !root.__mock.deleted.has(t)) { s = seed(t); localStorage.setItem(key(t), JSON.stringify(s)); }
        return s;
      },
      async join(t, name) {
        await wait(); guard(t);
        const n = String(name).trim();
        if (!n || n.length > 80) throw new Error('Name must be 1 to 80 characters');
        let pid;
        tweak(t, (s) => {
          const ex = s.participants.find((p) => p.name.trim().toLowerCase() === n.toLowerCase());
          if (ex) { pid = ex.id; return; }
          if (s.participants.length >= 30) throw new Error('This split is full');
          pid = uid();
          s.participants.push({ id: pid, name: n, position: s.participants.length, is_host: false });
        });
        return pid;
      },
      async setClaim(t, pid, itemId, claimed) {
        await wait(); guard(t);
        tweak(t, (s) => {
          const item = s.items.find((i) => i.id === itemId);
          if (!item || !s.participants.some((p) => p.id === pid)) throw new Error('Not found');
          const set = new Set(item.claimed_by);
          claimed ? set.add(pid) : set.delete(pid);
          item.claimed_by = s.participants.filter((p) => set.has(p.id)).map((p) => p.id);
        });
      },
      subscribe(t, cb) {
        if (!bc) return () => {};
        const on = (e) => { if (e.data === t) cb(); };
        bc.addEventListener('message', on);
        return () => bc.removeEventListener('message', on);
      },
    };
  }

  root.createApi = (useMock) => (useMock ? mock() : real(root.SPLIT_IT_CONFIG));
})(window);
