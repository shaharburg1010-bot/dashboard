# שירות הסנכרון של הדשבורד (בשרת)

במקום Google Drive, הדשבורד מסתנכרן מול שירות קטן שרץ בשרת של שחר ושומר את הנתונים ב-SQLite
(`~/dashboard-data/life.db`, טבלאות `dash_sections`, `dash_items`, `dash_history`).
השירות מאזין רק ל-127.0.0.1. Tailscale שם לפניו HTTPS, כך שרק המכשירים של שחר מגיעים אליו.
**אין כאן נתונים אישיים**: ה-repo ציבורי ומכיל רק קוד.

| קובץ | תפקיד |
|---|---|
| `store.mjs` | קריאה וכתיבה ל-SQLite. מיזוג השינויים נעשה בקוד של האפליקציה (`../sync.js`) |
| `app.mjs` | ה-HTTP: `GET/PUT /v1/sections/<תחום>`, `POST /v1/ops`, `POST /v1/set`, `GET /v1/history/<תחום>`, `GET /v1/health` |
| `API.md` | איך מעדכנים נתונים מהשרת (Claude או כל סקריפט), ומאיפה עמוד הפיננסים קורא כל מספר |
| `dashboard-sync.service` | יחידת systemd (משתמש `claw`) |
| `prices.mjs` | מחירי ני"ע כל 20 דקות (`tools/fetch-prices.mjs`), נשמרים ב-`~/dashboard-data/prices.json` ומוגשים ב-`GET /v1/prices`. מחליף את ה-GitHub Action (שנשאר כגיבוי ידני) |
| `bridge.mjs` | עבודת ה-Drive של השרת: קבצי `dashboard-inbox`, תיק ההשקעות, `dashboard-snapshot.json`, גיבוי יומי של `life.db` |
| `gdrive.mjs` | חיבור ל-Drive עם הרשאה קבועה (refresh token) |
| `google-auth.mjs` | יצירת ההרשאה הקבועה, פעם אחת |
| `../serverdrive.js` | הצד של האפליקציה: מחליף את החיבור ל-Drive |

## כללים שהשירות אוכף
- כתיבה מתקבלת רק אם היא מבוססת על הגרסה האחרונה (אחרת 409, והאפליקציה ממזגת ומנסה שוב).
- כתיבה שמעלימה פריט קיים נדחית. מחיקה = `deleted: true`.
- 30 הגרסאות האחרונות של כל תחום נשמרות ב-`dash_history`.
- לא כותבים ישירות לטבלאות `dash_*`. שולחים שינויים ל-`POST /v1/ops`:
  `{"by":"claude","ops":[{"coll":"tasks","id":"t_abc","fields":{"text":"...","done":false,"deleted":false},"at":"<ISO time>"}]}`

- בלוק שלם (למשל `finance.shortMedium`) נשמר כערך אחד. כתיבה מסקריפט שמעלימה חלקים ממנו נדחית.
  ערך בודד מעדכנים ב-`POST /v1/set` עם נתיב: `{"by":"claude","sets":[{"path":"finance.shortTerm.total","value":2181}]}`.
- `GET /v1/history/<תחום>` ו-`GET /v1/history/<תחום>/<גרסה>` מחזירים עותקים קודמים, לשחזור.

## התקנה בשרת (פעם אחת, כמשתמש claw)
```
git clone https://github.com/shaharburg1010-bot/dashboard.git ~/dashboard
mkdir -p ~/.config/systemd/user && cp ~/dashboard/server/dashboard-sync.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now dashboard-sync
curl -s http://127.0.0.1:8787/v1/health
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```
עדכון גרסה: `cd ~/dashboard && git pull && systemctl --user restart dashboard-sync`.

## סנכרון אוטומטי מול Drive (מ-23.11.2026)
השירות עצמו בודק כל 2 דקות (`DASH_BRIDGE_MINUTES`) את תיקיות ה-inbox, מחיל, מעביר לפח, מחיל את בלוק `json portfolio`
מ-`תיק השקעות.md`, כותב `dashboard-snapshot.json` כשהנתונים השתנו, ופעם ביום מעלה עותק של `life.db` לתיקייה
`סוכנים/גיבוי דשבורד` (14 אחרונים נשמרים). כפתור "סנכרן עכשיו" באפליקציה קורא ל-`POST /v1/pull` ומפעיל בדיקה מיד.
`GET /v1/status` מחזיר מתי נבדק לאחרונה ומה נקלט.

הרשאה קבועה, פעם אחת:
1. Google Cloud Console, אותו פרויקט של הדשבורד: APIs & Services > Credentials > Create credentials > OAuth client ID > **Desktop app**.
   בחלון שנפתח: Download JSON (קובץ `client_secret_....json`), ולהעתיק אותו לשרת.
2. OAuth consent screen > Publishing status: **In production** (ב-Testing גוגל מבטלת את ההרשאה אחרי 7 ימים).
3. בשרת: `cd ~/dashboard && node server/google-auth.mjs url <הקובץ client_secret_....json>` (ואחרי זה למחוק את הקובץ), לפתוח את הקישור בכל מחשב,
   להתחבר כ-shaharburg1010@gmail.com ולאשר (מסך "האפליקציה לא אומתה" > Advanced > Go to). הדפדפן יגיע לכתובת `http://127.0.0.1:53682/?code=...` שלא נטענת. זה תקין.
4. `node server/google-auth.mjs code '<הכתובת המלאה>'` ואז `systemctl --user restart dashboard-sync`.
   ההרשאה נשמרת ב-`~/.config/dashboard-sync/google.json` (הרשאות 600, מחוץ ל-repo). Scope: `drive` (קבצי ה-inbox נוצרים על ידי אפליקציה אחרת).
5. בדיקה: `curl -s http://127.0.0.1:8787/v1/status` → `configured: true` ו-`lastOk` עם שעה.

בלי הקובץ השירות עובד כמו קודם, והאפליקציה ממשיכה לקלוט inbox כשהיא מחוברת לגוגל.
מעבר למיני PC: להעתיק את `life.db` ואת `~/.config/dashboard-sync/google.json`, ולהתקין כמו למעלה.

## בדיקות
`node --test tests/*.test.js` (כולל `tests/server.test.js`: מנוע הסנכרון האמיתי מול השירות האמיתי).
