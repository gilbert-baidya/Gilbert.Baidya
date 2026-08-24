const IntakeProcessor = require('../../services/gmail/intakeProcessor');
const GmailClient = require('../../services/gmail/gmailClient');
const ServerStore = require('../../services/firebase/serverStore');
const { processInterviewEmailReminders } = require('../../services/notifications/interviewEmailReminder');

async function processLabeledMessages(client, processor, existingEvents = [], maxResults = 5, store = null) {
  const { labelId, labelIds = { intake: labelId }, messages } = await client.listIntakeMessages(maxResults);
  const results = [];

  for (const msgSummary of messages) {
    let fullMsg = await client.getMessage(msgSummary.id);
    const isCandidate = typeof client.isIntakeCandidate === 'function'
      ? client.isIntakeCandidate(fullMsg, labelIds)
      : Array.isArray(fullMsg.labelIds) && fullMsg.labelIds.includes(labelId);
    if (!isCandidate) {
      continue;
    }
    if (typeof client.hydrateCalendarAttachments === 'function') {
      fullMsg = await client.hydrateCalendarAttachments(fullMsg);
    }
    console.log(`Processing Gmail message: ${msgSummary.id}`);
    let result = await processor.process({ gmailMessage: fullMsg }, existingEvents);
    if (result.event?.end && new Date(result.event.end) < new Date()) {
      result = {
        ...result,
        action: 'IGNORED_PAST',
        reason: 'Invitation has already ended and was not added to the active calendar'
      };
    }
    if (store) {
      await store.persistGmailResult(fullMsg, result);
      if (typeof client.routeProcessedMessage === 'function') {
        await client.routeProcessedMessage(msgSummary.id, result.action, labelIds);
      } else {
        await client.moveToProcessed(msgSummary.id, labelId);
      }
    }
    console.log(`Gmail intake result for ${msgSummary.id}: action=${result.action}, parser=${result.audit?.parserUsed || result.event?.parserUsed || 'Unknown'}`);
    results.push({ messageId: msgSummary.id, ...result });
  }

  return { labelId, messages, results };
}

async function processOptionalEmailReminders(client, store) {
  if (!store) return { status: 'DISABLED', processed: 0 };
  const settings = await store.loadNotificationSettings();
  if (!settings.personalEmailReminders) return { status: 'DISABLED', processed: 0 };
  const events = await store.loadExistingEvents();
  const results = await processInterviewEmailReminders({
    events,
    settings,
    recipient: client.intakeAccount,
    claim: (id, reminder) => store.claimEmailReminder(id, reminder),
    send: email => client.sendEmail(email),
    complete: (id, status, error) => store.completeEmailReminder(id, status, error)
  });
  return { status: 'SUCCESS', processed: results.filter(result => result.status === 'SENT').length, results };
}

exports.handler = async (event, context) => {
  // Allow POST for direct webhook or simulation, GET for cron polling
  try {
    let payload = null;
    if (event.body) {
      try {
        payload = JSON.parse(event.body);
      } catch (e) {
        payload = { rawEmailText: event.body };
      }
    }

    const processor = new IntakeProcessor();
    let existingEvents = payload?.existingEvents || [];

    // Mode A: Direct payload processing (Simulation or Dev mode)
    if (payload?.rawIcs || payload?.rawEmailText || payload?.gmailMessage) {
      const result = await processor.process(payload, existingEvents);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    // Mode B: Polling Gmail API if configured
    const client = new GmailClient();
    if (!process.env.GMAIL_REFRESH_TOKEN) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'STANDBY',
          message: 'GMAIL_REFRESH_TOKEN not configured. Use Simulation/Dev mode or connect OAuth.'
        })
      };
    }

    let store = null;
    let persistenceError = null;
    try {
      store = new ServerStore();
      existingEvents = await store.loadExistingEvents();
    } catch (error) {
      if (!error.message.startsWith('Firebase Admin configuration missing:')) throw error;
      persistenceError = error.message;
    }
    const { messages, results } = await processLabeledMessages(client, processor, existingEvents, 5, store);
    const emailReminders = await processOptionalEmailReminders(client, store);
    if (messages.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'NO_INTAKE_MESSAGES',
          processed: 0,
          processedCount: 0,
          items: [],
          emailReminders
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: persistenceError ? 'PERSISTENCE_CONFIGURATION_REQUIRED' : 'SUCCESS',
        processed: persistenceError ? 0 : results.length,
        processedCount: persistenceError ? 0 : results.length,
        parsedCount: results.length,
        configurationError: persistenceError,
        items: results,
        emailReminders
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

exports.processLabeledMessages = processLabeledMessages;
exports.processOptionalEmailReminders = processOptionalEmailReminders;
