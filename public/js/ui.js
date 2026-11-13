// Feed rendering. Everything a visitor wrote goes in through textContent, never as HTML.
import { t } from './i18n.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export function timeLeft(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return t('left_hm', { h: hours, m: minutes });
    return minutes > 0 ? t('left_m', { m: minutes }) : t('left_soon');
}

function lifeFraction(createdAt, expiresAt) {
    const start = new Date(createdAt).getTime();
    const end = new Date(expiresAt).getTime();
    return end > start ? Math.max(0, Math.min(1, (end - Date.now()) / (end - start))) : 0;
}

// "nick(a1b2c3)" is how the app writes an author; show the nickname and keep the device code small.
function authorParts(authorId) {
    const match = /^(.*)\(([0-9a-f]{4,8})\)$/.exec(authorId || '');
    return match ? { name: match[1], id: match[2] } : { name: null, id: authorId || 'anon' };
}

function postCard(post) {
    const card = el('article', 'post');
    card.dataset.created = post.created_at;
    card.dataset.expires = post.expires_at;

    const head = el('header', 'post-head');
    const author = authorParts(post.author_id);
    const who = el('span', 'post-author');
    if (author.name) who.append(el('b', null, author.name), ' ');
    who.append(el('span', 'post-id', author.id));
    head.append(who, el('span', 'post-timer', timeLeft(post.expires_at) || t('left_soon')));
    card.append(head);

    if (post.content) card.append(el('p', 'post-body', post.content));
    if (post.media_url) {
        const image = el('img', 'post-media');
        image.src = post.media_url;
        image.alt = '';
        image.loading = 'lazy';
        card.append(image);
    }
    const life = el('div', 'post-life');
    const bar = el('i');
    bar.style.width = `${lifeFraction(post.created_at, post.expires_at) * 100}%`;
    life.append(bar);
    card.append(life);
    return card;
}

export function renderFeed(container, posts) {
    container.replaceChildren(...(posts.length ? posts.map(postCard) : [el('p', 'empty', t('empty_feed'))]));
}

export function renderStatus(container, text, action) {
    const box = el('p', 'empty', text);
    if (action) {
        const button = el('button', 'btn ghost', action.label);
        button.type = 'button';
        button.addEventListener('click', action.run);
        box.append(document.createElement('br'), button);
    }
    container.replaceChildren(box);
}

// Countdowns and life bars move without reloading the feed; a post that reaches zero leaves the page.
export function tickTimers() {
    document.querySelectorAll('.post').forEach(card => {
        const left = timeLeft(card.dataset.expires);
        if (!left) return card.remove();
        card.querySelector('.post-timer').textContent = left;
        card.querySelector('.post-life i').style.width = `${lifeFraction(card.dataset.created, card.dataset.expires) * 100}%`;
    });
}

let toastTimer;
export function toast(text, kind = 'ok') {
    const box = document.getElementById('toast');
    box.textContent = text;
    box.dataset.kind = kind;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'bad' ? 5000 : 2500);
}
