const MimeParser = require('../services/gmail/mimeParser');
const GmailClient = require('../services/gmail/gmailClient');
const IntakeProcessor = require('../services/gmail/intakeProcessor');
const { processLabeledMessages } = require('../netlify/functions/gmail-process');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.error(`FAIL: ${name}`);
    failed++;
  }
}

function encoded(value) {
  return Buffer.from(value).toString('base64url');
}

const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:test@example.com\nSUMMARY:Interview\nDTSTART:20990824T150000Z\nDTEND:20990824T160000Z\nEND:VEVENT\nEND:VCALENDAR';
const icsWithTimezone = 'BEGIN:VCALENDAR\nBEGIN:VTIMEZONE\nBEGIN:STANDARD\nDTSTART:16010101T095258\nEND:STANDARD\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:timezone-test@example.com\nSUMMARY:Future Interview\nDTSTART:20990824T150000Z\nDTEND:20990824T160000Z\nEND:VEVENT\nEND:VCALENDAR';

function messageWithPart(part) {
  return { id: 'message-1', labelIds: ['Label_intake'], payload: { mimeType: 'multipart/mixed', headers: [], parts: [part] } };
}

async function testMimeTypes() {
  const textCalendar = MimeParser.parse(messageWithPart({ mimeType: 'text/calendar', filename: '', body: { data: encoded(ics) } }));
  const applicationIcs = MimeParser.parse(messageWithPart({ mimeType: 'application/ics', filename: 'invite.ics', body: { data: encoded(ics) } }));
  const genericIcs = MimeParser.parse(messageWithPart({ mimeType: 'application/octet-stream', filename: 'event.ics', body: { data: encoded(ics) } }));
  const nested = MimeParser.parse(messageWithPart({ mimeType: 'message/rfc822', parts: [{ mimeType: 'text/calendar', filename: 'nested.ics', body: { data: encoded(ics) } }] }));
  assert(textCalendar.icsData.length === 1, 'text/calendar attachment is extracted');
  assert(applicationIcs.icsData.length === 1, 'application/ics attachment is extracted');
  assert(genericIcs.icsData.length === 1, 'generic MIME .ics filename is extracted');
  assert(nested.icsData.length === 1, 'nested MIME calendar part is extracted');
  const parsedTimezoneEvent = require('../services/calendar/icsParser').parse(icsWithTimezone);
  assert(parsedTimezoneEvent.start === '2099-08-24T15:00:00.000Z', 'VEVENT date wins over VTIMEZONE DTSTART');
}

async function testAttachmentHydration() {
  const message = messageWithPart({ mimeType: 'application/octet-stream', filename: 'invite.ics', body: { attachmentId: 'attachment-1' } });
  const client = new GmailClient();
  client.getAttachment = async () => ({ data: encoded(ics) });
  await client.hydrateCalendarAttachments(message);
  assert(MimeParser.parse(message).icsData[0].content.includes('BEGIN:VCALENDAR'), 'attachmentId content is fetched and decoded');
}

async function testExplicitDate() {
  const result = await new IntakeProcessor().process({ rawEmailText: 'Interview August 24, 2026 3:00 PM Pacific' });
  assert(Boolean(result.event.start), 'explicit August 24, 2026 3:00 PM preserves start');
  assert(result.action === 'NEEDS_REVIEW' && result.event.end === null, 'missing end remains reviewable without invented duration');
}

async function testPersistenceAndProcessedLabel() {
  const outcomes = [
    { action: 'NEEDS_REVIEW', event: { title: 'Review', needsReview: true } },
    { action: 'AUTO_ADD', event: { title: 'Future', start: '2099-08-24T15:00:00.000Z', end: '2099-08-24T16:00:00.000Z' } },
    { action: 'AUTO_ADD', event: { title: 'Past', start: '2020-01-01T15:00:00.000Z', end: '2020-01-01T16:00:00.000Z' } }
  ];

  for (const expected of outcomes) {
    const persisted = [];
    const moved = [];
    const client = {
      listIntakeMessages: async () => ({ labelId: 'Label_intake', messages: [{ id: 'message-1' }] }),
      getMessage: async () => ({ id: 'message-1', threadId: 'thread-1', labelIds: ['Label_intake'], payload: { headers: [] } }),
      hydrateCalendarAttachments: async message => message,
      moveToProcessed: async id => moved.push(id)
    };
    const processor = { process: async () => expected };
    const store = { persistGmailResult: async (message, result) => persisted.push(result) };
    await processLabeledMessages(client, processor, [], 5, store);
    if (expected.action === 'NEEDS_REVIEW') {
      assert(persisted[0].action === 'NEEDS_REVIEW', 'NEEDS_REVIEW persists to email intake');
    } else if (expected.event.title === 'Future') {
      assert(persisted[0].action === 'AUTO_ADD', 'AUTO_ADD persists event and intake audit');
    } else {
      assert(persisted[0].action === 'IGNORED_PAST', 'past invitation does not enter active calendar');
    }
    assert(moved.length === 1, `${expected.event.title} message is moved to processed after persistence`);
  }
}

async function run() {
  await testMimeTypes();
  await testAttachmentHydration();
  await testExplicitDate();
  await testPersistenceAndProcessedLabel();
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exit(1);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});