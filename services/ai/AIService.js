/**
 * AI Service Layer
 * Clean optional abstraction supporting Ollama and local LLM endpoints.
 * Provides meeting email parsing, categorization, and interview detail extraction with schema validation.
 */

class AIService {
  constructor(config = {}) {
    this.provider = config.AI_PROVIDER || process.env.AI_PROVIDER || 'Ollama';
    this.baseUrl = config.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = config.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'llama3:latest';
  }

  async checkHealth() {
    if (this.provider === 'Disabled') return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Parse natural language meeting email into structured JSON.
   * @param {string} emailText 
   * @returns {Promise<Object|null>}
   */
  async parseMeetingEmail(emailText) {
    if (!emailText || typeof emailText !== 'string') return null;

    const isOnline = await this.checkHealth();
    if (!isOnline) {
      return null; // Return null so pipeline falls back cleanly to deterministic
    }

    const systemPrompt = `You are a calendar extraction AI. Extract the meeting invitation details from the text as strict valid JSON. 
Schema:
{
  "title": "Short descriptive title",
  "company": "Company name if present or empty string",
  "position": "Role or position if present or empty string",
  "category": "INTERVIEW|RECRUITER|JOB_1|JOB_2|JOB_3|CHURCH|PERSONAL|FOCUS|OTHER",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "durationMinutes": 60,
  "timezone": "America/Los_Angeles",
  "meetingUrl": "Valid URL or empty string",
  "interviewStage": "SCREENING|TECHNICAL|HIRING_MANAGER|FINAL|OFFER",
  "priority": "LOW|NORMAL|HIGH|URGENT",
  "confidence": 0.9,
  "needsReview": false
}
Return ONLY JSON without markdown formatting or commentary.`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${systemPrompt}\n\nEmail Text:\n${emailText}`,
          format: 'json',
          stream: false
        })
      });

      if (!response.ok) return null;
      const data = await response.json();
      const parsed = JSON.parse(data.response);

      // Validate output against schema
      if (!parsed.title || !parsed.date) {
        return null;
      }

      return {
        ...parsed,
        parserUsed: 'Ollama'
      };
    } catch (err) {
      console.warn('[AIService] Ollama parse failed:', err.message);
      return null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIService;
}
