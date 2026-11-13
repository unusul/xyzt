// Every call the app makes to Supabase. There is no server in between: the database enforces the rules
// (post lifetime, limits, who reads what), see supabase/migrations.
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';
import { prepareImage } from './image.js';

const AUTH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const POST_COLUMNS = 'id,content,media_url,author_id,created_at,expires_at';
export const SPACE_RADIUS_METERS = 5000;

async function call(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${SUPABASE_URL}${path}`, { method, body, headers: { ...AUTH, ...headers } });
    if (!response.ok) throw new Error(await errorMessage(response));
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

async function errorMessage(response) {
    try {
        const payload = await response.json();
        return payload.message || payload.error || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

function json(method, payload, prefer) {
    return { method, body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) } };
}

export function fetchSpacePosts(lat, lon) {
    return call('/rest/v1/rpc/get_nearby_space_posts', json('POST', { user_lat: lat, user_lon: lon, radius_meters: SPACE_RADIUS_METERS }));
}

export function fetchTimePosts(label) {
    const query = new URLSearchParams({ select: POST_COLUMNS, label: `eq.${label}`, expires_at: `gt.${new Date().toISOString()}`, order: 'created_at.desc' });
    return call(`/rest/v1/time_posts?${query}`);
}

export function fetchRecentLabels() {
    const query = new URLSearchParams({ select: 'category_id', category_type: 'eq.TIME', order: 'last_activity.desc', limit: '10' });
    return call(`/rest/v1/category_stats?${query}`);
}

export function fetchMapPoints() {
    const query = new URLSearchParams({ select: 'lat,lon', expires_at: `gt.${new Date().toISOString()}` });
    return call(`/rest/v1/space_posts?${query}`);
}

async function uploadMedia(file) {
    if (!file) return null;
    const image = await prepareImage(file);
    const extension = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[image.type] || 'jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    await call(`/storage/v1/object/${BUCKET}/${name}`, { method: 'POST', body: image, headers: { 'Content-Type': image.type || 'image/jpeg' } });
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;
}

export async function publishSpacePost({ content, authorId, lat, lon, file }) {
    const media_url = await uploadMedia(file);
    return call('/rest/v1/space_posts', json('POST', { content, author_id: authorId, lat, lon, media_url }, 'return=minimal'));
}

export async function publishTimePost({ content, authorId, label, file }) {
    const media_url = await uploadMedia(file);
    return call('/rest/v1/time_posts', json('POST', { content, author_id: authorId, label, media_url }, 'return=minimal'));
}

export function sendContactMessage(email, message) {
    return call('/rest/v1/contact_messages', json('POST', { email: email || null, message }, 'return=minimal'));
}
