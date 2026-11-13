// The admin page: contact messages, every post with a delete button, label activity.
// Hiding the page protects nothing: the database answers these calls only to a user listed in public.admins.
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from './config.js';
import { t } from './i18n.js';
import { toast, timeLeft } from './ui.js';
import * as auth from './auth.js';

let body = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function button(text, className, run) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
}

async function call(path, method = 'GET', payload) {
    const token = await auth.accessToken();
    if (!token) throw new Error('signed out');
    const response = await fetch(`${SUPABASE_URL}${path}`, {
        method, body: payload ? JSON.stringify(payload) : undefined,
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error((text && JSON.parse(text).message) || `HTTP ${response.status}`);
    return text ? JSON.parse(text) : null;
}

function when(iso) {
    return new Date(iso).toLocaleString(document.documentElement.lang, { dateStyle: 'short', timeStyle: 'short' });
}

function section(title, rows, emptyText) {
    const box = el('div', 'card');
    box.append(el('h2', null, `${title} (${rows.length})`));
    if (rows.length) box.append(...rows);
    else box.append(el('p', 'muted small', emptyText));
    return box;
}

// --- Signed out -----------------------------------------------------------------------------------------------
function renderSignIn(message) {
    const form = el('form', 'card');
    const email = el('input');
    email.type = 'email';
    email.required = true;
    email.autocomplete = 'email';
    email.placeholder = t('admin_email');
    email.setAttribute('aria-label', t('admin_email'));
    const send = el('button', 'btn', t('admin_send_link'));
    send.type = 'submit';
    form.append(el('h2', null, t('admin_signin')), el('p', 'muted small', message || t('admin_signin_desc')), email, send);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        send.disabled = true;
        try {
            await auth.requestLink(email.value.trim());
            body.replaceChildren(el('p', 'card', t('admin_link_sent')));
        } catch (error) {
            // An unknown address is refused (400/422): answer the same way, so the form does not reveal which one is the admin's.
            if (error.status === 400 || error.status === 422) return body.replaceChildren(el('p', 'card', t('admin_link_sent')));
            toast(t('admin_error', { msg: error.message }), 'bad');
            send.disabled = false;
        }
    });
    body.replaceChildren(form);
}

// --- Signed in --------------------------------------------------------------------------------------------------
async function remove(row, path, mediaUrl) {
    if (!confirm(t('admin_confirm_delete'))) return;
    try {
        await call(path, 'DELETE');
        // The photo goes too; if this fails the hourly purge removes it, since no post refers to it any more.
        if (mediaUrl) await call(`/storage/v1/object/${BUCKET}`, 'DELETE', { prefixes: [mediaUrl.split('/').pop()] }).catch(() => {});
        row.remove();
        toast(t('admin_deleted'));
    } catch (error) {
        toast(t('admin_error', { msg: error.message }), 'bad');
    }
}

function messageRow(message) {
    const row = el('div', 'admin-row');
    const head = el('div', 'admin-row-head');
    head.append(el('span', 'muted small', `${when(message.created_at)} · ${message.email || t('admin_no_email')}`),
        button(t('admin_delete'), 'btn ghost sm danger', () => remove(row, `/rest/v1/contact_messages?id=eq.${message.id}`)));
    row.append(head, el('p', 'post-body', message.message));
    return row;
}

function postRow(post) {
    const row = el('div', 'admin-row');
    const head = el('div', 'admin-row-head');
    const where = post.label ? `#${post.label}` : `${post.lat.toFixed(4)}, ${post.lon.toFixed(4)}`;
    const meta = el('span', 'muted small', `${where} · ${post.author_id} · ${when(post.created_at)} · ${timeLeft(post.expires_at) || t('admin_expired')}`);
    const table = post.label ? 'time_posts' : 'space_posts';
    head.append(meta, button(t('admin_delete'), 'btn ghost sm danger', () => remove(row, `/rest/v1/${table}?id=eq.${post.id}`, post.media_url)));
    row.append(head);
    if (post.content) row.append(el('p', 'post-body', post.content));
    if (post.media_url) {
        const image = el('img', 'admin-thumb');
        image.src = post.media_url;
        image.alt = '';
        image.loading = 'lazy';
        row.append(image);
    }
    return row;
}

function labelRow(stat) {
    return el('p', 'small', `#${stat.category_id} · ${stat.total_posts} · ${when(stat.last_activity)}`);
}

async function renderDashboard() {
    body.replaceChildren(el('p', 'empty', t('loading')));
    const columns = 'id,content,media_url,author_id,created_at,expires_at';
    const [messages, timePosts, spacePosts, labels] = await Promise.all([
        call('/rest/v1/contact_messages?select=*&order=created_at.desc&limit=200'),
        call(`/rest/v1/time_posts?select=${columns},label&order=created_at.desc&limit=100`),
        call(`/rest/v1/space_posts?select=${columns},lat,lon&order=created_at.desc&limit=100`),
        call('/rest/v1/category_stats?select=category_id,total_posts,last_activity&category_type=eq.TIME&order=last_activity.desc&limit=30')
    ]);
    const posts = [...timePosts, ...spacePosts].sort((a, b) => b.created_at.localeCompare(a.created_at));
    body.replaceChildren(
        section(t('admin_messages'), messages.map(messageRow), t('admin_none')),
        section(t('admin_posts'), posts.map(postRow), t('admin_none')),
        section(t('admin_labels'), labels.map(labelRow), t('admin_none'))
    );
}

export async function showAdmin(container, signOutButton, linkError) {
    body = container;
    signOutButton.onclick = async () => { await auth.signOut(); showAdmin(container, signOutButton); };
    const token = await auth.accessToken();
    signOutButton.hidden = !token;
    if (!token) return renderSignIn(linkError);
    try {
        if (await call('/rest/v1/rpc/is_admin', 'POST', {})) await renderDashboard();
        else body.replaceChildren(el('p', 'card', t('admin_not_admin', { email: auth.signedInEmail() || '?' })));
    } catch (error) {
        body.replaceChildren(el('p', 'card', t('admin_error', { msg: error.message })));
    }
}
