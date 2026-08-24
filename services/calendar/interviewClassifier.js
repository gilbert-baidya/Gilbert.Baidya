class InterviewClassifier {
  static classifyInterviewIntent(event = {}) {
    const title = this.normalize(event.title || event.summary || '');
    const subject = this.normalize(event.originalSubject || event.emailSubject || event.subject || '');
    const description = this.normalize(event.description || event.notes || event.sourceSnippet || '');
    const organizer = this.normalize(event.organizer || event.recruiter || event.recruiterEmail || '');
    const attendees = this.normalize(Array.isArray(event.attendees) ? event.attendees.join(' ') : event.attendees || '');
    const explicitCompany = String(event.company || '').trim();
    const explicitPosition = String(event.position || event.role || '').trim();
    const text = [title, subject, description, organizer, attendees, explicitCompany, explicitPosition].filter(Boolean).join(' ');

    const reasons = [];
    let score = 0;
    let stage = null;

    const stageSignals = [
      { pattern: /\btechnical\s+discussion\b/i, stage: 'Technical Discussion', score: 0.5, reason: 'technical-discussion' },
      { pattern: /\btechnical\s+(?:screening|screen)\b/i, stage: 'Technical Screening', score: 0.72, reason: 'technical-screening' },
      { pattern: /\b(?:phone\s+screen|screening\s+call|recruiter\s+screen)\b/i, stage: 'Phone Screening', score: 0.72, reason: 'screening' },
      { pattern: /\brecruiter\s+(?:call|conversation|chat)\b/i, stage: 'Recruiter Screening', score: 0.68, reason: 'recruiter-conversation' },
      { pattern: /\b(?:hr|human\s+resources)\s+(?:discussion|interview|call)\b/i, stage: 'HR Discussion', score: 0.58, reason: 'hr-discussion' },
      { pattern: /\b(?:hiring\s+manager(?:\s+discussion)?|managerial\s+round)\b/i, stage: 'Hiring Manager', score: 0.68, reason: 'hiring-manager' },
      { pattern: /\b(?:coding\s+round|coding\s+challenge)\b/i, stage: 'Coding Round', score: 0.7, reason: 'coding-round' },
      { pattern: /\bsystem\s+design(?:\s+interview|\s+round)?\b/i, stage: 'System Design Round', score: 0.7, reason: 'system-design' },
      { pattern: /\btechnical\s+round(?:\s+\d+)?\b/i, stage: 'Technical Round', score: 0.7, reason: 'technical-round' },
      { pattern: /\bbehavioral\s+round\b/i, stage: 'Behavioral Round', score: 0.7, reason: 'behavioral-round' },
      { pattern: /\bfinal\s+(?:round|discussion)\b/i, stage: /\bround\b/i.test(text) ? 'Final Round' : 'Final Discussion', score: 0.64, reason: 'final-stage' },
      { pattern: /\b(?:panel\s+interview|panel\s+discussion)\b/i, stage: 'Panel Interview', score: 0.64, reason: 'panel-stage' },
      { pattern: /\b(?:assessment\s+interview|assessment\s+discussion|technical\s+assessment|case\s+study)\b/i, stage: 'Assessment', score: 0.64, reason: 'assessment-stage' },
      { pattern: /\b(?:interview\s+loop|candidate\s+interview|candidate\s+discussion)\b/i, stage: 'Interview', score: 0.7, reason: 'candidate-interview' },
      { pattern: /\bmeet\s+the\s+(?:engineering\s+)?team\b/i, stage: 'Meet the Team', score: 0.5, reason: 'meet-the-team' },
      { pattern: /\b(?:career\s+conversation|role\s+discussion|initial\s+discussion|introductory\s+call)\b/i, stage: 'Interview', score: 0.46, reason: 'recruiting-conversation' }
    ];

    if (/\binterview\b/i.test(text)) {
      score = 0.92;
      reasons.push('explicit-interview');
    }

    for (const signal of stageSignals) {
      if (signal.pattern.test(text)) {
        if (!stage) stage = signal.stage;
        score = Math.max(score, signal.score);
        reasons.push(signal.reason);
      }
    }

    const contextualSignals = [
      { pattern: /\brole\s*[-:]\s*[a-z0-9]/i, score: 0.25, reason: 'job-role' },
      { pattern: /\b(?:position|opportunity|application|resume|\bcv\b|job\s+description|employment|careers?)\b/i, score: 0.2, reason: 'job-context' },
      { pattern: /\b(?:candidate|selection\s+process|interview\s+process|next\s+round)\b/i, score: 0.22, reason: 'candidate-context' },
      { pattern: /\b(?:recruiter|recruiting|talent\s+acquisition|\bhiring\b|human\s+resources|\bhr\b)\b/i, score: 0.24, reason: 'recruiting-context' },
      { pattern: /\b(?:sdet|quality\s+(?:assurance|engineer)|qa\s+(?:automation|engineer|architect)|automation\s+(?:qa|engineer|architect)|software\s+(?:quality\s+)?engineer)\b/i, score: 0.16, reason: 'job-title' }
    ];

    let contextScore = 0;
    for (const signal of contextualSignals) {
      if (signal.pattern.test(text)) {
        contextScore = Math.min(0.46, contextScore + signal.score);
        reasons.push(signal.reason);
      }
    }

    if (explicitPosition) {
      contextScore = Math.min(0.46, contextScore + 0.2);
      reasons.push('parsed-position');
    }
    if (/\b(?:recruiter|talent|hiring|human\s+resources|\bhr\b)\b/i.test(organizer)) {
      contextScore = Math.min(0.46, contextScore + 0.24);
      reasons.push('recruiting-organizer');
    }
    if (event.meetingUrl || /\b(?:teams|zoom|google\s+meet)\b/i.test(text)) reasons.push('scheduled-meeting');

    score = Math.min(0.99, score + contextScore);
    if (String(event.category || '').toUpperCase() === 'INTERVIEW' || event.isInterview === true) {
      score = Math.max(score, 0.9);
      reasons.push('existing-interview-classification');
    }

    const isInterview = score >= 0.72;
    const metadata = this.extractMetadata(event, title || subject);

    return {
      isInterview,
      confidence: Number(score.toFixed(2)),
      category: isInterview ? 'INTERVIEW' : String(event.category || 'OTHER').toUpperCase(),
      stage: isInterview ? (stage || event.interviewStage || 'Interview') : null,
      company: explicitCompany || metadata.company,
      position: explicitPosition || metadata.position,
      reasons: [...new Set(reasons)]
    };
  }

  static extractMetadata(event, sourceTitle) {
    const rawTitle = String(event.title || event.summary || event.originalSubject || sourceTitle || '').trim();
    const companyMatch = rawTitle.match(/^\s*([A-Z][A-Z0-9 .&'-]{1,50}?)\s*[-–—|]\s*/);
    const roleMatch = rawTitle.match(/\brole\s*[-:]\s*([^|,;]+?)(?:\s*[-–—|]\s*|$)/i);
    return {
      company: companyMatch ? companyMatch[1].trim() : '',
      position: roleMatch ? roleMatch[1].trim() : ''
    };
  }

  static normalize(value) {
    return String(value || '').replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = InterviewClassifier;
if (typeof window !== 'undefined') window.InterviewClassifier = InterviewClassifier;