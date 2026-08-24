const assert = require('assert');
const TimeEngine = require('../services/calendar/interviewTimeEngine');

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

const interview = {
  id: 'kanini',
  title: 'KANINI - Technical Discussion',
  start: '2026-08-26T19:00:00.000Z',
  end: '2026-08-26T19:30:00.000Z',
  timezone: 'America/Los_Angeles'
};

function event(id, start, end) {
  return { id, title: id, start, end, source: 'TEST' };
}

test('countdown greater than 24 hours', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, '2026-08-24T19:00:00Z').label, 'Starts in 2 days');
});

test('countdown under 24 hours includes hours and minutes', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, '2026-08-26T00:18:00Z').label, 'Starts in 18h 42m');
});

test('countdown under 60 minutes shows exact minutes', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, '2026-08-26T18:13:00Z').label, 'Starts in 47 minutes');
});

test('countdown under 15 minutes becomes urgent', () => {
  const countdown = TimeEngine.calculateInterviewCountdown(interview, '2026-08-26T18:46:00Z');
  assert.strictEqual(countdown.state, 'URGENT');
  assert.strictEqual(countdown.label, 'STARTING IN 14 MINUTES');
});

test('countdown at start reports starting now', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, interview.start).label, 'STARTING NOW');
});

test('countdown during event reports in progress', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, '2026-08-26T19:10:00Z').label, 'IN PROGRESS');
});

test('countdown after event reports elapsed minutes', () => {
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(interview, '2026-08-26T19:42:00Z').label, 'Ended 12 minutes ago');
});

test('preparation window is exactly 30 minutes', () => {
  const preparation = TimeEngine.calculatePreparationWindow(interview);
  assert.strictEqual(preparation.start.toISOString(), '2026-08-26T18:30:00.000Z');
  assert.strictEqual(preparation.end.toISOString(), interview.start);
});

test('no conflict preserves full preparation time', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [interview, event('early', '2026-08-26T17:00:00Z', '2026-08-26T18:00:00Z')]);
  assert.strictEqual(result.level, 'NONE');
  assert.strictEqual(result.availablePreparationMinutes, 30);
});

test('full interview overlap is critical', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('meeting', interview.start, interview.end)]);
  assert.strictEqual(result.level, 'INTERVIEW');
  assert.strictEqual(result.conflicts[0].interviewOverlapMinutes, 30);
});

test('partial interview overlap reports overlap amount', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('meeting', '2026-08-26T19:15:00Z', '2026-08-26T20:00:00Z')]);
  assert.strictEqual(result.level, 'INTERVIEW');
  assert.strictEqual(result.conflicts[0].interviewOverlapMinutes, 15);
});

test('full preparation overlap leaves no preparation time', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('meeting', '2026-08-26T18:30:00Z', interview.start)]);
  assert.strictEqual(result.level, 'PREPARATION');
  assert.strictEqual(result.availablePreparationMinutes, 0);
});

test('partial preparation overlap calculates remaining time', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('meeting', '2026-08-26T18:30:00Z', '2026-08-26T18:45:00Z')]);
  assert.strictEqual(result.level, 'PREPARATION');
  assert.strictEqual(result.availablePreparationMinutes, 15);
});

test('meeting ending ten minutes before interview leaves ten minutes', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('meeting', '2026-08-26T18:00:00Z', '2026-08-26T18:50:00Z')]);
  assert.strictEqual(result.availablePreparationMinutes, 10);
});

test('back-to-back interview and preparation boundary is accepted', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('prior-interview', '2026-08-26T18:00:00Z', '2026-08-26T18:30:00Z')]);
  assert.strictEqual(result.level, 'NONE');
  assert.strictEqual(result.availablePreparationMinutes, 30);
  assert.strictEqual(result.boundaryEvents.length, 1);
});

test('previous interview leaving fifteen minutes produces prep warning', () => {
  const result = TimeEngine.detectInterviewConflict(interview, [event('prior-interview', '2026-08-26T18:00:00Z', '2026-08-26T18:45:00Z')]);
  assert.strictEqual(result.level, 'PREPARATION');
  assert.strictEqual(result.availablePreparationMinutes, 15);
});

