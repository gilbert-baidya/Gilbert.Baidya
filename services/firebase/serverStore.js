const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

class ServerStore {
  constructor(config = {}) {
    this.projectId = config.projectId || process.env.FIREBASE_PROJECT_ID;
    this.clientEmail = config.clientEmail || process.env.FIREBASE_CLIENT_EMAIL;
    this.privateKey = (config.privateKey || process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    this.ownerUid = config.ownerUid || process.env.FIREBASE_OWNER_UID;

    const missing = [];
    if (!this.projectId) missing.push('FIREBASE_PROJECT_ID');
    if (!this.clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!this.privateKey) missing.push('FIREBASE_PRIVATE_KEY');
    if (!this.ownerUid) missing.push('FIREBASE_OWNER_UID');
    if (missing.length) throw new Error(`Firebase Admin configuration missing: ${missing.join(', ')}`);

    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: this.projectId,
          clientEmail: this.clientEmail,
          privateKey: this.privateKey
        }),
        projectId: this.projectId
      });
    }

    this.db = getFirestore();
    this.userRef = this.db.collection('users').doc(this.ownerUid);
  }

  async loadExistingEvents() {
    const snapshot = await this.userRef.collection('events').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async persistGmailResult(gmailMessage, result) {
    const gmailMessageId = gmailMessage.id;
    const intakeRef = this.userRef.collection('emailIntake').doc(gmailMessageId);
    let eventId = result.event?.id || null;
    const headers = Object.fromEntries((gmailMessage.payload?.headers || []).map(header => [String(header.name).toLowerCase(), header.value]));
    const receivedAt = gmailMessage.internalDate ? new Date(Number(gmailMessage.internalDate)).toISOString() : null;
    const processedAt = result.audit?.processedAt || new Date().toISOString();
    const eventWithAudit = this.clean({
      ...result.event,
      source: 'EMAIL_INTAKE',
      originalSubject: headers.subject || '',
      receivedAt,
      processedAt,
      parserUsed: result.audit?.parserUsed || result.event?.parserUsed || 'Unknown'
    });

    if (result.action === 'AUTO_ADD') {
      const eventRef = this.userRef.collection('events').doc();
      eventId = eventRef.id;
      await eventRef.set({ ...eventWithAudit, id: eventId });
    } else if ((result.action === 'AUTO_UPDATE' || result.action === 'AUTO_CANCEL') && eventId) {
      await this.userRef.collection('events').doc(eventId).set(eventWithAudit, { merge: true });
    }

    const needsReview = result.action === 'NEEDS_REVIEW' || Boolean(result.event?.needsReview);
    const intake = this.clean({
      gmailMessageId,
      gmailThreadId: gmailMessage.threadId || null,
      title: result.event?.title || 'Forwarded Meeting Request',
      sourceEmail: result.event?.sourceEmail || '',
      receivedAt,
      processedAt,
      action: result.action,
      status: needsReview ? 'NEEDS_REVIEW' : result.action,
      parserUsed: result.audit?.parserUsed || result.event?.parserUsed || 'Unknown',
      confidence: result.audit?.confidence ?? result.event?.confidence ?? 0,
      reason: result.reason || '',
      needsReview,
      event: eventWithAudit,
      eventId,
      icalUid: result.event?.icalUid || null,
      start: result.event?.start || null,
      end: result.event?.end || null,
      category: result.event?.category || 'OTHER',
      company: result.event?.company || '',
      meetingUrl: result.event?.meetingUrl || ''
    });

    await intakeRef.set(intake, { merge: true });
    return { eventId, intakeId: gmailMessageId };
  }

  clean(value) {
    return JSON.parse(JSON.stringify(value));
  }
}

module.exports = ServerStore;
