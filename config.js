// Paste the OAuth Client ID from Google Cloud here (it is public by design — not a secret).
export const CLIENT_ID = '3930779267-s3guk3f0e2go6hsdc9pg212941d3hcam.apps.googleusercontent.com';

// Where each dashboard page keeps its data: the MEMORY.md inside these Drive folders
// (folder IDs never change, even when Claude rewrites a MEMORY.md as a new file).
export const FOLDERS = {
  tasks:   '1SXs5-XWb_arVaa0r001ZQxnyG7iwZNea', // מקצועי/לו״ז ומשימות
  debts:   '1pD1tFXBsYAHCtsqf_XdlRdONT7TBjB-F', // מקצועי/חובות והלוואות
  finance: '1smPRA38h9pGmtSehxJ9eRWOIwiBv1AaL', // מקצועי/פיננסים
  leisure: '1fpq_NWW_qTKNjWHbaW7_zbCk92NzK9uF', // פנאי/ספורט בישול טיולים וספרים
  spending: '11XB5lXRV6luuYcihFHSeMODkXaMusAMU', // מקצועי/פיננסים/הוצאות
  diet:    '12qrGS1CvH2rb-S8EujE6PiP5fgKCPSVH', // אישי (beside the Google Doc 'עקרונות תזונה - שחר')
  army:    '1p15_WqcyZSQcOH2P6510yj6fHgluO8IH', // צבא (the גיחות page)
};

// Where Claude's agents drop "dashboard-inbox" files (see inbox.js). Same folders as above, except
// diet: its old folder (אישי) was trashed when the vault was reorganised, so agents use תזונה וכושר.
export const INBOX_FOLDERS = { ...FOLDERS, diet: '1mqHEB26hIvncPqmCefMB-JPGk9zHxtXZ' }; // סוכנים/תזונה וכושר

// A read-only copy of all dashboard data, written by the app (server mode) so Claude's agents can see
// current values and item ids before they send changes. Agents never edit it.
export const SNAPSHOT_FOLDER = '1lfwvfm-28Stgvbi_T72oR-pL-V53VZA5'; // life assistant/סוכנים
export const SNAPSHOT_NAME = 'dashboard-snapshot.json';

// Hourly prices, published by the GitHub Action in .github/workflows/prices.yml.
export const PRICES_URL = 'https://raw.githubusercontent.com/shaharburg1010-bot/dashboard/prices/prices.json';

// The sync service on Shahar's own server (server/app.mjs). Reachable only from his devices, through Tailscale.
export const SERVER_URL = 'https://claude-cloud.tail169321.ts.net:8443';
