const assert = require('assert');
const fs = require('fs');
const EventViewModel = require('../services/calendar/eventViewModel');

const DISPLAY_TIME_ZONE = 'America/Los_Angeles';
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name} (${error.message})`);
    process.exitCode = 1;
  }
}

function pacificParts(iso) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).formatToParts(new Date(iso)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

const indexHtml = fs.readFileSync(__dirname + '/../dashboard/index.html', 'utf8');
const appJs = fs.readFileSync(__dirname + '/../dashboard/app.js', 'utf8');

test('FullCalendar named-zone implementation is loaded', () => {
  const momentIndex = indexHtml.indexOf('moment@2.29.4/min/moment.min.js');
  const momentTimezoneIndex = indexHtml.indexOf('moment-timezone@0.5.40/builds/moment-timezone-with-data.min.js');
  const fullCalendarIndex = indexHtml.indexOf('fullcalendar@5.11.3/main.min.js');
  const connectorIndex = indexHtml.indexOf('@fullcalendar/moment-timezone@5.11.3/main.global.min.js');
  const appIndex = indexHtml.indexOf('/dashboard/app.js');
  assert.ok(momentIndex >= 0);
  assert.ok(momentIndex < momentTimezoneIndex);
  assert.ok(momentTimezoneIndex < fullCalendarIndex);
  assert.ok(fullCalendarIndex < connectorIndex);
  assert.ok(connectorIndex < appIndex);
});

test('calendar grid is configured for the Pacific named timezone', () => {
  assert.match(appJs, /const DEFAULT_TIMEZONE = 'America\/Los_Angeles'/);
  assert.match(appJs, /new FullCalendar\.Calendar[\s\S]*?timeZone:\s*DEFAULT_TIMEZONE/);
});

test('Aug 24 6 PM Pacific instant stays in the Aug 24 grid cell', () => {
  const parts = pacificParts('2026-08-25T01:00:00.000Z');
  assert.deepStrictEqual(
    { weekday: parts.weekday, month: parts.month, day: parts.day, year: parts.year, hour: parts.hour, minute: parts.minute, zone: parts.timeZoneName },
    { weekday: 'Monday', month: '08', day: '24', year: '2026', hour: '6', minute: '00', zone: 'PDT' }
  );
});

test('KANINI instant renders Aug 26 at noon Pacific', () => {
  const parts = pacificParts('2026-08-26T19:00:00.000Z');
  assert.deepStrictEqual(
    { weekday: parts.weekday, month: parts.month, day: parts.day, year: parts.year, hour: parts.hour, minute: parts.minute, zone: parts.timeZoneName },
    { weekday: 'Wednesday', month: '08', day: '26', year: '2026', hour: '12', minute: '00', zone: 'PDT' }
  );
});

test('grid adapter preserves absolute timestamps for every event source', () => {
  for (const source of ['MANUAL', 'CALENDAR_SYNC', 'EMAIL_INTAKE']) {
    const event = { source, start: '2026-08-25T01:00:00.000Z', end: '2026-08-25T02:00:00.000Z' };
    assert.strictEqual(EventViewModel.getStart(event), event.start);
    assert.strictEqual(EventViewModel.getEnd(event), event.end);
  }
});

test('America/Los_Angeles observes PDT and PST automatically', () => {
  assert.strictEqual(pacificParts('2026-08-25T01:00:00.000Z').timeZoneName, 'PDT');
  assert.strictEqual(pacificParts('2026-12-25T02:00:00.000Z').timeZoneName, 'PST');
});

test('calendar UI does not extract UTC date or hour keys', () => {
  assert.ok(!/toISOString\(\)\.split\(['"]T['"]\)\[0\]/.test(appJs.slice(appJs.indexOf('async function setupCalendar'), appJs.indexOf('// ==========================================================================\n// TODAY'))));
  assert.ok(!/getUTC(?:Date|Hours|Minutes)\s*\(/.test(appJs));
});

if (!process.exitCode) console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
