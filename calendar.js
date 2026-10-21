// calendar.js — replaces the Claude-only connections the dashboard used (window.claude.use(...)).
//   'mcp'      -> Google Calendar, called directly with your Google sign-in
//                 (same calls the dashboard already makes: list_events, get_event)
//   'sample'   -> not available outside Claude (book-author lookup just marks "unknown")
//   'artifact' -> not used any more (saving goes to Drive)
// Linked-event details are cached on the phone, so the chips still show offline.

const API = 'https://www.googleapis.com/calendar/v3';
const CACHE_PREFIX = 'calcache:';

function cacheGet(id) { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + id)); } catch (e) { return null; } }
function cacheSet(id, ev) { try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(ev)); } catch (e) {} }

function errCode(status) {
  if (status === 401 || status === 403) return 'needs_reauth';
  if (status === 404) return 'not_found';
  return 'http_' + status;
}

export function installClaudeShim(getToken) {
  async function call(path) {
    const token = getToken();
    if (!token) { const e = new Error('signed out'); e.code = 'needs_reauth'; throw e; }
    let res;
    try { res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }); }
    catch (e) { const er = new Error('offline'); er.code = 'offline'; throw er; }
    if (!res.ok) { const e = new Error('calendar ' + res.status); e.code = errCode(res.status); throw e; }
    return res.json();
  }

  const mcp = {
    async callTool(server, tool, input) {
      if (tool !== 'list_events') throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      const p = new URLSearchParams({
        timeMin: input.startTime, timeMax: input.endTime, singleEvents: 'true',
        orderBy: 'startTime', maxResults: String(input.pageSize || 8),
      });
      if (input.fullText) p.set('q', input.fullText);
      const j = await call(`/calendars/${encodeURIComponent(input.calendarId)}/events?${p}`);
      return { payload: { events: j.items || [] } };
    },
    watchTool(server, tool, args, cb, opts) {
      if (tool !== 'get_event') return () => {};
      const key = args.calendarId + '|' + args.eventId;
      const cached = cacheGet(key);
      if (cached) cb({ type: 'data', result: { payload: cached } }); // instant, works offline
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const ev = await call(`/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`);
          cacheSet(key, ev);
          if (!stopped) cb({ type: 'data', result: { payload: ev } });
        } catch (e) {
          if (e.code === 'offline' && cached) return; // keep showing the cached time
          if (!stopped) cb({ type: 'error', error: { code: e.code } });
        }
      };
      tick();
      const timer = setInterval(tick, (opts && opts.refetchInterval) || 300000);
      return () => { stopped = true; clearInterval(timer); };
    },
  };

  window.claude = {
    use(name) {
      if (name === 'mcp') return Promise.resolve(mcp);
      if (name === 'artifact') return Promise.resolve(null);
      return Promise.reject(new Error(name + ' is only available inside Claude'));
    },
  };
}
