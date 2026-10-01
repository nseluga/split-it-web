// Swap these three values per environment. Local-dev placeholders ship by default.
window.SPLIT_IT_CONFIG = {
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseKey: 'local-dev-publishable-key',
  baseUrl: 'http://localhost:8080', // guest links are {baseUrl}/?s={token}
};