test('multiple same-day interviews sort by start ascending', () => {
  const values = TimeEngine.sortInterviews([
    event('second', '2026-08-26T21:00:00Z', '2026-08-26T21:30:00Z'),
    interview,
    event('first', '2026-08-26T17:00:00Z', '2026-08-26T17:30:00Z')
  ]);
  assert.deepStrictEqual(values.map(value => value.id), ['first', 'kanini', 'second']);
});

test('duplicate event representations do not create false extra overlap', () => {
  const duplicateA = event('same', '2026-08-26T18:30:00Z', '2026-08-26T18:50:00Z');
  const duplicateB = { ...duplicateA };
  const result = TimeEngine.detectInterviewConflict(interview, [duplicateA, duplicateB]);
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.availablePreparationMinutes, 10);
});

test('Pacific timezone display includes PDT and local noon', () => {
  const formatted = TimeEngine.formatInterviewDateTime(interview, 'America/Los_Angeles');
  assert.strictEqual(formatted.startTime, '12:00 PM');
  assert.strictEqual(formatted.timeZone, 'PDT');
});

test('New York and UTC displays preserve the same instant', () => {
  assert.strictEqual(TimeEngine.formatInterviewDateTime(interview, 'America/New_York').startTime, '3:00 PM');
  assert.strictEqual(TimeEngine.formatInterviewDateTime(interview, 'UTC').startTime, '7:00 PM');
});

test('task date and time format in the interview timezone', () => {
  const local = TimeEngine.formatLocalDateTime('2026-08-26T18:30:00Z', 'America/Los_Angeles');
  assert.deepStrictEqual(local, { date: '2026-08-26', time: '11:30' });
});

test('Windows India timezone alias is normalized for browser formatting', () => {
  assert.strictEqual(TimeEngine.normalizeTimeZone('India Standard Time'), 'Asia/Kolkata');
  const local = TimeEngine.formatLocalDateTime('2026-08-26T18:30:00Z', 'India Standard Time');
  assert.deepStrictEqual(local, { date: '2026-08-27', time: '00:00' });
});

test('unknown timezone safely falls back to Pacific time', () => {
  assert.strictEqual(TimeEngine.normalizeTimeZone('Unknown Corporate Time'), 'America/Los_Angeles');
});

test('DST-safe countdown uses absolute timestamps', () => {
  const dstInterview = event('dst', '2026-03-08T10:30:00Z', '2026-03-08T11:00:00Z');
  const countdown = TimeEngine.calculateInterviewCountdown(dstInterview, '2026-03-08T09:30:00Z');
  assert.strictEqual(countdown.label, 'Starts in 60 minutes');
});

test('India organizer instant displays in user Pacific timezone', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:india\nDTSTART;TZID=Asia/Kolkata:20260827T060000\nDTEND;TZID=Asia/Kolkata:20260827T063000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-27T00:30:00.000Z');
  assert.strictEqual(parsed.sourceTimezone, 'Asia/Kolkata');
  const display = TimeEngine.formatInterviewDateTime(parsed);
  assert.strictEqual(display.date, 'AUG 26, 2026');
  assert.strictEqual(display.label, '5:30 PM – 6:00 PM PDT');
});

test('Chicago organizer instant displays in user Pacific timezone', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:central\nDTSTART;TZID=America/Chicago:20260826T140000\nDTEND;TZID=America/Chicago:20260826T143000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-26T19:00:00.000Z');
  assert.strictEqual(TimeEngine.formatInterviewDateTime(parsed).startTime, '12:00 PM');
});

test('New York organizer instant displays in user Pacific timezone', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:eastern\nDTSTART;TZID=America/New_York:20260826T150000\nDTEND;TZID=America/New_York:20260826T153000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-26T19:00:00.000Z');
  assert.strictEqual(TimeEngine.formatInterviewDateTime(parsed).startTime, '12:00 PM');
});

test('UTC DTSTART preserves its absolute instant and displays Pacific', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:utc\nDTSTART:20260826T190000Z\nDTEND:20260826T193000Z\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-26T19:00:00.000Z');
  assert.strictEqual(parsed.sourceTimezone, 'UTC');
  assert.strictEqual(parsed.timezoneAmbiguous, false);
  assert.strictEqual(TimeEngine.formatInterviewDateTime(parsed).startTime, '12:00 PM');
});

test('floating DTSTART uses home-zone fallback and requires review', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:floating\nDTSTART:20260826T120000\nDTEND:20260826T123000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-26T19:00:00.000Z');
  assert.strictEqual(parsed.sourceTimezone, null);
  assert.strictEqual(parsed.timezoneAmbiguous, true);
  assert.strictEqual(parsed.needsReview, true);
});

