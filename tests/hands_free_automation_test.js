const fs = require('fs');
const GmailClient = require('../services/gmail/gmailClient');
const IntakeProcessor = require('../services/gmail/intakeProcessor');
const gmailProcess = require('../netlify/functions/gmail-process');
const gmailScheduled = require('../netlify/functions/gmail-scheduled');
const {
  FIXTURE_1_CLEAN_INTERVIEW,
  FIXTURE_2_RESCHEDULE,
  FIXTURE_3_CANCEL
} = require('./fixtures/test_fixtures');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.error(`FAIL: ${name}`);
    failed++;
  }
}

const labelIds = {
  intake: 'Label_intake',
  processed: 'Label_processed',
  needsReview: 'Label_review',
  ignored: 'Label_ignored'
};

function gmailMessage({ id = 'message-1', labels = [], recipient = 'gilbert.cgpt+calendar@gmail.com' } = {}) {
  return {
    id,
    labelIds: labels,
    payload: {
      headers: recipient ? [{ name: 'To', value: recipient }] : []
    }
  };
}

async function testCandidateDetection() {
  const client = new GmailClient();
  assert(client.isIntakeCandidate(gmailMessage(), labelIds), 'plus-address email is detected');
  assert(!client.isIntakeCandidate(gmailMessage({ recipient: 'gilbert.cgpt@gmail.com' }), labelIds), 'unrelated Gmail is ignored');
  assert(client.isIntakeCandidate(gmailMessage({ labels: [labelIds.intake], recipient: '' }), labelIds), 'legacy Intake label remains supported');
  assert(!client.isIntakeCandidate(gmailMessage({ labels: [labelIds.processed] }), labelIds), 'Processed email is skipped');
}

async function testResultLabelRouting() {
  const client = new GmailClient();
  const calls = [];
  client.markProcessed = async (id, removeIds, addIds) => {
    calls.push({ id, removeIds, addIds });
    return true;
  };

  await client.routeProcessedMessage('add', 'AUTO_ADD', labelIds);
  await client.routeProcessedMessage('update', 'AUTO_UPDATE', labelIds);
  await client.routeProcessedMessage('cancel', 'AUTO_CANCEL', labelIds);
  await client.routeProcessedMessage('review', 'NEEDS_REVIEW', labelIds);
  await client.routeProcessedMessage('past', 'IGNORED_PAST', labelIds);

  assert(calls.slice(0, 3).every(call => call.addIds[0] === labelIds.processed), 'add/update/cancel receive Processed label');
  assert(calls[3].addIds[0] === labelIds.needsReview, 'Needs Review receives review label');
  assert(calls[4].addIds[0] === labelIds.ignored, 'past invitation receives Ignored label');
  assert(calls.every(call => call.removeIds[0] === labelIds.intake), 'Intake label is removed after routing');
}

async function testPersistenceOrderingAndFailure() {
  const order = [];
  const client = {
    listIntakeMessages: async () => ({ labelId: labelIds.intake, labelIds, messages: [{ id: 'message-1' }] }),
    getMessage: async () => gmailMessage({ labels: [labelIds.intake] }),
    isIntakeCandidate: () => true,
    routeProcessedMessage: async () => order.push('label')
  };
  const processor = { process: async () => ({ action: 'NEEDS_REVIEW', event: { needsReview: true } }) };
  const store = { persistGmailResult: async () => order.push('persist') };
  await gmailProcess.processLabeledMessages(client, processor, [], 5, store);
  assert(order.join(',') === 'persist,label', 'Firestore persistence completes before Gmail labels change');

  let labelChanged = false;
  client.routeProcessedMessage = async () => { labelChanged = true; };
  const failingStore = { persistGmailResult: async () => { throw new Error('Firestore unavailable'); } };
  try {
    await gmailProcess.processLabeledMessages(client, processor, [], 5, failingStore);
  } catch (error) {
    assert(error.message === 'Firestore unavailable' && !labelChanged, 'Firestore failure leaves Gmail labels unchanged');
  }
}

async function testPipelineLifecycleAndIdempotency() {
  const processor = new IntakeProcessor();
  const added = await processor.process({ rawIcs: FIXTURE_1_CLEAN_INTERVIEW });
  assert(added.action === 'AUTO_ADD', 'high-confidence ICS auto-adds');

  const existing = [{ id: 'event-1', ...added.event }];
  const repeated = await processor.process({ rawIcs: FIXTURE_1_CLEAN_INTERVIEW }, existing);
  assert(repeated.action === 'IGNORED', 'repeated schedule execution does not duplicate event');

  const updated = await processor.process({ rawIcs: FIXTURE_2_RESCHEDULE }, existing);
  assert(updated.action === 'AUTO_UPDATE' && updated.event.id === 'event-1', 'reschedule updates existing event');

  const cancelled = await processor.process({ rawIcs: FIXTURE_3_CANCEL }, existing);
  assert(cancelled.action === 'AUTO_CANCEL' && cancelled.event.id === 'event-1', 'cancellation updates existing event');
}

async function testScheduleConfiguration() {
  assert(gmailScheduled.handler === gmailProcess.handler, 'scheduled function reuses Gmail process handler');
  const config = fs.readFileSync('netlify.toml', 'utf8');
  assert(config.includes('schedule = "*/5 * * * *"'), 'scheduled processing is configured every five minutes');
}

async function run() {
  await testCandidateDetection();
  await testResultLabelRouting();
  await testPersistenceOrderingAndFailure();
  await testPipelineLifecycleAndIdempotency();
  await testScheduleConfiguration();
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exit(1);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
