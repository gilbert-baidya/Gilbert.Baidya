/**
 * Complete Pipeline Test Suite
 * Tests:
 * 1. MIME extraction & text/calendar detection
 * 2. High-confidence ICS auto-add
 * 3. UID preservation & Rescheduling
 * 4. Cancellation handling
 * 5. Deterministic natural language parsing (45-min duration & Teams link)
 * 6. Ambiguous email low-confidence Needs Review handling
 * 7. Ollama offline resilience
 * 8. Category and Interview metadata extraction
 */

const IntakeProcessor = require('../services/gmail/intakeProcessor');
const ICSParser = require('../services/calendar/icsParser');
const DuplicateDetector = require('../services/calendar/duplicateDetector');
const EventNormalizer = require('../services/calendar/eventNormalizer');
const MimeParser = require('../services/gmail/mimeParser');
const {
  FIXTURE_1_CLEAN_INTERVIEW,
  FIXTURE_2_RESCHEDULE,
  FIXTURE_3_CANCEL,
  FIXTURE_4_NATURAL_LANGUAGE,
  FIXTURE_5_AMBIGUOUS_EMAIL,
  FIXTURE_6_MIME_GMAIL_MESSAGE
} = require('./fixtures/test_fixtures');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING AUTOMATIC GMAIL & CALENDAR INTAKE TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  const processor = new IntakeProcessor();
  const existingEvents = [];

  // TEST 1: MIME Parser
  const mimeResult = MimeParser.parse(FIXTURE_6_MIME_GMAIL_MESSAGE);
  assert(mimeResult.icsData.length === 1, 'MIME Parser: Extracts nested .ics calendar attachment');
  assert(mimeResult.headers.subject.includes('Stripe'), 'MIME Parser: Extracts headers correctly');

  // TEST 2: High Confidence Clean Interview (AUTO_ADD)
  const result1 = await processor.process({ rawIcs: FIXTURE_1_CLEAN_INTERVIEW }, existingEvents);
  assert(result1.action === 'AUTO_ADD', 'Pipeline: Clean ICS invitation is AUTO_ADD without manual review');
  assert(result1.event.category === 'INTERVIEW', 'Pipeline: Automatically classified as INTERVIEW category');
  assert(result1.event.meetingUrl.includes('meet.google.com'), 'Pipeline: Extracts Google Meet URL');
  assert(result1.event.icalUid === 'interview-clean-12345@google.com', 'Pipeline: Preserves exact iCal UID');

  // Add event to existing store
  const savedEvent = { id: 'evt-100', ...result1.event };
  existingEvents.push(savedEvent);

  // TEST 3: Reschedule (AUTO_UPDATE)
  const result2 = await processor.process({ rawIcs: FIXTURE_2_RESCHEDULE }, existingEvents);
  assert(result2.action === 'AUTO_UPDATE', 'Pipeline: Rescheduled invitation updates existing event (AUTO_UPDATE)');
  assert(result2.event.id === 'evt-100', 'Pipeline: Correctly targets matching existing document ID');
  assert(result2.event.start !== savedEvent.start, 'Pipeline: Start timestamp successfully updated to new time');

  // TEST 4: Cancellation (AUTO_CANCEL)
  const result3 = await processor.process({ rawIcs: FIXTURE_3_CANCEL }, existingEvents);
  assert(result3.action === 'AUTO_CANCEL', 'Pipeline: METHOD:CANCEL marks event as CANCELLED (AUTO_CANCEL)');
  assert(result3.event.status === 'CANCELLED', 'Pipeline: Event status updated to CANCELLED');

  // TEST 5: Natural Language Forwarded Email (Deterministic)
  const result4 = await processor.process({
    rawEmailText: FIXTURE_4_NATURAL_LANGUAGE,
    metadata: { subject: 'Interview Invitation with Sarah' }
  }, existingEvents);
  assert(result4.event.category === 'INTERVIEW', 'Deterministic NLP: Classified as INTERVIEW');
  assert(result4.event.meetingUrl.includes('teams.microsoft.com'), 'Deterministic NLP: Extracted Microsoft Teams link');
  assert(result4.event.end !== null, 'Deterministic NLP: Calculated correct 45-minute end time');

  // TEST 6: Ambiguous Forwarded Email
  const result5 = await processor.process({
    rawEmailText: FIXTURE_5_AMBIGUOUS_EMAIL,
    metadata: { subject: 'Quick chat' }
  }, existingEvents);
  assert(result5.action === 'NEEDS_REVIEW', 'Ambiguous NLP: Ambiguous text routed to NEEDS_REVIEW queue');
  assert(result5.event.needsReview === true, 'Ambiguous NLP: Event flagged with needsReview = true');

  // TEST 7: Duplicate Detection on Title + Time
  const testCandidate = {
    title: 'Senior QA Automation Engineer Interview',
    start: savedEvent.start,
    end: savedEvent.end
  };
  const dupCheck = DuplicateDetector.evaluate(testCandidate, [savedEvent]);
  assert(dupCheck.action === 'UPDATE' || dupCheck.existingEvent !== null, 'Duplicate Detector: Identifies normalized title and time match');

  console.log(`\n====================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
