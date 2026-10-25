// auth.js — signing in with Google. Two methods, because on iPhone home-screen apps one of them
// may not work; the spike's job is to find out which.
//   A) popup  — Google Identity Services (GIS) token client
//   B) redirect — the whole page goes to Google and comes back with the token in the URL
// The token lasts ~1 hour. It's only needed for syncing; the app works offline without it.
import { CLIENT_ID } from './config.js';

// drive = read/write the four MEMORY.md files (Claude rewrites them as new files, which the
// narrower drive.file scope could not see). calendar.readonly = read events to link tasks to them.
export const SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.readonly';
const KEY = 'gtoken';

function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save(token, expiresInSec) {
  try { localStorage.setItem(KEY, JSON.stringify({ token, exp: Date.now() + (Number(expiresInSec) || 3600) * 1000 })); } catch (e) {}
}

export function getToken() {
  const t = read();
  return t && t.exp - 60000 > Date.now() ? t.token : null; // treat as expired 1 min early
}
export function tokenExpiry() { const t = read(); return t ? new Date(t.exp) : null; }
export function signOut() { try { localStorage.removeItem(KEY); } catch (e) {} }
export function isConfigured() { return CLIENT_ID && !CLIENT_ID.startsWith('PASTE'); }

// --- A) popup ---
let gisLoaded = null;
function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve; s.onerror = () => { gisLoaded = null; reject(new Error('could not load Google sign-in (offline?)')); };
    document.head.appendChild(s);
  });
  return gisLoaded;
}
export async function signInPopup() {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error));
        save(r.access_token, r.expires_in); resolve();
      },
      error_callback: (e) => reject(new Error(e && (e.type || e.message) || 'popup failed')),
    });
    client.requestAccessToken({ prompt: localStorage.getItem('gconsented3') ? '' : 'consent' });
  }).then(() => { try { localStorage.setItem('gconsented3', '1'); } catch (e) {} });
}

// --- B) redirect ---
export function redirectUri() { return location.origin + location.pathname; }
export function signInRedirect() {
  const state = Math.random().toString(36).slice(2);
  try { localStorage.setItem('gstate', state); } catch (e) {}
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token',
    scope: SCOPE, include_granted_scopes: 'true', state, prompt: 'select_account',
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}
// Call on page load: picks the token out of the URL after coming back from Google.
export function handleRedirectReturn() {
  if (!location.hash || location.hash.indexOf('access_token') < 0) {
    if (location.hash.indexOf('error=') >= 0) { const e = new URLSearchParams(location.hash.slice(1)).get('error'); history.replaceState(null, '', redirectUri()); return { error: e }; }
    return null;
  }
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', redirectUri()); // remove the token from the address bar
  const expected = localStorage.getItem('gstate');
  if (!expected || p.get('state') !== expected) return { error: 'state mismatch' };
  localStorage.removeItem('gstate');
  save(p.get('access_token'), p.get('expires_in'));
  return { ok: true };
}
