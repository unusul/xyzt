// Sign-in for the admin page only: a link sent by e-mail, no password. Visitors never sign in.
// The session (Supabase access and refresh tokens) stays in this browser's storage.
import { SUPABASE_URL, SUPABASE_KEY, BASE } from './config.js';

const STORAGE_KEY = 'xyzt_admin_session';
const HEADERS = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function save(session) {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
}

function fromTokens(tokens) {
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
}

async function post(path, body, token) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
        method: 'POST', body: JSON.stringify(body), headers: token ? { ...HEADERS, Authorization: `Bearer ${token}` } : HEADERS
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.msg || payload.error_description || payload.message || `HTTP ${response.status}`), { status: response.status });
    return payload;
}

// The e-mailed link comes back to the site with the tokens (or an error) after the "#".
// Returns 'signed-in', an error message, or null when the address carries neither.
export function captureLinkResult() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('access_token') && params.get('refresh_token')) {
        save(fromTokens(Object.fromEntries(params)));
        return 'signed-in';
    }
    return params.get('error_description') || null;
}

// create_user false: the link is sent only to an account that already exists.
export function requestLink(email) {
    const redirect = encodeURIComponent(location.origin + BASE);
    return post(`otp?redirect_to=${redirect}`, { email, create_user: false });
}

export async function accessToken() {
    const session = load();
    if (!session) return null;
    if (session.expires_at - Date.now() > 60000) return session.access_token;
    try {
        const renewed = fromTokens(await post('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
        save(renewed);
        return renewed.access_token;
    } catch {
        save(null);
        return null;
    }
}

export function signedInEmail() {
    try {
        const payload = load().access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(payload)).email || null;
    } catch {
        return null;
    }
}

export async function signOut() {
    const token = await accessToken();
    if (token) await post('logout', {}, token).catch(() => { /* the local session goes away anyway */ });
    save(null);
}
