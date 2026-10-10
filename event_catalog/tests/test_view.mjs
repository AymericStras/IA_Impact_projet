import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../sncf_events/web/view.js',import.meta.url),'utf8');
const {safeURL,addDays,stamp,slotLabel,errorText,railLabel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
assert.equal(safeURL('javascript:alert(1)'),null);
assert.equal(safeURL('https://user:secret@example.com'),null);
assert.equal(safeURL('https://example.com/events'),'https://example.com/events');
assert.equal(addDays('2026-10-25',1),'2026-10-26');
assert.equal(addDays('2026-12-31',1),'2027-01-01');
assert.match(stamp('2026-10-25T23:30:00Z'),/26.*10.*2026.*00:30/);
assert.equal(slotLabel({precision:'date',start_date:'2026-10-12',end_date:'2026-10-12'}),'2026-10-12');
assert.equal(slotLabel(null),'Time not published');
assert.match(errorText('storage_budget_reached'),/Collection paused/);
console.log('9 browser presentation checks passed (URL safety, Paris dates, unknown times, budget feedback).');

assert.equal(railLabel({status:'unknown'}),'Walking route unverified');
assert.match(railLabel({status:'within_20_min',station_name:'Toulouse',walking_seconds:1199,walking_metres:1100}),/20 min/);
assert.match(railLabel({status:'outside'}),/Over 20/);
console.log('3 railway presentation checks passed.');
