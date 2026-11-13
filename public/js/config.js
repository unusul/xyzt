// Where the app's data lives. The key below is the project's publishable key: it is meant to be public and
// can only do what the database rules allow to an anonymous visitor (see supabase/migrations).
export const SUPABASE_URL = 'https://qpkulphnmtxcprsyhxcj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_gDfGm5TSQsn5Fp5hheGDeg_FtXkrtUD';
export const BUCKET = 'xyzt-media';

// Path the site is served from: "/" locally, "/xyzt/" on GitHub Pages (set by the <base> tag in index.html).
export const BASE = new URL(document.baseURI).pathname;
