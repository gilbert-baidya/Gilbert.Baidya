/**
 * Duplicate & Lifecycle Detector
 * Handles:
 * 1. iCalendar UID + recurrence ID
 * 2. Gmail message ID
 * 3. Google Calendar event ID
 * 4. Normalized title + start time + organizer fallback
 * 
 * Determines whether an incoming item is a NEW event, RESCHEDULE/UPDATE, or CANCELLATION.
 */

class DuplicateDetector {
  /**
   * Compare candidate with existing Firestore events
   * @param {Object} candidate - Incoming parsed event
   * @param {Array<Object>} existingEvents - Current user events
   * @returns {{ action: 'CREATE'|'UPDATE'|'CANCEL'|'NOOP', existingEvent: Object|null, reason: string }}
   */
  static evaluate(candidate, existingEvents = []) {
    if (!candidate) return { action: 'NOOP', existingEvent: null, reason: 'Invalid candidate' };

    // 1. Check iCal UID match
    if (candidate.icalUid) {
      const candidateRecurrence = candidate.recurrenceId || null;
      const match = existingEvents.find(e =>
        (e.icalUid || e.iCalUid) === candidate.icalUid &&
        (e.recurrenceId || null) === candidateRecurrence
      );
      if (match) {
        if (candidate.method === 'CANCEL' || candidate.status === 'CANCELLED') {
          return { action: 'CANCEL', existingEvent: match, reason: 'Matched iCal UID with CANCEL method' };
        }

        // Compare sequence and timestamps
        const existingSeq = parseInt(match.icalSequence || '0', 10);
        const incomingSeq = parseInt(candidate.icalSequence || '0', 10);

        const startChanged = match.start !== candidate.start;
        const endChanged = match.end !== candidate.end;
        const locChanged = match.location !== candidate.location;

        if (incomingSeq > existingSeq || startChanged || endChanged || locChanged) {
          return { action: 'UPDATE', existingEvent: match, reason: `Matched iCal UID (Seq ${incomingSeq} > ${existingSeq}, StartChanged: ${startChanged})` };
        }

        return { action: 'NOOP', existingEvent: match, reason: 'Identical iCal event already present (Sequence not higher)' };
      }
    }

    // 2. Check Gmail Message ID match
    if (candidate.gmailMessageId) {
      const match = existingEvents.find(e => e.gmailMessageId === candidate.gmailMessageId);
      if (match) {
        if (candidate.method === 'CANCEL') {
          return { action: 'CANCEL', existingEvent: match, reason: 'Matched Gmail message ID with cancellation' };
        }
        return { action: 'UPDATE', existingEvent: match, reason: 'Matched Gmail message ID' };
      }
    }

    // 3. Check Google Calendar event ID match
    if (candidate.calendarEventId) {
      const match = existingEvents.find(e => e.calendarEventId === candidate.calendarEventId);
      if (match) return { action: 'UPDATE', existingEvent: match, reason: 'Matched Google Calendar event ID' };
    }

    // 4. Fallback: Normalized title + start time within 2 minutes tolerance
    if (candidate.title && candidate.start) {
      const normCandTitle = this.normalizeTitle(candidate.title);
      const candStartTime = new Date(candidate.start).getTime();

      const match = existingEvents.find(e => {
        if (!e.title || !e.start || e.status === 'CANCELLED') return false;
        const normExistingTitle = this.normalizeTitle(e.title);
        const existingStartTime = new Date(e.start).getTime();
        const timeDiffMs = Math.abs(candStartTime - existingStartTime);
        return normCandTitle === normExistingTitle && timeDiffMs < 120000; // 2 min threshold
      });

      if (match) {
        if (candidate.method === 'CANCEL') {
          return { action: 'CANCEL', existingEvent: match, reason: 'Matched normalized title and time with cancellation' };
        }
        return { action: 'UPDATE', existingEvent: match, reason: 'Matched normalized title and start time' };
      }
    }

    // If method is cancel but no existing event is found
    if (candidate.method === 'CANCEL' || candidate.status === 'CANCELLED') {
      return { action: 'NOOP', existingEvent: null, reason: 'Cancellation received for non-existent event' };
    }

    return { action: 'CREATE', existingEvent: null, reason: 'No prior match found' };
  }

  static normalizeTitle(title) {
    if (!title) return '';
    return title
      .toLowerCase()
      .replace(/^fwd?:\s*/i, '')
      .replace(/^invitation:\s*/i, '')
      .replace(/^updated invitation:\s*/i, '')
      .replace(/^canceled:\s*/i, '')
      .replace(/[^\w\s]/gi, '')
      .trim();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DuplicateDetector;
}
