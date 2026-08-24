(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./interviewTimeEngine'));
  } else if (root) {
    root.EventViewModel = factory(root.InterviewTimeEngine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (InterviewTimeEngine) {
  const DISPLAY_TIME_ZONE = InterviewTimeEngine.DEFAULT_TIME_ZONE;

  function getStart(event = {}) {
    return event.startAt || event.normalizedStartAt || event.start || event.interviewDate || null;
  }

  function getEnd(event = {}) {
    return event.endAt || event.normalizedEndAt || event.end || null;
  }

  function parseOrganizer(event = {}) {
    const explicitName = String(event.organizerName || event.recruiter || '').trim();
    const explicitEmail = String(event.organizerEmail || event.recruiterEmail || '').replace(/^mailto:/i, '').trim();
    const raw = String(event.organizer || '').trim();
    const cnMatch = raw.match(/(?:^|;)CN="?([^";:]+)"?/i);
    const emailMatch = raw.match(/mailto:([^;\s]+)/i);
    return {
      name: explicitName || (cnMatch ? cnMatch[1].trim() : ''),
      email: explicitEmail || (emailMatch ? emailMatch[1].trim() : (/^[^\s@]+@[^\s@]+$/.test(raw) ? raw : ''))
    };
  }

  function getMeetingProvider(event = {}) {
    const value = `${event.meetingProvider || ''} ${event.interviewType || ''} ${event.meetingUrl || ''} ${event.location || ''}`;
    if (/teams\.microsoft\.com|microsoft teams/i.test(value)) return 'Microsoft Teams';
    if (/zoom\.us|\bzoom\b/i.test(value)) return 'Zoom';
    if (/meet\.google\.com|google meet/i.test(value)) return 'Google Meet';
    if (/webex\.com|\bwebex\b/i.test(value)) return 'Webex';
    if (/\bphone\b/i.test(value)) return 'Phone';
    if (event.location && !/^https?:\/\//i.test(event.location)) return event.location;
    return event.meetingUrl ? 'Virtual Meeting' : 'Not specified';
  }

  function getInterviewStage(event = {}) {
    return event.interviewStage || event.classification?.stage || 'Interview';
  }

  function getStageFormValue(event = {}) {
    const stage = getInterviewStage(event).toLowerCase();
    if (stage.includes('screen')) return 'Screening';
    if (stage.includes('recruiter')) return 'Recruiter Screening';
    if (stage.includes('hiring manager')) return 'Hiring Manager';
    if (stage.includes('final')) return 'Final Round';
    if (stage.includes('offer')) return 'Offer';
    if (stage.includes('technical')) return 'Technical Discussion';
    return getInterviewStage(event);
  }

  function getSourceLabel(event = {}) {
    if (event.source === 'EMAIL_INTAKE' || event.gmailMessageId || event.icalUid) return 'Email / ICS';
    if (event.source === 'CALENDAR_SYNC' || event.googleCalendarEventId) return 'Google Calendar';
    return 'Manual';
  }

  function getCalendarTitle(event = {}) {
    const source = getSourceLabel(event) === 'Email / ICS' ? 'Email' : getSourceLabel(event);
    const isInterview = event.isInterview || event.category === 'INTERVIEW';
    const subject = isInterview
      ? `${event.company || event.title || 'Interview'} — ${getInterviewStage(event)}`
      : event.title || '(No Title)';
    return `${source === 'Email' ? '📧' : source === 'Google Calendar' ? '↻' : '•'} ${subject}`;
  }

  function getCanonicalEventId(event = {}) {
    if (!event) return '';
    if (typeof event === 'string') return event.trim();
    return String(
      event.id ||
      event.firestoreId ||
      event.documentId ||
      event.eventId ||
      event.extendedProps?.firestoreId ||
      event.extendedProps?.id ||
      event.extendedProps?.documentId ||
      event.extendedProps?.eventId ||
      event._def?.publicId ||
      event.event?.id ||
      event.event?.extendedProps?.firestoreId ||
      event.event?.extendedProps?.id ||
      ''
    ).trim();
  }

  function getCalendarEventInteraction(calendarEvent = {}) {
    const eventId = getCanonicalEventId(calendarEvent);
    if (eventId) {
      return { mode: 'DETAILS', eventId };
    }
    // If a calendar event object was clicked (it has props) but has no canonical ID, report an error instead of fallback to add
    if (calendarEvent && (calendarEvent.extendedProps || calendarEvent._def || calendarEvent.title || calendarEvent.start || calendarEvent.el)) {
      return { mode: 'ERROR', eventId: '', error: 'Could not load this existing event.' };
    }
    return { mode: 'ADD', eventId: '' };
  }

  function getSaveOperation(eventId) {
    const id = String(eventId || '').trim();
    return id ? { type: 'UPDATE', eventId: id } : { type: 'CREATE', eventId: '' };
  }

  function getFormValues(event = {}) {
    const canonicalId = getCanonicalEventId(event);
    const start = getStart(event);
    const end = getEnd(event);
    const startLocal = InterviewTimeEngine.formatLocalDateTime(start, DISPLAY_TIME_ZONE);
    const endLocal = InterviewTimeEngine.formatLocalDateTime(end, DISPLAY_TIME_ZONE);
    const organizer = parseOrganizer(event);
    const isInterview = Boolean(
      event.isInterview ||
      event.category === 'INTERVIEW' ||
      event.classification?.type === 'interview' ||
      event.classification?.isInterview
    );
    return {
      id: canonicalId,
      firestoreId: canonicalId,
      title: event.title || '',
      date: startLocal.date,
      startTime: startLocal.time,
      endTime: endLocal.time,
      category: isInterview ? 'INTERVIEW' : (event.category || 'OTHER'),
      priority: event.priority || 'NORMAL',
      company: event.company || '',
      position: event.position || event.role || '',
      meetingUrl: event.meetingUrl || '',
      status: event.status || 'CONFIRMED',
      notes: event.notes || event.description || '',
      interviewStage: getStageFormValue(event),
      interviewType: getMeetingProvider(event),
      recruiter: organizer.name && organizer.email ? `${organizer.name} (${organizer.email})` : organizer.name || organizer.email,
      organizer
    };
  }

  return { DISPLAY_TIME_ZONE, getCanonicalEventId, getStart, getEnd, parseOrganizer, getMeetingProvider, getInterviewStage, getSourceLabel, getCalendarTitle, getCalendarEventInteraction, getSaveOperation, getFormValues };
});
