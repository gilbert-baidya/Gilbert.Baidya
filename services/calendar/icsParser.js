const InterviewTimeEngine = require('./interviewTimeEngine');

/**
 * ICS / iCalendar Parser Service
 * High-confidence deterministic parser for RFC 5545 calendar data.
 * Extracts UID, SEQUENCE, METHOD, RECURRENCE-ID, SUMMARY, DTSTART, DTEND, TZID, LOCATION, DESCRIPTION, ORGANIZER, ATTENDEES, URL, RRULE.
 */

class ICSParser {
  /**
   * Parse raw ICS text into a structured calendar event object.
   * @param {string} icsContent 
   * @returns {Object|null}
   */
  static parse(icsContent) {
    if (!icsContent || typeof icsContent !== 'string') return null;

    // Unfold multi-line ICS fields (RFC 5545 folding: CRLF followed by space or tab)
    const unfolded = icsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const allLines = unfolded.split(/\r\n|\r|\n/);
    const eventStart = allLines.findIndex(line => /^BEGIN:VEVENT$/i.test(line));
    const eventEnd = eventStart >= 0
      ? allLines.findIndex((line, index) => index > eventStart && /^END:VEVENT$/i.test(line))
      : -1;
    const lines = eventStart >= 0 && eventEnd > eventStart
      ? allLines.slice(eventStart + 1, eventEnd)
      : allLines;

    const getField = (name, sourceLines = lines) => {
      for (const line of sourceLines) {
        // match NAME or NAME;PARAM=VAL:VALUE
        const regex = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'i');
        const match = line.match(regex);
        if (match) return match[1].trim();
      }
      return null;
    };

    const getFields = (name) => lines
      .map(line => line.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'i')))
      .filter(Boolean)
      .map(match => match[1].trim());

    const getParam = (name, paramName) => {
      for (const line of lines) {
        const regex = new RegExp(`^${name};.*${paramName}=([^;:>]+).*:(.*)$`, 'i');
        const match = line.match(regex);
        if (match) return match[1].trim();
      }
      return null;
    };

    const parseIcsDate = (dateStr, tzid) => {
      if (!dateStr) return null;
      const clean = dateStr.replace(/[^0-9TZ]/g, '');
      
      // UTC formatted: 20260825T170000Z
      if (clean.endsWith('Z')) {
        const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z/);
        if (m) {
          return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))).toISOString();
        }
      }

      // Local format: 20260825T100000 (with TZID or fallback to default)
      const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/);
      if (m) {
        try {
          return this.zonedDateTimeToIso({
            year: +m[1],
            month: +m[2],
            day: +m[3],
            hour: +m[4],
            minute: +m[5],
            second: +(m[6] || 0)
          }, tzid || 'America/Los_Angeles');
        } catch (e) {
          return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))).toISOString();
        }
      }

      // All day date: 20260825
      const dateOnly = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (dateOnly) {
        return new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 0, 0, 0)).toISOString();
      }

      return null;
    };

    const method = getField('METHOD', allLines) || 'REQUEST';
    const uid = getField('UID');
    const sequence = parseInt(getField('SEQUENCE') || '0', 10);
    const recurrenceId = getField('RECURRENCE-ID');
    const summary = getField('SUMMARY') || 'Calendar Event';
    const description = getField('DESCRIPTION') || '';
    const location = getField('LOCATION') || '';
    const organizer = getField('ORGANIZER') || '';
    const organizerName = getParam('ORGANIZER', 'CN') || '';
    const organizerEmail = organizer.replace(/^mailto:/i, '').trim();
    const attendees = getFields('ATTENDEE');
    const status = getField('STATUS') || 'CONFIRMED';
    const rrule = getField('RRULE') || '';
    const url = getField('URL') || '';

    const dtstartRaw = getField('DTSTART');
    const dtendRaw = getField('DTEND');
    const rawTzid = getParam('DTSTART', 'TZID');
    const isUtc = /Z$/i.test(dtstartRaw || '');
    const timezoneResolution = isUtc
      ? { raw: 'UTC', timeZone: 'UTC', valid: true }
      : InterviewTimeEngine.resolveTimeZone(rawTzid, InterviewTimeEngine.DEFAULT_TIME_ZONE);
    const tzid = timezoneResolution.timeZone;
    const timezoneAmbiguous = !isUtc && (!rawTzid || !timezoneResolution.valid);

    const startIso = parseIcsDate(dtstartRaw, tzid);
    let endIso = parseIcsDate(dtendRaw, tzid);

    // Fallback: If no end time, default to 1 hour after start
    if (startIso && !endIso) {
      endIso = new Date(new Date(startIso).getTime() + 3600000).toISOString();
    }

    // Extract meeting link from location, URL, or description
    const textPool = `${location} ${url} ${description}`;
    const meetingUrl = this.extractMeetingUrl(textPool);

    // Clean text fields unescaping RFC 5545 escaped characters
    const cleanText = (t) => t ? t.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : '';

    return {
      method: method.toUpperCase(),
      icalUid: uid || `auto-${Date.now()}`,
      icalSequence: sequence,
      recurrenceId: recurrenceId || null,
      title: cleanText(summary),
      description: cleanText(description),
      location: cleanText(location),
      start: startIso,
      end: endIso,
      startAt: startIso,
      endAt: endIso,
      normalizedStartAt: startIso,
      normalizedEndAt: endIso,
      timezone: tzid,
      sourceTimezone: isUtc ? 'UTC' : (rawTzid || null),
      sourceTzid: isUtc ? 'UTC' : (rawTzid || null),
      displayTimezone: InterviewTimeEngine.DEFAULT_TIME_ZONE,
      timezoneAmbiguous,
      rawDtStart: dtstartRaw,
      rawDtEnd: dtendRaw,
      organizer: cleanText(organizer),
      organizerName: cleanText(organizerName),
      organizerEmail: cleanText(organizerEmail),
      attendees: attendees.map(cleanText),
      status: method.toUpperCase() === 'CANCEL' ? 'CANCELLED' : status.toUpperCase(),
      rrule: rrule || null,
      meetingUrl: meetingUrl || null,
      confidence: timezoneAmbiguous ? 0.7 : 1.0,
      needsReview: timezoneAmbiguous,
      parserUsed: 'ICS'
    };
  }

  static extractMeetingUrl(text) {
    if (!text) return null;
    // Patterns for Google Meet, Zoom, MS Teams, Webex
    const patterns = [
      /https:\/\/meet\.google\.com\/[a-z0-9\-]+/i,
      /https:\/\/[a-z0-9\-\.]*zoom\.us\/[jw]\/[0-9\?&=a-z]+/i,
      /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^>\s"]+/i,
      /https:\/\/[a-z0-9\-\.]*webex\.com\/[^>\s"]+/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    
    // Generic fallback URL if explicitly in location
    const genericMatch = text.match(/https?:\/\/[^\s<>"{}|\\^`]+/i);
    return genericMatch ? genericMatch[0] : null;
  }

  static zonedDateTimeToIso(parts, timeZone) {
    return InterviewTimeEngine.zonedDateTimeToIso(parts, timeZone);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ICSParser;
}
