// One-time: turn the current artifact dashboard (its embedded state + calendar list) into the Drive data file.
// Run: node tools/migrate.mjs <original.html> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { docFromState, toState } from '../model.js';
import { validateDoc } from '../sync.js';

const html = readFileSync(process.argv[2], 'utf8');
const state = JSON.parse(html.match(/<script id="state-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
// calendar list (was hard-coded in the page) -> data
const calSrc = html.match(/var CAL_LIST = (\[[\s\S]*?\n  \]);/)[1];
state.calendars = Function('return ' + calSrc)();
delete state.currentRoute;
const doc = docFromState(state, new Date().toISOString());
validateDoc(doc);
if (JSON.stringify(toState(JSON.parse(JSON.stringify(doc)))) .length !== JSON.stringify(state).length) console.warn('size mismatch (key order) — check');
writeFileSync(process.argv[3], JSON.stringify(doc, null, 1));
console.log('items:', Object.fromEntries(Object.entries(doc).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])));
console.log('calendars:', state.calendars.length, '| bytes:', JSON.stringify(doc, null, 1).length);
