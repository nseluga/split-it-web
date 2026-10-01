// Payment deep links. One place to correct the URL formats (see docs/run-notes.md for verified formats).
(function (root) {
  const dollars = (cents) => (cents / 100).toFixed(2);

  // Both return null (no link) for an empty handle or an amount of 0, per the contract.
  const clean = (v, prefix) => String(v == null ? '' : v).trim().replace(prefix, '');

  function venmoUrl(handle, cents, note) {
    if (!clean(handle, /^@/) || !(cents > 0)) return null;
    const h = encodeURIComponent(clean(handle, /^@/));
    return `https://venmo.com/${h}?txn=pay&amount=${dollars(cents)}&note=${encodeURIComponent(note)}`;
  }

  // Cash App's pay link has no note parameter.
  function cashAppUrl(tag, cents) {
    if (!clean(tag, /^\$/) || !(cents > 0)) return null;
    const t = encodeURIComponent(clean(tag, /^\$/));
    return `https://cash.app/$${t}/${dollars(cents)}`;
  }

  const noteFor = (title) => `Split It: ${title}`;

  const api = { venmoUrl, cashAppUrl, noteFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PayLinks = api;
})(typeof self !== 'undefined' ? self : this);
