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
};

// Hourly prices, published by the GitHub Action in .github/workflows/prices.yml.
export const PRICES_URL = 'https://raw.githubusercontent.com/shaharburg1010-bot/dashboard/prices/prices.json';
