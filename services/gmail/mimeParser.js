/**
 * Recursive MIME Message & Attachment Parser
 * Handles multipart/alternative, multipart/mixed, nested forwarded messages (message/rfc822),
 * and extracts text/calendar, .ics attachments, HTML, and plain text.
 */

class MimeParser {
  /**
   * Parse a raw Gmail API message object into structured text and attachments.
   * @param {Object} gmailMessage - Raw Gmail message payload from API
   * @returns {{ plainText: string, html: string, icsData: Array<{ filename: string, content: string }>, headers: Object }}
   */
  static parse(gmailMessage) {
    if (!gmailMessage || !gmailMessage.payload) {
      return { plainText: '', html: '', icsData: [], headers: {} };
    }

    const headers = this.extractHeaders(gmailMessage.payload.headers || []);
    let plainText = '';
    let html = '';
    const icsData = [];

    const walkParts = (part) => {
      if (!part) return;

      const mimeType = (part.mimeType || '').toLowerCase();
      const filename = (part.filename || '').toLowerCase();

      // Check for .ics calendar attachment
      if (mimeType.includes('text/calendar') || mimeType.includes('application/ics') || filename.endsWith('.ics')) {
        let content = '';
        if (part.body && part.body.data) {
          content = this.decodeBase64(part.body.data);
        } else if (part.body && part.body.attachmentId) {
          content = part.body.data ? this.decodeBase64(part.body.data) : '';
        }
        if (content) {
          icsData.push({
            filename: part.filename || 'invite.ics',
            content
          });
        }
      }

      // Plain text body
      if (mimeType === 'text/plain' && part.body && part.body.data) {
        plainText += this.decodeBase64(part.body.data) + '\n';
      }

      // HTML body
      if (mimeType === 'text/html' && part.body && part.body.data) {
        html += this.decodeBase64(part.body.data) + '\n';
      }

      // Recursive traversal of subparts (multipart/* or message/rfc822)
      if (part.parts && Array.isArray(part.parts)) {
        part.parts.forEach(walkParts);
      }
    };

    // If payload has direct body data
    if (gmailMessage.payload.body && gmailMessage.payload.body.data) {
      const mime = (gmailMessage.payload.mimeType || '').toLowerCase();
      if (mime.includes('text/calendar')) {
        icsData.push({
          filename: 'invite.ics',
          content: this.decodeBase64(gmailMessage.payload.body.data)
        });
      } else if (mime === 'text/plain') {
        plainText += this.decodeBase64(gmailMessage.payload.body.data);
      } else if (mime === 'text/html') {
        html += this.decodeBase64(gmailMessage.payload.body.data);
      }
    }

    walkParts(gmailMessage.payload);

    // If plainText is empty but HTML exists, strip HTML tags for natural-language parsing
    if (!plainText.trim() && html) {
      plainText = this.stripHtml(html);
    }

    return {
      headers,
      plainText: plainText.trim(),
      html: html.trim(),
      icsData
    };
  }

  static getCalendarAttachmentParts(gmailMessage) {
    const attachments = [];

    const walkParts = (part) => {
      if (!part) return;
      const mimeType = (part.mimeType || '').toLowerCase();
      const filename = (part.filename || '').toLowerCase();
      const attachmentId = part.body?.attachmentId;

      if (attachmentId && (
        mimeType.includes('text/calendar') ||
        mimeType.includes('application/ics') ||
        filename.endsWith('.ics')
      )) {
        attachments.push({ part, attachmentId });
      }

      if (Array.isArray(part.parts)) part.parts.forEach(walkParts);
    };

    walkParts(gmailMessage?.payload);
    return attachments;
  }

  static extractHeaders(headersList) {
    const map = {};
    for (const h of headersList) {
      map[h.name.toLowerCase()] = h.value;
    }
    return {
      subject: map['subject'] || '',
      from: map['from'] || '',
      to: map['to'] || '',
      date: map['date'] || '',
      messageId: map['message-id'] || ''
    };
  }

  static decodeBase64(encodedString) {
    if (!encodedString) return '';
    try {
      // Gmail API uses URL-safe base64: replace - with + and _ with /
      const normalized = encodedString.replace(/-/g, '+').replace(/_/g, '/');
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(normalized, 'base64').toString('utf-8');
      } else {
        return decodeURIComponent(escape(atob(normalized)));
      }
    } catch (e) {
      console.warn('Failed to decode base64 string:', e.message);
      return '';
    }
  }

  static stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MimeParser;
}