test('unresolved TZID is preserved and never displayed as organizer time', () => {
  const parsed = require('../services/calendar/icsParser').parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:unknown-zone\nDTSTART;TZID=Mars/Recruiting:20260826T120000\nDTEND;TZID=Mars/Recruiting:20260826T123000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.sourceTimezone, 'Mars/Recruiting');
  assert.strictEqual(parsed.timezone, 'America/Los_Angeles');
  assert.strictEqual(parsed.timezoneAmbiguous, true);
  assert.strictEqual(TimeEngine.formatInterviewDateTime(parsed).timeZone, 'PDT');
});

test('winter and summer Pacific display select PST and PDT automatically', () => {
  const winter = TimeEngine.formatInterviewDateTime({ start: '2026-01-15T20:00:00Z', end: '2026-01-15T20:30:00Z' });
  const summer = TimeEngine.formatInterviewDateTime({ start: '2026-08-26T19:00:00Z', end: '2026-08-26T19:30:00Z' });
  assert.strictEqual(winter.timeZone, 'PST');
  assert.strictEqual(summer.timeZone, 'PDT');
});

test('display timezone never changes countdown or preparation instants', () => {
  const source = { start: '2026-08-27T00:30:00Z', end: '2026-08-27T01:00:00Z', sourceTimezone: 'Asia/Kolkata' };
  assert.strictEqual(TimeEngine.calculatePreparationWindow(source).start.toISOString(), '2026-08-27T00:00:00.000Z');
  assert.strictEqual(TimeEngine.calculateInterviewCountdown(source, '2026-08-26T23:30:00Z').label, 'Starts in 60 minutes');
});

test('Pacific wall-clock conversion is independent of runtime timezone', () => {
  assert.strictEqual(TimeEngine.zonedDateTimeToIso({ year: 2026, month: 8, day: 26, hour: 12, minute: 0 }), '2026-08-26T19:00:00.000Z');
});

test('normalization is idempotent and never shifts an absolute instant twice', () => {
  const ICSParser = require('../services/calendar/icsParser');
  const EventNormalizer = require('../services/calendar/eventNormalizer');
  const parsed = ICSParser.parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:stable\nDTSTART;TZID=Asia/Kolkata:20260827T060000\nDTEND;TZID=Asia/Kolkata:20260827T063000\nEND:VEVENT\nEND:VCALENDAR');
  const once = EventNormalizer.normalize(parsed);
  const twice = EventNormalizer.normalize(once);
  assert.strictEqual(twice.start, once.start);
  assert.strictEqual(twice.end, once.end);
  assert.strictEqual(twice.displayTimezone, 'America/Los_Angeles');
});

test('exact KANINI Windows TZID VTIMEZONE converts local clock before UTC normalization', () => {
  const ICSParser = require('../services/calendar/icsParser');
  const raw = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:India Standard Time',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:kanini-exact-regression',
    'DTSTART;TZID=India Standard Time:20260827T003000',
    'DTEND;TZID=India Standard Time:20260827T010000',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\n');
  const parsed = ICSParser.parse(raw);
  const display = TimeEngine.formatInterviewDateTime(parsed);
  const preparation = TimeEngine.calculatePreparationWindow(parsed, 30);

  assert.strictEqual(parsed.rawDtStart, '20260827T003000');
  assert.strictEqual(parsed.rawDtEnd, '20260827T010000');
  assert.strictEqual(parsed.sourceTzid, 'India Standard Time');
  assert.strictEqual(parsed.startAt, '2026-08-26T19:00:00.000Z');
  assert.strictEqual(parsed.endAt, '2026-08-26T19:30:00.000Z');
  assert.strictEqual(parsed.normalizedStartAt, parsed.startAt);
  assert.strictEqual(parsed.normalizedEndAt, parsed.endAt);
  assert.strictEqual(display.label, '12:00 PM – 12:30 PM PDT');
  assert.strictEqual(preparation.start.toISOString(), '2026-08-26T18:30:00.000Z');

  const reparsed = require('../services/calendar/eventNormalizer').normalize(parsed);
  assert.strictEqual(reparsed.startAt, parsed.startAt);
  assert.strictEqual(reparsed.endAt, parsed.endAt);
});

if (!process.exitCode) console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
