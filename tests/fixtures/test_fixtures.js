/**
 * Automated Test Fixtures for Email & Calendar Intake Pipeline
 */

const FIXTURE_1_CLEAN_INTERVIEW = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
METHOD:REQUEST
BEGIN:VEVENT
UID:interview-clean-12345@google.com
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:Senior QA Automation Engineer Interview
DESCRIPTION:Technical interview for Senior QA Automation Architect with Gilbert.\\nMeeting link: https://meet.google.com/abc-defg-hij
DTSTART;TZID=America/Los_Angeles:20260825T100000
DTEND;TZID=America/Los_Angeles:20260825T110000
LOCATION:https://meet.google.com/abc-defg-hij
ORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com
END:VEVENT
END:VCALENDAR`;

const FIXTURE_2_RESCHEDULE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
METHOD:REQUEST
BEGIN:VEVENT
UID:interview-clean-12345@google.com
SEQUENCE:1
STATUS:CONFIRMED
SUMMARY:Senior QA Automation Engineer Interview (Rescheduled)
DESCRIPTION:Rescheduled technical interview with Gilbert.\\nMeeting link: https://meet.google.com/abc-defg-hij
DTSTART;TZID=America/Los_Angeles:20260825T113000
DTEND;TZID=America/Los_Angeles:20260825T123000
LOCATION:https://meet.google.com/abc-defg-hij
ORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com
END:VEVENT
END:VCALENDAR`;

const FIXTURE_3_CANCEL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
METHOD:CANCEL
BEGIN:VEVENT
UID:interview-clean-12345@google.com
SEQUENCE:2
STATUS:CANCELLED
SUMMARY:Senior QA Automation Engineer Interview (Canceled)
DTSTART;TZID=America/Los_Angeles:20260825T113000
DTEND;TZID=America/Los_Angeles:20260825T123000
ORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com
END:VEVENT
END:VCALENDAR`;

const FIXTURE_4_NATURAL_LANGUAGE = `Hi Gilbert,

We would like to schedule your technical interview next Tuesday, August 25, 2026 at 2:00 PM for 45 minutes.

Please join via Microsoft Teams: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123

Best regards,
Sarah Connor
Staff Technical Recruiter`;

const FIXTURE_5_AMBIGUOUS_EMAIL = `Hi Gilbert,

Let's talk Tuesday afternoon to catch up on the project status.

Thanks!`;

const FIXTURE_6_MIME_GMAIL_MESSAGE = {
  id: 'msg-987654',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'Subject', value: 'Fwd: Technical Architecture Interview - Stripe' },
      { name: 'From', value: 'recruiter@stripe.com' },
      { name: 'To', value: 'gilbert.cgpt@gmail.com' },
      { name: 'Date', value: 'Sat, 22 Aug 2026 08:00:00 -0700' }
    ],
    parts: [
      {
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Forwarded interview details from Stripe.\nPlease find the attached calendar invitation.').toString('base64')
        }
      },
      {
        mimeType: 'text/calendar; method=REQUEST; name=invite.ics',
        filename: 'invite.ics',
        body: {
          data: Buffer.from(FIXTURE_1_CLEAN_INTERVIEW).toString('base64')
        }
      }
    ]
  }
};

module.exports = {
  FIXTURE_1_CLEAN_INTERVIEW,
  FIXTURE_2_RESCHEDULE,
  FIXTURE_3_CANCEL,
  FIXTURE_4_NATURAL_LANGUAGE,
  FIXTURE_5_AMBIGUOUS_EMAIL,
  FIXTURE_6_MIME_GMAIL_MESSAGE
};
