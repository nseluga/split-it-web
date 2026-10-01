// Split math, exactly per contract/contract.md. Pure: SplitState in, rows out. Integer cents only.
(function (root) {
  // Largest-remainder allocation of `amount` across `weights` (all integers >= 0).
  // Returns null when every weight is 0 so the caller can decide where it goes.
  function allocate(amount, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    const out = weights.map((w) => Math.floor((amount * w) / total));
    const rem = weights.map((w, i) => ({ i, r: (amount * w) % total }));
    let left = amount - out.reduce((a, b) => a + b, 0);
    rem.sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; left > 0; k++, left--) out[rem[k].i] += 1;
    return out;
  }

  // Returns { rows: [{id,name,itemsCents,taxCents,tipCents,totalCents}...participants in position order..., unclaimed row last] }
  function computeSplit(state) {
    const ps = [...state.participants].sort((a, b) => a.position - b.position);
    const rows = ps.map((p) => ({ id: p.id, name: p.name, itemsCents: 0, taxCents: 0, tipCents: 0, totalCents: 0 }));
    const unclaimed = { id: 'unclaimed', name: 'Unclaimed', itemsCents: 0, taxCents: 0, tipCents: 0, totalCents: 0 };
    rows.push(unclaimed);
    const index = new Map(ps.map((p, i) => [p.id, i]));

    for (const item of state.items) {
      const claimants = [...new Set(item.claimed_by || [])] // duplicate ids count once
        .filter((id) => index.has(id)) // unknown ids are ignored
        .sort((a, b) => index.get(a) - index.get(b));
      if (claimants.length === 0) { unclaimed.itemsCents += item.price_cents; continue; }
      const k = claimants.length;
      const base = Math.floor(item.price_cents / k);
      const extra = item.price_cents % k;
      claimants.forEach((id, n) => { rows[index.get(id)].itemsCents += base + (n < extra ? 1 : 0); });
    }

    const weights = rows.map((r) => r.itemsCents);
    for (const [amount, key] of [[state.tax_cents, 'taxCents'], [state.tip_cents, 'tipCents']]) {
      const shares = allocate(amount, weights);
      if (shares) shares.forEach((s, i) => { rows[i][key] = s; });
      else unclaimed[key] = amount;
    }
    for (const r of rows) r.totalCents = r.itemsCents + r.taxCents + r.tipCents;
    return { rows, unclaimed };
  }

  const api = { computeSplit, allocate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitMath = api;
})(typeof self !== 'undefined' ? self : this);
