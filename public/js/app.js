import { BASE } from './config.js';
import { t, setLanguage, initialLanguage } from './i18n.js';
import * as api from './api.js';
import { getCurrentLocation } from './geofeed.js';
import { renderFeed, renderStatus, tickTimers, toast } from './ui.js';
import { captureLinkResult } from './auth.js';

const $ = id => document.getElementById(id);
const VIEWS = ['space', 'time', 'map', 'me', 'admin'];
const DEFAULT_LABEL = 'time';
const store = {
    get(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
};

let view = 'space';
let label = cleanLabel(store.get('xyzt_last_label', '')) || DEFAULT_LABEL;
let lang = initialLanguage();

// --- Identity: a code per device, plus the nickname the person chose -----------------------------------------
function deviceId() {
    let id = store.get('xyzt_device_id');
    if (!id) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(3)), byte => byte.toString(16).padStart(2, '0')).join('');
        store.set('xyzt_device_id', id);
    }
    return id;
}

function authorId() {
    const nick = store.get('xyzt_nickname', '');
    return nick ? `${nick}(${deviceId()})` : deviceId();
}

// --- Labels ---------------------------------------------------------------------------------------------------
function cleanLabel(text) {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

// Display only: the database computes the real expiry with the same curve (public.label_value).
function labelMinutes(name) {
    const length = name.length;
    if (length === 7) return 110;
    if (length >= 1 && length < 7) return 10 + Math.floor(1 + (99 / 6) * (length - 1));
    if (length > 7 && length <= 30) return 10 + Math.floor(100 - (99 / 23) * (length - 7));
    return 11;
}

// --- Routing: "/" is Space, "/<label>" a label, "#map" and "#me" the other two views ----------------------------
function readLocation() {
    const hash = location.hash.slice(1);
    if (hash === 'map' || hash === 'me' || hash === 'admin') return { view: hash };
    const segment = decodeURIComponent(location.pathname.slice(BASE.length)).split('/')[0];
    const name = /\.html$/.test(segment) ? '' : cleanLabel(segment);
    return name ? { view: 'time', label: name } : { view: 'space' };
}

function urlFor(target, name = label) {
    return { space: BASE, time: BASE + name, map: `${BASE}#map`, me: `${BASE}#me`, admin: `${BASE}#admin` }[target];
}

function navigate(target, name) {
    history.pushState({}, '', urlFor(target, name));
    show();
}

function show() {
    const target = readLocation();
    view = target.view;
    if (target.label) {
        label = target.label;
        store.set('xyzt_last_label', label);
    }
    VIEWS.forEach(name => { $(`view-${name}`).hidden = name !== view; });
    document.querySelectorAll('#tabs a').forEach(tab => {
        if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
        tab.href = urlFor(tab.dataset.view);
    });
    $('fab').hidden = view !== 'space' && view !== 'time';
    document.title = view === 'time' ? `#${label} · xyzt` : 'xyzt · spacetime';
    ({ space: loadSpace, time: showTime, map: showMap, me: showMe, admin: showAdmin })[view]();
}

// --- Space ----------------------------------------------------------------------------------------------------
// The browser reports why it has no position with a code (1 denied, 2 unavailable, 3 timeout) and English text.
function gpsMessage(error) {
    const key = { 1: 'gps_denied', 2: 'gps_unavailable', 3: 'gps_timeout' }[error.code];
    return key ? t(key) : t('gps_error', { msg: error.message });
}

async function loadSpace({ forceGps = false, quiet = false } = {}) {
    const feed = $('space-feed');
    const button = $('btn-refresh-gps');
    if (!quiet) renderStatus(feed, t('gps_searching'));
    button.classList.add('busy');
    try {
        let coords;
        try {
            coords = await getCurrentLocation(forceGps);
        } catch (error) {
            if (!quiet) renderStatus(feed, gpsMessage(error), { label: t('retry'), run: () => loadSpace({ forceGps: true }) });
            return;
        }
        renderFeed(feed, await api.fetchSpacePosts(coords.lat, coords.lon));
    } catch (error) {
        if (!quiet) renderStatus(feed, t('load_error', { msg: error.message }), { label: t('retry'), run: () => loadSpace() });
    } finally {
        button.classList.remove('busy');
    }
}

// --- Time -----------------------------------------------------------------------------------------------------
function showTime() {
    $('current-label').textContent = label;
    $('time-sub').textContent = t('time_sub', { n: labelMinutes(label) });
    updateSubscribeButton();
    loadRecentLabels();
    loadTime();
}

async function loadTime({ quiet = false } = {}) {
    const shown = label;
    const feed = $('time-feed');
    if (!quiet) renderStatus(feed, t('loading'));
    try {
        const posts = await api.fetchTimePosts(shown);
        if (shown === label) renderFeed(feed, posts);
    } catch (error) {
        if (!quiet && shown === label) renderStatus(feed, t('load_error', { msg: error.message }), { label: t('retry'), run: () => loadTime() });
    }
}

async function loadRecentLabels() {
    let labels = [];
    try {
        labels = await api.fetchRecentLabels();
    } catch { /* the list is a shortcut: without it the page still works */ }
    const pills = labels.map(row => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pill';
        pill.textContent = `#${row.category_id}`;
        pill.addEventListener('click', () => navigate('time', row.category_id));
        return pill;
    });
    $('recent-labels').replaceChildren(...pills);
    $('recent-block').hidden = pills.length === 0;
}

