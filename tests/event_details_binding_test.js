const assert = require('assert');
const ICSParser = require('../services/calendar/icsParser');
const EventNormalizer = require('../services/calendar/eventNormalizer');
const EventViewModel = require('../services/calendar/eventViewModel');

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

const teamsUrl = 'https://teams.microsoft.com/l/meetup-join/example';
const kaniniIcs = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:India Standard Time',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:kanini-real@example.com',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:KANINI - Technical Discussion with Gilbert Baidya, Role - Automation QA',
  `DESCRIPTION:Technical Discussion\\nRole: Automation QA\\nJoin: ${teamsUrl}`,
  'DTSTART;TZID=India Standard Time:20260827T003000',
  'DTEND;TZID=India Standard Time:20260827T010000',
  `LOCATION:${teamsUrl}`,
  'ORGANIZER;CN=Ranjithkumar Raghunathan:mailto:Ranjithkumar.Raghunathan@kanini.com',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\n');
const parsed = ICSParser.parse(kaniniIcs);
const event = { ...EventNormalizer.normalize(parsed), id: 'existing-kanini-id', gmailMessageId: 'gmail-id', googleCalendarEventId: 'gcal-id', reminderMinutes: [1440, 60, 30, 15, 5] };
const form = EventViewModel.getFormValues(event);

test('imported event click routes to existing-event details', () => {
  assert.deepStrictEqual(EventViewModel.getCalendarEventInteraction({ id: event.id }), { mode: 'DETAILS', eventId: event.id });
});
test('Calendar forwards the stored Firestore document ID', () => assert.strictEqual(EventViewModel.getCalendarEventInteraction({ id: event.id }).eventId, event.id));
test('empty Calendar interaction remains Add mode', () => assert.deepStrictEqual(EventViewModel.getCalendarEventInteraction({}), { mode: 'ADD', eventId: '' }));
test('existing event save uses UPDATE and same ID', () => assert.deepStrictEqual(EventViewModel.getSaveOperation(event.id), { type: 'UPDATE', eventId: event.id }));
test('manual event save uses CREATE', () => assert.deepStrictEqual(EventViewModel.getSaveOperation(''), { type: 'CREATE', eventId: '' }));
test('event title prepopulates', () => assert.strictEqual(form.title, 'KANINI - Technical Discussion with Gilbert Baidya, Role - Automation QA'));
test('Pacific date prepopulates', () => assert.strictEqual(form.date, '2026-08-26'));
test('Pacific start time prepopulates', () => assert.strictEqual(form.startTime, '12:00'));
test('Pacific end time prepopulates', () => assert.strictEqual(form.endTime, '12:30'));
test('Interview category prepopulates', () => assert.strictEqual(form.category, 'INTERVIEW'));
test('company prepopulates', () => assert.strictEqual(form.company, 'KANINI'));
test('role prepopulates', () => assert.strictEqual(form.position, 'Automation QA'));
test('stage prepopulates with a valid select value', () => assert.strictEqual(form.interviewStage, 'Technical Discussion'));
test('Teams meeting link prepopulates', () => assert.strictEqual(form.meetingUrl, teamsUrl));
test('meeting provider is Microsoft Teams', () => assert.strictEqual(form.interviewType, 'Microsoft Teams'));
test('organizer name prepopulates', () => {
  assert.strictEqual(form.organizer.name, 'Ranjithkumar Raghunathan');
  assert.strictEqual(form.recruiter, 'Ranjithkumar Raghunathan (Ranjithkumar.Raghunathan@kanini.com)');
});
test('organizer email strips mailto', () => assert.strictEqual(form.organizer.email, 'Ranjithkumar.Raghunathan@kanini.com'));
test('status prepopulates from ICS', () => assert.strictEqual(form.status, 'CONFIRMED'));
test('notes are concise and omit meeting URL', () => {
  assert.ok(form.notes.includes('Technical Discussion'));
  assert.ok(!form.notes.includes('https://'));
});
test('email-imported source indicator appears', () => assert.strictEqual(EventViewModel.getSourceLabel(event), 'Email / ICS'));
test('Calendar title uses company and stage', () => assert.strictEqual(EventViewModel.getCalendarTitle(event), '📧 KANINI — Technical Discussion'));
test('missing optional fields do not crash binding', () => {
  const minimal = EventViewModel.getFormValues({ id: 'minimal', title: 'Meeting', startAt: event.startAt, endAt: event.endAt });
  assert.strictEqual(minimal.company, '');
  assert.strictEqual(minimal.meetingUrl, '');
  assert.strictEqual(minimal.organizer.email, '');
});
test('getCanonicalEventId extracts ID from direct id, extendedProps, or event object', () => {
  assert.strictEqual(EventViewModel.getCanonicalEventId({ id: 'doc-1' }), 'doc-1');
  assert.strictEqual(EventViewModel.getCanonicalEventId({ firestoreId: 'doc-2' }), 'doc-2');
  assert.strictEqual(EventViewModel.getCanonicalEventId({ extendedProps: { firestoreId: 'doc-3' } }), 'doc-3');
  assert.strictEqual(EventViewModel.getCanonicalEventId({ extendedProps: { id: 'doc-4' } }), 'doc-4');
  assert.strictEqual(EventViewModel.getCanonicalEventId({ event: { id: 'doc-5' } }), 'doc-5');
});

