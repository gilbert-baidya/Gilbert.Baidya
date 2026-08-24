/**
 * Event Normalizer Service
 * Categorizes events deterministically, extracts interview details, formats Pacific timestamps,
 * and assigns confidence scores.
 */

const InterviewClassifier = typeof require === 'function'
  ? require('./interviewClassifier')
  : window.InterviewClassifier;
const InterviewTimeEngine = typeof require === 'function'
  ? require('./interviewTimeEngine')
  : window.InterviewTimeEngine;

class EventNormalizer {
  /**
   * Normalize an event candidate into the Firestore Event schema
   * @param {Object} rawData 
   * @returns {Object} Normalized event object
   */
  static normalize(rawData) {
    const title = (rawData.title || 'Untitled Event').trim();
    const description = (rawData.description || rawData.notes || '').trim();
    const location = (rawData.location || '').trim();
    const combinedText = `${title} ${description} ${location}`;

    // 1. Determine Category
    const interviewClassification = InterviewClassifier.classifyInterviewIntent(rawData);
    const category = interviewClassification.isInterview
      ? 'INTERVIEW'
      : (rawData.category || this.detectCategory(combinedText));

    // 2. Extract Company & Position if Interview or Recruiter
    const interviewData = this.extractInterviewMetadata(combinedText, title);
    const company = rawData.company || interviewClassification.company || interviewData.company || '';
    const position = rawData.position || interviewClassification.position || interviewData.position || '';

    // 3. Meeting Link Detection
    const meetingUrl = rawData.meetingUrl || this.detectMeetingUrl(combinedText);
    const meetingProvider = this.detectMeetingProvider(meetingUrl, location, rawData.interviewType);

    // 4. Timezone & Validity
    const sourceTimezone = rawData.sourceTimezone || rawData.timezone || null;
    const timezone = InterviewTimeEngine.normalizeTimeZone(rawData.timezone || sourceTimezone);
    const displayTimezone = InterviewTimeEngine.DEFAULT_TIME_ZONE;
    const start = rawData.startAt || rawData.normalizedStartAt || rawData.start || null;
    const end = rawData.endAt || rawData.normalizedEndAt || rawData.end || null;

    // 5. Confidence & Review Flag
    let confidence = rawData.confidence !== undefined ? rawData.confidence : 0.85;
    let needsReview = rawData.needsReview || false;

    if (!start || isNaN(new Date(start).getTime())) {
      confidence = 0.2;
      needsReview = true;
    } else if (!end) {
      confidence = Math.min(confidence, 0.7);
      needsReview = true;
    } else if (end && new Date(end) <= new Date(start)) {
      confidence = 0.4;
      needsReview = true;
    }

    return {
      title,
      company,
      position,
      companySource: rawData.companySource || (rawData.company ? 'source' : company ? 'subject' : null),
      roleSource: rawData.roleSource || (rawData.position ? 'source' : position ? 'subject' : null),
      category,
      isInterview: interviewClassification.isInterview,
      classification: {
        type: interviewClassification.isInterview ? 'interview' : 'other',
        confidence: interviewClassification.confidence,
        stage: interviewClassification.stage,
        reasons: interviewClassification.reasons
      },
      start,
      end,
      startAt: start,
      endAt: end,
      normalizedStartAt: start,
      normalizedEndAt: end,
      timezone,
      sourceTimezone,
      sourceTzid: rawData.sourceTzid || sourceTimezone,
      displayTimezone,
      timezoneAmbiguous: Boolean(rawData.timezoneAmbiguous),
      rawDtStart: rawData.rawDtStart || rawData.rawDtstart || null,
      rawDtEnd: rawData.rawDtEnd || rawData.rawDtend || null,
      startAtSource: rawData.startAtSource || (rawData.parserUsed === 'ICS' ? 'ics' : rawData.parserUsed || 'source'),
      location,
      meetingUrl: meetingUrl || '',
      meetingProvider,
      meetingUrlSource: rawData.meetingUrlSource || (rawData.meetingUrl ? 'ics' : meetingUrl ? 'description' : null),
      priority: rawData.priority || (category === 'INTERVIEW' ? 'HIGH' : 'NORMAL'),
      status: rawData.status || 'CONFIRMED',
      source: rawData.source || 'EMAIL_INTAKE',
      sourceEmail: rawData.sourceEmail || 'gilbert.cgpt@gmail.com',
      gmailMessageId: rawData.gmailMessageId || null,
      icalUid: rawData.icalUid || null,
      icalSequence: rawData.icalSequence || 0,
      organizer: rawData.organizer || '',
      organizerName: rawData.organizerName || rawData.recruiter || '',
      organizerEmail: String(rawData.organizerEmail || rawData.recruiterEmail || rawData.organizer || '').replace(/^mailto:/i, ''),
      organizerSource: rawData.organizerSource || (rawData.organizer || rawData.organizerName || rawData.organizerEmail ? 'ics' : null),
      interviewStage: interviewClassification.stage || rawData.interviewStage || interviewData.stage || (category === 'INTERVIEW' ? 'Interview' : null),
      interviewType: rawData.interviewType || meetingProvider || interviewData.format || 'Other',
      notes: this.buildConciseNotes(description, meetingUrl),
      confidence,
      needsReview,
      parserUsed: rawData.parserUsed || 'Deterministic',
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Deterministically detect category from text
   */
  static detectCategory(text) {
    const lower = text.toLowerCase();

    // Interview & Recruiter keywords
    if (/\b(interview|screening|hiring manager|technical round|coding challenge|assessment|onsite|recruiter|talent acquisition)\b/i.test(lower)) {
      if (/\b(recruiter call|recruiter chat|intro chat|introductory call)\b/i.test(lower)) {
        return 'RECRUITER';
      }
      return 'INTERVIEW';
    }

    // Job specific indicators
    if (/\b(standup|sync|sprint|retro|backlog|1:1 with manager|qa sync)\b/i.test(lower)) {
      return 'JOB_1';
    }

    // Church / Faith
    if (/\b(church|service|worship|bible study|fellowship|prayer|sunday service)\b/i.test(lower)) {
      return 'CHURCH';
    }

    // Focus time
    if (/\b(focus time|deep work|coding block|do not book|busy)\b/i.test(lower)) {
      return 'FOCUS';
    }

    // Personal / Medical
    if (/\b(doctor|dentist|appointment|gym|workout|family|dinner|lunch with)\b/i.test(lower)) {
      return 'PERSONAL';
    }

    return 'OTHER';
  }

  /**
   * Extract company name and role hints
   */
  static extractInterviewMetadata(text, title) {
    let company = '';
    let position = '';
    let stage = 'TECHNICAL';
    let format = 'Google Meet';

    // Look for "at [Company]" or "with [Company]"
    const compMatch = title.match(/(?:interview\s+(?:with|at)|chat\s+with|meeting\s+with)\s+([A-Z][a-zA-Z0-9_\s&]+?)(?:\s+[-–—|]|\s+for|\s*$)/i);
    if (compMatch) {
      company = compMatch[1].trim();
    }

    // Role match
    const roleMatch = title.match(/(?:for|as)\s+((?:Senior|Lead|Staff|Principal|QA|Engineer|Architect|Software|Manager)[A-Za-z\s]+?)(?:\s+[-–—|]|\s*$)/i);
    if (roleMatch) {
      position = roleMatch[1].trim();
    }

    // Format detection
    if (/zoom\.us/i.test(text)) format = 'Zoom';
    else if (/teams\.microsoft\.com/i.test(text)) format = 'Microsoft Teams';
    else if (/meet\.google\.com/i.test(text)) format = 'Google Meet';
    else if (/phone\s+call|call\s+you\s+at/i.test(text)) format = 'Phone';

    // Stage detection
    if (/screening|intro/i.test(text)) stage = 'SCREENING';
    else if (/hiring\s+manager/i.test(text)) stage = 'HIRING_MANAGER';
    else if (/final\s+round|panel/i.test(text)) stage = 'FINAL';
    else if (/offer/i.test(text)) stage = 'OFFER';

    return { company, position, stage, format };
  }

  static detectMeetingUrl(text) {
    if (!text) return null;
    const match = text.match(/https:\/\/(?:meet\.google\.com\/[a-z0-9\-]+|[a-z0-9\-\.]*zoom\.us\/[jw]\/[0-9\?&=a-z]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s>"']+)/i);
    return match ? match[0] : null;
  }

  static detectMeetingProvider(meetingUrl, location, explicitType) {
    const value = `${explicitType || ''} ${meetingUrl || ''} ${location || ''}`;
    if (/teams\.microsoft\.com|microsoft teams/i.test(value)) return 'Microsoft Teams';
    if (/zoom\.us|\bzoom\b/i.test(value)) return 'Zoom';
    if (/meet\.google\.com|google meet/i.test(value)) return 'Google Meet';
    if (/webex\.com|\bwebex\b/i.test(value)) return 'Webex';
    if (/\bphone\b/i.test(value)) return 'Phone';
    return explicitType || (meetingUrl ? 'Virtual Meeting' : 'Other');
  }

  static buildConciseNotes(description, meetingUrl) {
    if (!description) return '';
    return description
      .replace(meetingUrl || /$^/, '')
      .replace(/https?:\/\/\S+/g, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter((line, index, lines) => line && lines.indexOf(line) === index)
      .join('\n')
      .slice(0, 1200);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventNormalizer;
}
