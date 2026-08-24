const assert = require('assert');
const InterviewClassifier = require('../services/calendar/interviewClassifier');
const EventNormalizer = require('../services/calendar/eventNormalizer');
const ICSParser = require('../services/calendar/icsParser');

let passed = 0;
let failed = 0;

function test(name, event, expected, expectedStage) {
  try {
    const result = InterviewClassifier.classifyInterviewIntent(event);
    assert.strictEqual(result.isInterview, expected);
    if (expectedStage) assert.strictEqual(result.stage, expectedStage);
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name} (${error.message})`);
    failed++;
  }
}

test('KANINI technical discussion', {
  title: 'KANINI - Technical Discussion with Gilbert Baidya, Role - Automation QA',
  organizer: 'Recruiting Team',
  meetingUrl: 'https://teams.microsoft.com/l/meetup-join/example'
}, true, 'Technical Discussion');
test('Technical screening', { title: 'Technical Screening - Senior SDET' }, true, 'Technical Screening');
test('Recruiter call', { title: 'Recruiter Call - QA Automation Engineer Opportunity' }, true, 'Recruiter Screening');
test('Hiring manager discussion', { title: 'Hiring Manager Discussion - Software Quality Engineer' }, true, 'Hiring Manager');
test('HR discussion', { title: 'HR Discussion - QA Automation Role' }, true, 'HR Discussion');
test('Final discussion with recruiting context', { title: 'Final Round Discussion', notes: 'Next round in the hiring process' }, true, 'Final Round');
test('Phone screen', { title: 'Phone Screen - Automation Engineer' }, true, 'Phone Screening');
test('Meet engineering team candidate', { title: 'Meet the Engineering Team - Candidate Gilbert' }, true, 'Meet the Team');
test('API architecture technical discussion', { title: 'Technical Discussion - API Architecture' }, false);
test('Weekly technical discussion', { title: 'Weekly Technical Discussion' }, false);
test('Architecture discussion', { title: 'Architecture Discussion' }, false);
test('Project status call', { title: 'Project Status Call' }, false);
test('Church leadership meeting', { title: 'Church Leadership Meeting' }, false);
test('Team discussion', { title: 'Team Discussion' }, false);
test('Client technical discussion', { title: 'Client Technical Discussion' }, false);

const normalized = EventNormalizer.normalize({
  title: 'KANINI - Technical Discussion with Gilbert Baidya, Role - Automation QA',
  organizer: 'Recruiting Team',
  meetingUrl: 'https://teams.microsoft.com/l/meetup-join/example',
  start: '2026-08-26T17:00:00.000Z',
  end: '2026-08-26T18:00:00.000Z'
});
try {
  assert.strictEqual(normalized.category, 'INTERVIEW');
  assert.strictEqual(normalized.company, 'KANINI');
  assert.strictEqual(normalized.position, 'Automation QA');
  assert.strictEqual(normalized.interviewStage, 'Technical Discussion');
  assert.ok(normalized.classification.reasons.includes('job-role'));
  console.log('PASS: KANINI normalized metadata');
  passed++;
} catch (error) {
  console.error(`FAIL: KANINI normalized metadata (${error.message})`);
  failed++;
}

try {
  const parsed = ICSParser.parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:kanini-time-test\nSUMMARY:KANINI - Technical Discussion, Role - Automation QA\nDTSTART;TZID=America/Los_Angeles:20260826T100000\nDTEND;TZID=America/Los_Angeles:20260826T110000\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(parsed.start, '2026-08-26T17:00:00.000Z');
  assert.strictEqual(parsed.end, '2026-08-26T18:00:00.000Z');
  assert.strictEqual(parsed.timezone, 'America/Los_Angeles');
  console.log('PASS: KANINI Pacific TZID normalization');
  passed++;
} catch (error) {
  console.error(`FAIL: KANINI Pacific TZID normalization (${error.message})`);
  failed++;
}

console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
if (failed) process.exit(1);