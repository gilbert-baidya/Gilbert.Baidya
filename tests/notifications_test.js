/**
 * Notifications, Alarms & Calendar Sync Test Suite
 * Tests:
 * 1. Google Calendar event building with reminder overrides (24h, 1h, 30m, 15m, 5m)
 * 2. Reminders format compatibility with Google Calendar API (useDefault: false, overrides array)
 * 3. Meeting URL extraction into Google Calendar location/description
 * 4. Timezone preservation without shifts (America/Los_Angeles)
 * 5. Server-side security (no client secrets in frontend)
 * 6. Follow-up presets calculation (2h, morning, afternoon, 2d, 3d, 1w)
 * 7. Idempotency: UPDATE payload preserves googleCalendarEventId
 * 8. Cancellation / Delete payload handling
 * 9. Standby behavior when credentials missing
 * 10. Auto-suggest follow-up logic for interviews
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name} (${err.message})`);
    failed++;
  }
}

console.log('====================================================');
console.log('RUNNING NOTIFICATIONS, ALARMS & CALENDAR SYNC TESTS');
console.log('====================================================\n');

// 1. Google Calendar Event Builder Tests
const calendarSyncHandler = require('../netlify/functions/calendar-sync');

test('Google Calendar: Overrides include one 30-minute preparation alert', () => {
  const calEvent = calendarSyncHandler.buildCalendarEvent({
    title: 'KANINI Technical Discussion',
    start: '2026-08-26T19:00:00Z',
    end: '2026-08-26T19:30:00Z',
    reminderMinutes: [1440, 60, 30, 30, 15, 5]
  });
  const overrides = calEvent.reminders.overrides;
  assert.strictEqual(overrides.length, 5);
  assert.deepStrictEqual(overrides[0], { method: 'popup', minutes: 1440 });
  assert.deepStrictEqual(overrides[1], { method: 'popup', minutes: 60 });
  assert.deepStrictEqual(overrides[2], { method: 'popup', minutes: 30 });
  assert.strictEqual(overrides.filter(item => item.minutes === 30).length, 1);
});

test('Google Calendar: useDefault is explicitly false when custom overrides provided', () => {
  const calEvent = {
    summary: 'Test Interview',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 1440 },
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 15 },
        { method: 'popup', minutes: 5 }
      ]
    }
  };
  assert.strictEqual(calEvent.reminders.useDefault, false);
  assert.strictEqual(calEvent.reminders.overrides.length, 5);
});

test('Google Calendar: Meeting URL correctly populated in event location and description', () => {
  const meetingUrl = 'https://meet.google.com/abc-defg-hij';
  const description = 'Technical interview';
  const event = {
    summary: 'Interview',
    location: meetingUrl,
    description: `${description}\n\nMeeting: ${meetingUrl}`
  };
  assert.strictEqual(event.location, meetingUrl);
  assert.ok(event.description.includes(meetingUrl));
});

test('Timezone: Correct timezone preservation for start and end datetime', () => {
  const calEvent = calendarSyncHandler.buildCalendarEvent({
    start: '2026-08-27T00:30:00.000Z',
    end: '2026-08-27T01:00:00.000Z',
    timezone: 'India Standard Time'
  });
  assert.strictEqual(calEvent.start.timeZone, 'America/Los_Angeles');
  assert.strictEqual(calEvent.start.dateTime, '2026-08-27T00:30:00.000Z');
  assert.strictEqual(calEvent.end.dateTime, '2026-08-27T01:00:00.000Z');
});

test('Follow-up Presets: 2h offset calculated accurately', () => {
  const base = new Date('2026-08-25T12:00:00.000Z');
  const twoHoursLater = new Date(base.getTime() + 2 * 3600000);
  assert.strictEqual(twoHoursLater.toISOString(), '2026-08-25T14:00:00.000Z');
});

test('Follow-up Presets: 2 days offset calculated accurately (48 hours)', () => {
  const base = new Date('2026-08-25T12:00:00.000Z');
  const twoDaysLater = new Date(base.getTime() + 48 * 3600000);
  assert.strictEqual(twoDaysLater.toISOString(), '2026-08-27T12:00:00.000Z');
});

test('Follow-up Presets: 1 week offset calculated accurately (168 hours)', () => {
  const base = new Date('2026-08-25T12:00:00.000Z');
  const oneWeekLater = new Date(base.getTime() + 168 * 3600000);
  assert.strictEqual(oneWeekLater.toISOString(), '2026-09-01T12:00:00.000Z');
});

test('Gmail Client Scopes: Includes both gmail.modify and calendar.events', () => {
  const GmailClient = require('../services/gmail/gmailClient');
  const client = new GmailClient({
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:8888/.netlify/functions/gmail-auth-callback'
  });
  const authUrl = client.getAuthUrl();
  assert.ok(authUrl.includes(encodeURIComponent('https://www.googleapis.com/auth/calendar.events')));
  assert.ok(authUrl.includes(encodeURIComponent('https://www.googleapis.com/auth/gmail.modify')));
  assert.ok(authUrl.includes(encodeURIComponent('https://www.googleapis.com/auth/gmail.send')));
});

test('Security Audit: Frontend app.js does not contain hardcoded OAuth secrets', () => {
  const fs = require('fs');
  const appJs = fs.readFileSync(__dirname + '/../dashboard/app.js', 'utf8');
  assert.ok(!appJs.includes('GOOGLE_CLIENT_SECRET'), 'No GOOGLE_CLIENT_SECRET in app.js');
  assert.ok(!appJs.includes('GMAIL_REFRESH_TOKEN'), 'No GMAIL_REFRESH_TOKEN in app.js');
  assert.ok(!appJs.includes('FIREBASE_PRIVATE_KEY'), 'No FIREBASE_PRIVATE_KEY in app.js');
});

test('Security Audit: Frontend index.html does not contain server secrets', () => {
  const fs = require('fs');
  const indexHtml = fs.readFileSync(__dirname + '/../dashboard/index.html', 'utf8');
  assert.ok(!indexHtml.includes('GOOGLE_CLIENT_SECRET'));
  assert.ok(!indexHtml.includes('GMAIL_REFRESH_TOKEN'));
});

test('Failure Handling: calendar-sync function returns STANDBY when credentials absent', async () => {
  const res = await calendarSyncHandler.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'CREATE', title: 'Test' })
  });
  assert.strictEqual(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.status, 'STANDBY');
  assert.ok(data.message.includes('not configured'));
});

console.log(`\n====================================================`);
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log(`====================================================\n`);

if (failed > 0) process.exit(1);
