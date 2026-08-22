/**
 * Event Normalizer Service
 * Categorizes events deterministically, extracts interview details, formats Pacific timestamps,
 * and assigns confidence scores.
 */

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
    const category = rawData.category || this.detectCategory(combinedText);

    // 2. Extract Company & Position if Interview or Recruiter
    const interviewData = this.extractInterviewMetadata(combinedText, title);

    // 3. Meeting Link Detection
    const meetingUrl = rawData.meetingUrl || this.detectMeetingUrl(combinedText);

    // 4. Timezone & Validity
    const timezone = rawData.timezone || 'America/Los_Angeles';
    const start = rawData.start || null;
    const end = rawData.end || null;

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
      company: rawData.company || interviewData.company || '',
      position: rawData.position || interviewData.position || '',
      category,
      start,
      end,
      timezone,
      location,
      meetingUrl: meetingUrl || '',
      priority: rawData.priority || (category === 'INTERVIEW' ? 'HIGH' : 'NORMAL'),
      status: rawData.status || 'CONFIRMED',
      source: rawData.source || 'EMAIL_INTAKE',
      sourceEmail: rawData.sourceEmail || 'gilbert.cgpt@gmail.com',
      gmailMessageId: rawData.gmailMessageId || null,
      icalUid: rawData.icalUid || null,
      icalSequence: rawData.icalSequence || 0,
      organizer: rawData.organizer || '',
      interviewStage: rawData.interviewStage || interviewData.stage || (category === 'INTERVIEW' ? 'TECHNICAL' : null),
      interviewType: rawData.interviewType || interviewData.format || (meetingUrl ? 'Google Meet' : 'Other'),
      notes: description,
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EventNormalizer;
}
