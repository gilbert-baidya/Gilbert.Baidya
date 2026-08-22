/**
 * Intake Processor Pipeline
 * Complete workflow orchestration:
 * Raw Email / ICS / Gmail Message
 *   -> MIME Extraction
 *   -> ICS Parser (Priority 1)
 *   -> Deterministic Natural Language Parser (Priority 2)
 *   -> AIService / Ollama (Priority 3)
 *   -> Event Normalizer
 *   -> Duplicate / Reschedule / Cancel Detector
 *   -> Returns standard actionable ingestion result
 */

const ICSParser = require('../calendar/icsParser');
const DuplicateDetector = require('../calendar/duplicateDetector');
const EventNormalizer = require('../calendar/eventNormalizer');
const AIService = require('../ai/AIService');
const MimeParser = require('./mimeParser');

class IntakeProcessor {
  constructor(config = {}) {
    this.aiService = new AIService(config);
    this.defaultTimezone = 'America/Los_Angeles';
  }

  /**
   * Process an incoming email or raw payload
   * @param {Object} input - { gmailMessage, rawIcs, rawEmailText, metadata }
   * @param {Array<Object>} existingEvents - Current Firestore events for user
   * @returns {Promise<{ action: 'AUTO_ADD'|'AUTO_UPDATE'|'AUTO_CANCEL'|'NEEDS_REVIEW'|'IGNORED', event: Object, reason: string, audit: Object }>}
   */
  async process(input, existingEvents = []) {
    let parsedCandidate = null;
    let parserUsed = 'Unknown';
    let sourceEmail = input.metadata?.sourceEmail || 'gilbert.cgpt@gmail.com';
    let gmailMessageId = input.metadata?.gmailMessageId || null;

    // STEP 1: If input is raw Gmail API message, extract MIME parts
    let plainText = '';
    let icsList = [];

    if (input.gmailMessage) {
      const parsedMime = MimeParser.parse(input.gmailMessage);
      plainText = parsedMime.plainText;
      icsList = parsedMime.icsData;
      sourceEmail = parsedMime.headers.from || sourceEmail;
      gmailMessageId = input.gmailMessage.id || gmailMessageId;
    } else if (input.rawIcs) {
      icsList = [{ filename: 'direct.ics', content: input.rawIcs }];
    } else if (input.rawEmailText) {
      plainText = input.rawEmailText;
    }

    // STEP 2: ICS First — Look for text/calendar data
    if (icsList.length > 0) {
      for (const icsItem of icsList) {
        const parsed = ICSParser.parse(icsItem.content);
        if (parsed && parsed.start) {
          parsedCandidate = parsed;
          parserUsed = 'ICS';
          break;
        }
      }
    }

    // STEP 3: Deterministic Natural Language Parsing (if no ICS)
    if (!parsedCandidate && plainText) {
      const deterministicCandidate = this.parseDeterministic(plainText, input.metadata?.subject || '');
      if (deterministicCandidate && deterministicCandidate.start) {
        parsedCandidate = deterministicCandidate;
        parserUsed = 'Deterministic';
      }
    }

    // STEP 4: Ollama Fallback (if deterministic is incomplete or missing)
    if ((!parsedCandidate || parsedCandidate.confidence < 0.7) && plainText) {
      const aiResult = await this.aiService.parseMeetingEmail(plainText);
      if (aiResult && aiResult.date && aiResult.startTime) {
        const startIso = this.combineDateTimeToISO(aiResult.date, aiResult.startTime);
        const endIso = aiResult.endTime ? this.combineDateTimeToISO(aiResult.date, aiResult.endTime) : new Date(new Date(startIso).getTime() + (aiResult.durationMinutes || 60) * 60000).toISOString();

        parsedCandidate = {
          title: aiResult.title,
          company: aiResult.company,
          position: aiResult.position,
          category: aiResult.category,
          start: startIso,
          end: endIso,
          timezone: aiResult.timezone || this.defaultTimezone,
          meetingUrl: aiResult.meetingUrl,
          interviewStage: aiResult.interviewStage,
          priority: aiResult.priority,
          confidence: aiResult.confidence || 0.8,
          notes: plainText,
          parserUsed: 'Ollama'
        };
        parserUsed = 'Ollama';
      }
    }

    // If still no valid candidate could be parsed, flag as low confidence Needs Review
    if (!parsedCandidate) {
      const fallbackEvent = EventNormalizer.normalize({
        title: input.metadata?.subject || 'Forwarded Meeting Request',
        notes: plainText.slice(0, 1000),
        confidence: 0.1,
        needsReview: true,
        sourceEmail,
        gmailMessageId,
        parserUsed: 'Unparsed'
      });

      return {
        action: 'NEEDS_REVIEW',
        event: fallbackEvent,
        reason: 'Could not extract valid appointment timestamps',
        audit: {
          gmailMessageId,
          processedAt: new Date().toISOString(),
          parserUsed: 'None',
          confidence: 0.1
        }
      };
    }

    // STEP 5: Normalize candidate into standard event
    parsedCandidate.sourceEmail = sourceEmail;
    parsedCandidate.gmailMessageId = gmailMessageId;
    parsedCandidate.parserUsed = parserUsed;
    const normalizedEvent = EventNormalizer.normalize(parsedCandidate);

    // STEP 6: Duplicate & Lifecycle Detection
    const evalResult = DuplicateDetector.evaluate(normalizedEvent, existingEvents);

    const audit = {
      gmailMessageId,
      processedAt: new Date().toISOString(),
      parserUsed,
      confidence: normalizedEvent.confidence,
      evalAction: evalResult.action,
      evalReason: evalResult.reason
    };

    // STEP 7: Decision Engine based on Confidence & Lifecycle
    if (evalResult.action === 'CANCEL') {
      return {
        action: 'AUTO_CANCEL',
        event: { ...evalResult.existingEvent, status: 'CANCELLED', updatedAt: new Date().toISOString() },
        reason: evalResult.reason,
        audit
      };
    }

    if (evalResult.action === 'UPDATE') {
      return {
        action: 'AUTO_UPDATE',
        event: {
          ...evalResult.existingEvent,
          ...normalizedEvent,
          id: evalResult.existingEvent.id,
          updatedAt: new Date().toISOString()
        },
        reason: evalResult.reason,
        audit
      };
    }

    if (evalResult.action === 'NOOP') {
      return {
        action: 'IGNORED',
        event: evalResult.existingEvent || normalizedEvent,
        reason: evalResult.reason,
        audit
      };
    }

    if (normalizedEvent.confidence >= 0.85 && !normalizedEvent.needsReview) {
      return {
        action: 'AUTO_ADD',
        event: normalizedEvent,
        reason: 'High confidence parsed event',
        audit
      };
    } else if (normalizedEvent.confidence >= 0.5) {
      return {
        action: 'NEEDS_REVIEW',
        event: { ...normalizedEvent, needsReview: true },
        reason: 'Medium confidence — flag for verification',
        audit
      };
    } else {
      return {
        action: 'NEEDS_REVIEW',
        event: { ...normalizedEvent, needsReview: true },
        reason: 'Low confidence parsed details',
        audit
      };
    }
  }

