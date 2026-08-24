const assert = require('assert');
const { buildReminderEmail, findDueReminders, processInterviewEmailReminders } = require('../services/notifications/interviewEmailReminder');

async function run() {
  const event = {
    id: 'kanini-event',
    isInterview: true,
    company: 'KANINI',
    position: 'Automation QA',
    interviewStage: 'Technical Discussion',
    start: '2026-08-26T19:00:00.000Z',
    end: '2026-08-26T19:30:00.000Z',
    timezone: 'America/Los_Angeles',
    meetingUrl: 'https://teams.microsoft.com/example',
    notes: 'Confidential recruiter email thread must not appear.'
  };
  const settings = { personalEmailReminders: true, emailReminderMinutes: [30, 30] };
  const now = new Date('2026-08-26T18:30:30.000Z');

  const due = findDueReminders([event], settings, now);
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].id, `kanini-event-${new Date(event.start).getTime()}-30`);

  const email = buildReminderEmail(event, 30, 'gilbert.cgpt@gmail.com');
  assert.strictEqual(email.subject, 'Interview in 30 Minutes — KANINI Technical Discussion');
  assert.ok(email.body.includes('Preparation time starts now.'));
  assert.ok(email.body.includes('12:00 PM – 12:30 PM PDT'));
  assert.ok(email.body.includes(event.meetingUrl));
  assert.ok(!email.body.includes(event.notes));

  const claims = new Set();
  let sends = 0;
  const options = {
    events: [event],
    settings,
    recipient: 'gilbert.cgpt@gmail.com',
    now,
    async claim(id) {
      if (claims.has(id)) return false;
      claims.add(id);
      return true;
    },
    async send() { sends++; },
    async complete() {}
  };
  await processInterviewEmailReminders(options);
  await processInterviewEmailReminders(options);
  assert.strictEqual(sends, 1);
  console.log('PASS: enabled interview email reminder is concise and idempotent');
}

run().catch(error => {
  console.error(`FAIL: interview email reminder (${error.message})`);
  process.exit(1);
});
