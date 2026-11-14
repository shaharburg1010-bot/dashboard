# שירות הסנכרון של הדשבורד (בשרת)

במקום Google Drive, הדשבורד מסתנכרן מול שירות קטן שרץ בשרת של שחר ושומר את הנתונים ב-SQLite
(`~/.openclaw/workspace/data/life.db`, טבלאות `dash_sections`, `dash_items`, `dash_history`).
השירות מאזין רק ל-127.0.0.1. Tailscale שם לפניו HTTPS, כך שרק המכשירים של שחר מגיעים אליו.
**אין כאן נתונים אישיים**: ה-repo ציבורי ומכיל רק קוד.

| קובץ | תפקיד |
|---|---|
| `store.mjs` | קריאה וכתיבה ל-SQLite. מיזוג השינויים נעשה בקוד של האפליקציה (`../sync.js`) |
| `app.mjs` | ה-HTTP: `GET/PUT /v1/sections/<תחום>`, `POST /v1/ops`, `GET /v1/health` |
| `dashboard-sync.service` | יחידת systemd (משתמש `claw`) |
| `../serverdrive.js` | הצד של האפליקציה: מחליף את החיבור ל-Drive |

## כללים שהשירות אוכף
- כתיבה מתקבלת רק אם היא מבוססת על הגרסה האחרונה (אחרת 409, והאפליקציה ממזגת ומנסה שוב).
- כתיבה שמעלימה פריט קיים נדחית. מחיקה = `deleted: true`.
- 30 הגרסאות האחרונות של כל תחום נשמרות ב-`dash_history`.
- OpenClaw לא כותב ישירות לטבלאות `dash_*`. הוא שולח שינויים ל-`POST /v1/ops`:
  `{"by":"openclaw","ops":[{"coll":"tasks","id":"t_abc","fields":{"text":"...","done":false,"deleted":false},"at":"<ISO time>"}]}`

## התקנה בשרת (פעם אחת, כמשתמש claw)
```
git clone https://github.com/shaharburg1010-bot/dashboard.git ~/dashboard
mkdir -p ~/.config/systemd/user && cp ~/dashboard/server/dashboard-sync.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now dashboard-sync
curl -s http://127.0.0.1:8787/v1/health
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```
עדכון גרסה: `cd ~/dashboard && git pull && systemctl --user restart dashboard-sync`.

## בדיקות
`node --test tests/*.test.js` (כולל `tests/server.test.js`: מנוע הסנכרון האמיתי מול השירות האמיתי).
