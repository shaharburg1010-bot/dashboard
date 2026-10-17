# הדשבורד של שחר: גרסת ניסוי (Spike)

אפליקציה מינימלית שבודקת שלושה דברים לפני שבונים את הדשבורד המלא:

1. **התחברות ל-Google:** האם היא עובדת מתוך אפליקציה שהותקנה על מסך הבית באייפון.
2. **עבודה בלי רשת:** האפליקציה נפתחת, מציגה ושומרת שינויים גם בלי קליטה.
3. **סנכרון:** כל שינוי מגיע ל-Google Drive בלי לאבד מידע, ושינויים של Claude ב-Drive מגיעים לאפליקציה.

## מבנה הקבצים

| קובץ | תפקיד |
|---|---|
| `index.html` | המסך |
| `app.js` | שומר כל פעולה במכשיר, ומפעיל סנכרון כשאפשר |
| `sync.js` | הלב: מיזוג, תור שינויים, בדיקה אחרי כתיבה, שחזור |
| `store.js` | מסד הנתונים בטלפון (IndexedDB) |
| `drive.js` | הקובץ היחיד שמדבר עם Google Drive |
| `auth.js` | התחברות ל-Google: חלון קופץ או מעבר עמוד |
| `config.js` | ה-Client ID מ-Google Cloud |
| `sw.js` | Service Worker, לקבצי הקוד בלבד |
| `tests/` | בדיקות אוטומטיות. הן לא נטענות באפליקציה |

## הגדרה חד-פעמית ב-Google Cloud (כ-15 דקות)

1. היכנס ל-https://console.cloud.google.com עם החשבון shaharburg1010@gmail.com, וצור פרויקט חדש בשם `dashboard`.
2. ב-**APIs & Services → Library** חפש **Google Drive API** ולחץ **Enable**.
3. ב-**Google Auth Platform** (בממשק הישן: OAuth consent screen) לחץ **Get started**:
   - **App name:** `Shahar Dashboard`
   - **Support email:** המייל שלך
   - **Audience:** בחר **External**
   - **Contact email:** המייל שלך
4. ב-**Audience → Test users** לחץ **Add users** והוסף את `shaharburg1010@gmail.com`.
5. ב-**Clients → Create client** בחר **Web application**, ומלא:
   - **Authorized JavaScript origins:** `https://shaharburg1010-bot.github.io`
   - **Authorized redirect URIs:** `https://shaharburg1010-bot.github.io/dashboard/`
6. לחץ **Create** והעתק את ה-**Client ID**. הוא נגמר ב-`.apps.googleusercontent.com`.
7. ב-GitHub ערוך את `config.js` והדבק את ה-Client ID במקום הטקסט `PASTE_CLIENT_ID_HERE...`.

ה-Client ID ציבורי מעצם הגדרתו, ומותר שיופיע בקוד. אין כאן שום סוד.

בהתחברות הראשונה Google יציג אזהרה "Google hasn't verified this app". זה תקין לאפליקציה שבמצב בדיקה. לוחצים **Continue**.

## העלאה ל-GitHub

1. צור repository חדש בשם **`dashboard`**, ציבורי.
2. העלה את כל הקבצים. את התיקייה `tests` אפשר להעלות או לא.
3. ב-**Settings → Pages** בחר **Deploy from a branch**, ואז **main** ו-**/ (root)**.
4. הכתובת: `https://shaharburg1010-bot.github.io/dashboard/`

## רשימת בדיקות באייפון

| # | בדיקה | מה אמור לקרות |
|---|---|---|
| 1 | פתח את הכתובת בספארי ולחץ "התחבר עם Google (חלון)" | הסטטוס מתחלף ל"מסונכרן עם Drive ✓", וב-Drive מופיע `dashboard-data.json` |
| 2 | הוסף משימה | תוך כ-2 שניות שוב "מסונכרן" |
| 3 | "שתף" ← "הוסף למסך הבית", ופתח מהאייקון | נפתח במסך מלא |
| 4 | באפליקציה המותקנת לחץ "התנתק" ואז "התחבר (חלון)" | **לרשום אם עבד.** אם לא, לנסות "התחבר (מעבר עמוד)" ולרשום |
| 5 | מצב טיסה, פתח מהאייקון, הוסף 2 משימות וסמן אחת | הכול מופיע, והסטטוס "אין רשת · 3 ממתינים" |
| 6 | סגור את האפליקציה לגמרי (החלקה למעלה) ופתח שוב, עדיין במצב טיסה | הכול עדיין שם |
| 7 | בטל מצב טיסה ופתח את האפליקציה | "מסונכרן", והקובץ ב-Drive מכיל את 3 השינויים |
| 8 | בקש מ-Claude להוסיף משימה לקובץ ב-Drive, ואז פתח את האפליקציה | המשימה של Claude מופיעה |

בכל שלב, תחת **"פרטים טכניים"**, יש יומן שמראה מה קרה. אם משהו נכשל, צלם אותו מסך ושלח.

## הרצת הבדיקות האוטומטיות (במחשב, לא חובה)

```
node --test tests/sync.test.js        # 18 בדיקות של מנוע הסנכרון, כולל 300 תרחישים אקראיים
python3 -m http.server 8790 & node tests/e2e.mjs   # 12 בדיקות בדפדפן (דורש Playwright)
```
