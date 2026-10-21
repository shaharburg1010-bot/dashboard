// Builds dashboard-import.json (the one-time import file) from the old artifact page.
// Run: node tools/make-import.mjs <original.html> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
const state = JSON.parse(html.match(/<script id="state-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
state.calendars = Function('return ' + html.match(/var CAL_LIST = (\[[\s\S]*?\n  \]);/)[1])();
delete state.currentRoute;
writeFileSync(process.argv[3], JSON.stringify(state, null, 1));
console.log('tasks', state.tasks.length, 'debts', state.debts.length, 'calendars', state.calendars.length);
