/**
 * Gmail Client (Server-side Only)
 * Handles OAuth token refresh, querying the "Command Center Intake" label,
 * fetching messages, and updating label statuses without frontend secrets.
 */

class GmailClient {
  constructor(config = {}) {
    // Trim to guard against trailing whitespace/newlines pasted into env var storage, which Google rejects as invalid_grant
    this.clientId = (config.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
    this.clientSecret = (config.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
    this.redirectUri = (config.GOOGLE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI || '').trim();
    this.refreshToken = (config.GMAIL_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN || '').trim();
    this.intakeAccount = config.GMAIL_INTAKE_ACCOUNT || process.env.GMAIL_INTAKE_ACCOUNT || 'gilbert.cgpt@gmail.com';
    this.calendarIntakeAddress = config.GMAIL_CALENDAR_INTAKE_ADDRESS || process.env.GMAIL_CALENDAR_INTAKE_ADDRESS || 'gilbert.cgpt+calendar@gmail.com';
    this.intakeLabel = config.GMAIL_INTAKE_LABEL || process.env.GMAIL_INTAKE_LABEL || 'Command Center Intake';
  }

  /**
   * Generates Google OAuth authorization URL for manual setup
   */
  getAuthUrl() {
    // Validate required configuration
    const missing = [];
    if (!this.clientId) missing.push('GOOGLE_CLIENT_ID');
    if (!this.redirectUri) missing.push('GOOGLE_REDIRECT_URI');
    if (missing.length) {
      throw new Error(`Gmail OAuth configuration missing: ${missing.join(', ')}`);
    }

    // Sending remains opt-in; users must explicitly reconnect before gmail.send is granted.
    const scopes = encodeURIComponent([
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.send'
    ].join(' '));

    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent`;
  }

  /**
   * Exchange OAuth authorization code for tokens
   */
  async exchangeCode(code) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token exchange failed: ${err}`);
    }

    return await res.json();
  }

  /**
   * Fetch new access token using refresh token
   */
  async getAccessToken() {
    if (!this.refreshToken) {
      throw new Error('GMAIL_REFRESH_TOKEN is not configured.');
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to refresh Gmail access token: ${err}`);
    }

    const data = await res.json();
    return data.access_token;
  }

  async resolveIntakeLabelId() {
    return await this.resolveLabelId(this.intakeLabel, true);
  }

  async resolveLabelId(labelName, createIfMissing = false) {
    const accessToken = await this.getAccessToken();
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail list labels error: ${err}`);
    }

    const data = await res.json();
    let label = (data.labels || []).find(item => item.name === labelName);
    if (!label && createIfMissing) {
      const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' })
      });
      if (!createRes.ok) throw new Error(`Gmail create label failed: ${await createRes.text()}`);
      label = await createRes.json();
    }
    if (!label) {
      throw new Error(`Gmail label not found: ${labelName}`);
    }

    console.log(`Resolved intake label: ${labelName}`);
    console.log(`Resolved label ID: ${label.id}`);
    return label.id;
  }

  async ensureLifecycleLabels() {
    const entries = await Promise.all([
      [this.intakeLabel, 'intake'],
      ['Command Center Processed', 'processed'],
      ['Command Center Needs Review', 'needsReview'],
      ['Command Center Ignored', 'ignored']
    ].map(async ([name, key]) => [key, await this.resolveLabelId(name, true)]));
    return Object.fromEntries(entries);
  }

  async listMessages(params) {
    const accessToken = await this.getAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) throw new Error(`Gmail list messages error: ${await res.text()}`);
    return (await res.json()).messages || [];
  }

  /**
   * Discover exact plus-address recipients or messages carrying the legacy intake label.
   */
  async listIntakeMessages(maxResults = 10) {
    const labelIds = await this.ensureLifecycleLabels();
    const labeledParams = new URLSearchParams({ maxResults: String(maxResults) });
    labeledParams.append('labelIds', labelIds.intake);
    const addressParams = new URLSearchParams({
      maxResults: String(maxResults),
      q: `to:${this.calendarIntakeAddress} -label:"Command Center Processed" -label:"Command Center Needs Review" -label:"Command Center Ignored"`
    });

    const [labeledMessages, addressedMessages] = await Promise.all([
      this.listMessages(labeledParams),
      this.listMessages(addressParams)
    ]);
    const messages = [...new Map([...labeledMessages, ...addressedMessages].map(message => [message.id, message])).values()];
    console.log(`Command Center intake candidates found: ${messages.length}`);
    return { labelId: labelIds.intake, labelIds, messages };
  }

  isIntakeCandidate(gmailMessage, labelIds) {
    const currentLabels = gmailMessage.labelIds || [];
    if ([labelIds.processed, labelIds.needsReview, labelIds.ignored].some(id => currentLabels.includes(id))) return false;
    if (currentLabels.includes(labelIds.intake)) return true;

    const headers = gmailMessage.payload?.headers || [];
    const recipientHeaders = headers
      .filter(header => /^(to|cc|delivered-to|x-original-to)$/i.test(header.name || ''))
      .map(header => header.value || '')
      .join(' ')
      .toLowerCase();
    return recipientHeaders.includes(this.calendarIntakeAddress.toLowerCase());
  }

  /**
   * Fetch full message payload with MIME parts
   */
  async getMessage(messageId) {
    const accessToken = await this.getAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail get message error: ${err}`);
    }

    return await res.json();
  }

  async getAttachment(messageId, attachmentId) {
    const accessToken = await this.getAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gmail get attachment error: ${err}`);
    }

    return await res.json();
  }

  async hydrateCalendarAttachments(gmailMessage) {
    const MimeParser = require('./mimeParser');
    const metadata = [];
    const inspect = part => {
      if (!part) return;
      metadata.push({
        mimeType: part.mimeType || '',
        filename: part.filename || '',
        partId: part.partId || '',
        hasAttachmentId: Boolean(part.body?.attachmentId)
      });
      if (Array.isArray(part.parts)) part.parts.forEach(inspect);
    };
    inspect(gmailMessage.payload);
    console.log(`Gmail MIME metadata for ${gmailMessage.id}: ${JSON.stringify(metadata)}`);

    const attachments = MimeParser.getCalendarAttachmentParts(gmailMessage);

    for (const { part, attachmentId } of attachments) {
      const attachment = await this.getAttachment(gmailMessage.id, attachmentId);
      if (attachment.data) part.body.data = attachment.data;
    }

    return gmailMessage;
  }

  /**
   * Mark message as processed by modifying labels
   */
  async markProcessed(messageId, removeLabelIds = [], addLabelIds = []) {
    const accessToken = await this.getAccessToken();
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        removeLabelIds,
        addLabelIds
      })
    });

    return res.ok;
  }

  async routeProcessedMessage(messageId, action, labelIds) {
    let destinationLabelId = labelIds.processed;
    if (action === 'NEEDS_REVIEW') destinationLabelId = labelIds.needsReview;
    if (action === 'IGNORED_PAST' || action === 'IGNORED') destinationLabelId = labelIds.ignored;
    const updated = await this.markProcessed(messageId, [labelIds.intake], [destinationLabelId]);
    if (!updated) throw new Error(`Failed to update Gmail labels for message ${messageId}`);
  }

  async sendEmail({ to, subject, body }) {
    if (!to || to.toLowerCase() !== this.intakeAccount.toLowerCase()) {
      throw new Error('Reminder recipient must match the configured personal notification account.');
    }
    const accessToken = await this.getAccessToken();
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body
    ].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });
    if (!res.ok) throw new Error(`Gmail reminder send failed: ${await res.text()}`);
    return await res.json();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GmailClient;
}