  /**
   * Deterministic regex-based parser for common meeting emails
   */
  parseDeterministic(text, subject = '') {
    if (!text) return null;

    // 1. Date extraction: e.g. "Tuesday, August 25" or "Aug 25, 2026" or "2026-08-25"
    let dateStr = null;
    const dateMatch1 = text.match(/\b(202\d-[01]\d-[0-3]\d)\b/);
    const dateMatch2 = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:\s*,?\s*(202\d))?/i);
    const dateMatch3 = text.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(202\d)\b/);
    
    if (dateMatch1) {
      dateStr = dateMatch1[1];
    } else if (dateMatch2) {
      const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const monthIndex = monthNames.findIndex(m => dateMatch2[1].toLowerCase().startsWith(m));
      const day = String(dateMatch2[2]).padStart(2, '0');
      const year = dateMatch2[3] || new Date().getFullYear();
      const month = String(monthIndex + 1).padStart(2, '0');
      dateStr = `${year}-${month}-${day}`;
    } else if (dateMatch3) {
      dateStr = `${dateMatch3[3]}-${String(dateMatch3[1]).padStart(2, '0')}-${String(dateMatch3[2]).padStart(2, '0')}`;
    }

    // 2. Time extraction: e.g. "10:00 AM" or "2:00 PM" or "14:00"
    let startTimeStr = null;
    const timeMatch = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(am|pm)\b/i)
      || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] || '00';
      const ampm = (timeMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      startTimeStr = `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    // 3. Duration extraction (e.g. "45 minutes", "30 mins", "1 hour")
    let durationMinutes = 60;
    const durMatch = text.match(/\b(15|30|45|60|90)\s*(?:mins?|minutes)\b/i);
    if (durMatch) {
      durationMinutes = parseInt(durMatch[1], 10);
    } else if (/1\s*hour/i.test(text)) {
      durationMinutes = 60;
    }

    if (!dateStr || !startTimeStr) {
      return null;
    }

    const startIso = this.combineDateTimeToISO(dateStr, startTimeStr);
    const hasExplicitDuration = Boolean(durMatch || /1\s*hour/i.test(text));
    const endIso = hasExplicitDuration
      ? new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString()
      : null;

    const title = subject.replace(/^(?:Fwd|Re):\s*/i, '').trim() || 'Meeting with Candidate';

    return {
      title,
      start: startIso,
      end: endIso,
      timezone: this.defaultTimezone,
      notes: text,
      confidence: 0.85,
      parserUsed: 'Deterministic'
    };
  }

  combineDateTimeToISO(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    // Create Date in UTC or local Pacific context
    const d = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
    return d.toISOString();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IntakeProcessor;
}
