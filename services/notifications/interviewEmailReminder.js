const InterviewTimeEngine = require('../calendar/interviewTimeEngine');

function buildReminderEmail(event, minutesBefore, recipient) {
  const dateTime = InterviewTimeEngine.formatInterviewDateTime(event, InterviewTimeEngine.DEFAULT_TIME_ZONE);
  const company = event.company || 'Interview';
  const stage = event.interviewStage || event.classification?.stage || 'Interview';
  const position = event.position || 'Role not specified';
  const relative = minutesBefore === 30 ? 'Preparation time starts now.' : `Interview begins in ${minutesBefore} minutes.`;
  const body = [
    company,
    position,
    stage,
    '',
    `${dateTime.date}`,
    dateTime.label,
    '',
    relative,
    ...(event.meetingUrl ? ['', 'Join Meeting:', event.meetingUrl] : [])
  ].join('\n');
  return {
    to: recipient,
    subject: `Interview in ${minutesBefore} Minutes — ${company} ${stage}`,
    body
  };
}

function findDueReminders(events, settings, nowValue = new Date()) {
  if (!settings?.personalEmailReminders) return [];
  const now = new Date(nowValue);
  const reminderMinutes = [...new Set((settings.emailReminderMinutes || [30]).map(Number).filter(Number.isFinite))];
  const due = [];

  for (const event of events || []) {
    if ((!event.isInterview && event.category !== 'INTERVIEW') || event.status === 'CANCELLED' || !event.start) continue;
    const start = new Date(event.start);
    if (Number.isNaN(start.getTime())) continue;
    for (const minutesBefore of reminderMinutes) {
      const scheduledAt = new Date(start.getTime() - minutesBefore * 60000);
      const age = now.getTime() - scheduledAt.getTime();
      if (age < 0 || age >= 5 * 60000) continue;
      due.push({
        id: `${event.id}-${start.getTime()}-${minutesBefore}`,
        event,
        minutesBefore,
        scheduledAt: scheduledAt.toISOString()
      });
    }
  }
  return due;
}

async function processInterviewEmailReminders({ events, settings, recipient, now, claim, send, complete }) {
  const reminders = findDueReminders(events, settings, now);
  const results = [];
  for (const reminder of reminders) {
    const claimed = await claim(reminder.id, reminder);
    if (!claimed) {
      results.push({ id: reminder.id, status: 'SKIPPED_DUPLICATE' });
      continue;
    }
    try {
      const email = buildReminderEmail(reminder.event, reminder.minutesBefore, recipient);
      await send(email);
      await complete(reminder.id, 'SENT');
      results.push({ id: reminder.id, status: 'SENT' });
    } catch (error) {
      await complete(reminder.id, 'FAILED', error.message);
      results.push({ id: reminder.id, status: 'FAILED' });
    }
  }
  return results;
}

module.exports = { buildReminderEmail, findDueReminders, processInterviewEmailReminders };