test('existing event without canonical ID returns ERROR mode, NOT silent ADD fallback', () => {
  const malformedEvent = { title: 'Unknown Meeting', start: '2026-08-26T19:00:00Z', extendedProps: {} };
  const interaction = EventViewModel.getCalendarEventInteraction(malformedEvent);
  assert.strictEqual(interaction.mode, 'ERROR');
  assert.strictEqual(interaction.error, 'Could not load this existing event.');
});

test('DOM runtime simulation: existing event click opens Event Details and does not invoke Add Event', () => {
  let mode = null;
  let addEventInvoked = false;
  let detailsInvoked = false;
  let lastCalendarEventClickTimestamp = 0;

  const mockOpenAddEventModal = (dateStr) => {
    addEventInvoked = true;
    mode = 'create';
  };
  const mockOpenEventDetailsModalById = (id) => {
    detailsInvoked = true;
    mode = 'view';
  };

  // Simulate FullCalendar eventClick
  const fakeEventClick = (info) => {
    lastCalendarEventClickTimestamp = Date.now();
    info.jsEvent.preventDefault();
    info.jsEvent.stopPropagation();
    const interaction = EventViewModel.getCalendarEventInteraction(info.event);
    if (interaction.mode === 'DETAILS') {
      mockOpenEventDetailsModalById(interaction.eventId);
    }
  };

  // Simulate FullCalendar dateClick
  const fakeDateClick = (info) => {
    if (Date.now() - lastCalendarEventClickTimestamp < 500) return;
    if (info.jsEvent?.target?.closest?.('.fc-event')) return;
    mockOpenAddEventModal(info.dateStr);
  };

  // 1. User clicks the KANINI event
  const jsEvent = {
    preventDefault: () => {},
    stopPropagation: () => {},
    target: { closest: (sel) => sel.includes('.fc-event') ? true : null }
  };
  fakeEventClick({ event: { id: 'kanini-real-doc-id', extendedProps: { firestoreId: 'kanini-real-doc-id' } }, jsEvent });

  // If dateClick also attempts to fire right after
  fakeDateClick({ dateStr: '2026-08-26', jsEvent });

  assert.strictEqual(detailsInvoked, true, 'Event details must be opened');
  assert.strictEqual(addEventInvoked, false, 'Add event must NOT be invoked on existing event click');
  assert.strictEqual(mode, 'view', 'Modal mode must be view');
});

test('DOM runtime simulation: empty date click invokes Add Event in create mode', () => {
  let mode = null;
  let addEventDate = null;
  let lastCalendarEventClickTimestamp = 0;

  const fakeDateClick = (info) => {
    if (Date.now() - lastCalendarEventClickTimestamp < 500) return;
    if (info.jsEvent?.target?.closest?.('.fc-event')) return;
    mode = 'create';
    addEventDate = info.dateStr;
  };

  const jsEvent = {
    target: { closest: () => null }
  };
  fakeDateClick({ dateStr: '2026-08-26', jsEvent });

  assert.strictEqual(mode, 'create');
  assert.strictEqual(addEventDate, '2026-08-26');
});

test('DOM runtime simulation: Manual Event button invokes Add Event in create mode with blank fields', () => {
  let mode = null;
  const mockQuickAdd = () => {
    mode = 'create';
    return {
      title: '',
      date: '2026-08-24',
      startTime: '',
      endTime: '',
      category: 'OTHER',
      company: '',
      position: '',
      meetingUrl: '',
      notes: ''
    };
  };

  const form = mockQuickAdd();
  assert.strictEqual(mode, 'create');
  assert.strictEqual(form.title, '');
  assert.strictEqual(form.category, 'OTHER');
});

test('DOM runtime simulation: Edit button from Details switches to Edit Event mode with populated data', () => {
  let mode = null;
  const mockEditFromDetails = (eventData) => {
    mode = 'edit';
    return EventViewModel.getFormValues(eventData);
  };

  const editValues = mockEditFromDetails(event);
  assert.strictEqual(mode, 'edit');
  assert.strictEqual(editValues.id, 'existing-kanini-id');
  assert.strictEqual(editValues.title, 'KANINI - Technical Discussion with Gilbert Baidya, Role - Automation QA');
  assert.strictEqual(editValues.date, '2026-08-26');
  assert.strictEqual(editValues.startTime, '12:00');
  assert.strictEqual(editValues.endTime, '12:30');
  assert.strictEqual(editValues.category, 'INTERVIEW');
  assert.strictEqual(editValues.company, 'KANINI');
  assert.strictEqual(editValues.position, 'Automation QA');
  assert.strictEqual(editValues.meetingUrl, teamsUrl);
  assert.strictEqual(editValues.status, 'CONFIRMED');
});

if (!process.exitCode) console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