// --- Notifications for labels the person follows: checked from this page while it is open ----------------------
let subscriptions = [];
try { subscriptions = JSON.parse(store.get('xyzt_subscriptions', '[]')) || []; } catch { subscriptions = []; }

function updateSubscribeButton() {
    const on = subscriptions.includes(label);
    $('btn-subscribe').textContent = t(on ? 'btn_stop_listen' : 'btn_listen');
    $('btn-subscribe').classList.toggle('on', on);
    $('btn-subscribe').hidden = !('Notification' in window);
}

async function toggleSubscription() {
    const name = label;
    if (subscriptions.includes(name)) {
        subscriptions = subscriptions.filter(item => item !== name);
        toast(t('notif_off', { label: name }));
    } else {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') return toast(t('notif_denied'), 'bad');
        subscriptions.push(name);
        // Start from what is already there: only posts written from now on raise a notification.
        const newest = (await api.fetchTimePosts(name).catch(() => []))[0];
        if (newest) store.set(`notif_last_id_${name}`, newest.id);
        toast(t('notif_on', { label: name }));
    }
    store.set('xyzt_subscriptions', JSON.stringify(subscriptions));
    updateSubscribeButton();
}

async function checkSubscriptions() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (const name of subscriptions) {
        const newest = (await api.fetchTimePosts(name).catch(() => []))[0];
        if (!newest || newest.id === store.get(`notif_last_id_${name}`)) continue;
        store.set(`notif_last_id_${name}`, newest.id);
        new Notification(t('notif_title', { label: name }), { body: newest.content || '', icon: 'favicon.svg' });
    }
}

// --- Map ------------------------------------------------------------------------------------------------------
let map = null;
let markers = null;

// OpenStreetMap's own tiles (the CARTO ones the app used now ask for an API key); the dark theme darkens them in CSS.
function addTiles() {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(map);
}

function drawPoints(points) {
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    markers.clearLayers();
    points.forEach(point => L.circleMarker([point.lat, point.lon], { color: colour, weight: 2, radius: 7, fillOpacity: 0.7 }).addTo(markers));
}

async function showMap() {
    if (!window.L) return;
    if (!map) {
        map = L.map('map').setView([42.5, 12.5], 5);
        markers = L.layerGroup().addTo(map);
        addTiles();
    }
    map.invalidateSize();
    getCurrentLocation().then(coords => map.setView([coords.lat, coords.lon], 13)).catch(() => { /* stay on the wide view */ });
    try {
        drawPoints(await api.fetchMapPoints());
    } catch (error) {
        toast(t('load_error', { msg: error.message }), 'bad');
    }
}

