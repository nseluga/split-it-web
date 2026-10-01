// Live split-it project and its publishable key (public by design; never the secret / service-role key).
// After changing anything here: scripts/deploy-web.sh.
window.SPLIT_IT_CONFIG = {
  supabaseUrl: 'https://ivlfginujvptutbljofa.supabase.co',
  supabaseKey: 'sb_publishable_5sUcbPr2TjRyCWVADzy-JQ_VU7aEfwM',
  baseUrl: 'https://nseluga.github.io/split-it-web', // guest links are {baseUrl}/?s={token}
};