// --- Me: nickname, language, theme, contact ---------------------------------------------------------------------
function showMe() {
    $('profile-desc').textContent = t('profile_desc', { id: deviceId() });
    $('input-nickname').value = store.get('xyzt_nickname', '');
    document.querySelectorAll('#lang-seg button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lang === lang)));
    const theme = store.get('xyzt_theme', 'auto');
    document.querySelectorAll('#theme-seg button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
}

function setTheme(choice) {
    store.set('xyzt_theme', choice);
    if (choice === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
    showMe();
}

async function sendContact(event) {
    event.preventDefault();
    const message = $('contact-message').value.trim();
    if (!message) return toast(t('contact_need_msg'), 'bad');
    const button = $('btn-send-contact');
    button.disabled = true;
    button.textContent = t('contact_sending');
    try {
        // A filled bait field means a bot: answer as if it had worked and store nothing.
        if (!$('contact-website').value) await api.sendContactMessage($('contact-email').value.trim(), message);
        $('contact-form').reset();
        toast(t('contact_success_alert'));
    } catch (error) {
        toast(t('contact_error', { msg: error.message }), 'bad');
    } finally {
        button.disabled = false;
        button.textContent = t('contact_send_btn');
    }
}

// --- Admin: its code is loaded only when someone opens #admin -----------------------------------------------------
let linkError = null;

async function showAdmin() {
    const admin = await import('./admin.js');
    admin.showAdmin($('admin-body'), $('admin-signout'), linkError);
    linkError = null;
}

// --- Compose --------------------------------------------------------------------------------------------------
function openCompose() {
    $('compose-context').textContent = view === 'space' ? t('compose_space') : t('compose_time', { label, n: labelMinutes(label) });
    $('compose-error').hidden = true;
    $('compose').showModal();
    $('post-content').focus();
}

function showPhoto() {
    const file = $('post-media').files[0];
    const preview = $('photo-preview');
    const image = preview.querySelector('img');
    if (image.src) URL.revokeObjectURL(image.src);
    preview.hidden = !file;
    if (file) image.src = URL.createObjectURL(file);
    else image.removeAttribute('src');
}

function composeError(text) {
    $('compose-error').textContent = text;
    $('compose-error').hidden = false;
}

async function publish(event) {
    event.preventDefault();
    const content = $('post-content').value.trim();
    const file = $('post-media').files[0];
    if (!content && !file) return composeError(t('need_content'));
    const button = $('btn-publish');
    button.disabled = true;
    button.textContent = t('publishing');
    $('compose-error').hidden = true;
    try {
        if (view === 'space') {
            const coords = await getCurrentLocation().catch(error => { throw new Error(gpsMessage(error)); });
            await api.publishSpacePost({ content, authorId: authorId(), lat: coords.lat, lon: coords.lon, file });
        } else {
            await api.publishTimePost({ content, authorId: authorId(), label, file });
        }
        $('compose-form').reset();
        showPhoto();
        $('compose').close();
        toast(t('published'));
        if (view === 'space') loadSpace({ quiet: true });
        else { loadTime({ quiet: true }); loadRecentLabels(); }
    } catch (error) {
        composeError(t('publish_error', { msg: error.message }));
    } finally {
        button.disabled = false;
        button.textContent = t('post_btn');
    }
}

// --- Wiring ---------------------------------------------------------------------------------------------------
$('home-link').addEventListener('click', event => { event.preventDefault(); navigate('space'); });
document.querySelectorAll('#tabs a').forEach(tab => tab.addEventListener('click', event => {
    event.preventDefault();
    navigate(tab.dataset.view);
}));
window.addEventListener('popstate', show);

$('btn-refresh-gps').addEventListener('click', () => loadSpace({ forceGps: true }));
$('btn-subscribe').addEventListener('click', toggleSubscription);
$('label-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = cleanLabel($('input-search-label').value);
    $('input-search-label').value = '';
    if (name) navigate('time', name);
});

$('profile-form').addEventListener('submit', event => {
    event.preventDefault();
    store.set('xyzt_nickname', $('input-nickname').value.replace(/[()]/g, '').trim().slice(0, 30));
    toast(t('profile_saved_alert'));
    showMe();
});
document.querySelectorAll('#lang-seg button').forEach(button => button.addEventListener('click', () => {
    lang = button.dataset.lang;
    setLanguage(lang);
    show();
}));
document.querySelectorAll('#theme-seg button').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
$('contact-form').addEventListener('submit', sendContact);

$('fab').addEventListener('click', openCompose);
$('compose-form').addEventListener('submit', publish);
$('compose-cancel').addEventListener('click', () => $('compose').close());
$('compose').addEventListener('click', event => { if (event.target === $('compose')) $('compose').close(); });
$('post-media').addEventListener('change', showPhoto);
$('photo-remove').addEventListener('click', () => { $('post-media').value = ''; showPhoto(); });

setInterval(tickTimers, 30000);
setInterval(() => {
    if (document.visibilityState === 'visible') {
        if (view === 'space' && $('space-feed').querySelector('.post')) loadSpace({ quiet: true });
        if (view === 'time') loadTime({ quiet: true });
    }
    checkSubscriptions();
}, 60000);

// Coming back from the e-mailed sign-in link: keep the session, drop the tokens from the address, open the admin page.
const linkResult = captureLinkResult();
if (linkResult) {
    if (linkResult !== 'signed-in') linkError = linkResult;
    history.replaceState({}, '', urlFor('admin'));
}

setLanguage(lang);
show();
