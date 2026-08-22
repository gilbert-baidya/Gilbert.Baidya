const GmailClient = require('../services/gmail/gmailClient');
const { processLabeledMessages } = require('../netlify/functions/gmail-process');

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

function response(data) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

async function testClientUsesExactLabelId() {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    if (String(url).endsWith('/labels')) {
      return response({ labels: [{ id: 'Label_intake', name: 'Command Center Intake' }] });
    }
    return response({ messages: [{ id: 'altium' }] });
  };

  try {
    const client = new GmailClient({ GMAIL_REFRESH_TOKEN: 'test' });
    client.getAccessToken = async () => 'test-access-token';
    const result = await client.listIntakeMessages(10);
    const listUrl = urls.find(url => url.includes('/messages?'));
    assert(result.messages.length === 1, 'one labeled message is returned');
    assert(listUrl.includes('labelIds=Label_intake'), 'messages.list uses resolved label ID');
    assert(!listUrl.includes('q='), 'no textual or recent-message fallback query is used');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testEmptyLabel() {
  const client = { listIntakeMessages: async () => ({ labelId: 'Label_intake', messages: [] }) };
  let processed = 0;
  const processor = { process: async () => { processed++; } };
  const result = await processLabeledMessages(client, processor);
  assert(result.results.length === 0 && processed === 0, 'empty label processes zero messages');
}

async function testRemovedLabelIsIgnored() {
  const client = {
    listIntakeMessages: async () => ({ labelId: 'Label_intake', messages: [{ id: 'removed' }] }),
    getMessage: async () => ({ id: 'removed', labelIds: ['INBOX'] })
  };
  let processed = 0;
  const processor = { process: async () => { processed++; } };
  const result = await processLabeledMessages(client, processor);
  assert(result.results.length === 0 && processed === 0, 'message whose label was removed is ignored');
}

async function testOnlyCurrentlyLabeledMessagesProcess() {
  const client = {
    listIntakeMessages: async () => ({
      labelId: 'Label_intake',
      messages: [{ id: 'altium' }, { id: 'second' }, { id: 'nvidia' }]
    }),
    getMessage: async id => ({
      id,
      labelIds: id === 'nvidia' ? ['INBOX', 'UNREAD'] : ['Label_intake']
    })
  };
  const processedIds = [];
  const processor = {
    process: async ({ gmailMessage }) => {
      processedIds.push(gmailMessage.id);
      return { action: 'AUTO_ADD' };
    }
  };
  const result = await processLabeledMessages(client, processor);
  assert(result.results.length === 2, 'multiple labeled messages are processed');
  assert(!processedIds.includes('nvidia'), 'unlabeled recent message is ignored');
  assert(processedIds.join(',') === 'altium,second', 'only currently labeled message IDs are processed');
}

async function run() {
  await testClientUsesExactLabelId();
  await testEmptyLabel();
  await testRemovedLabelIsIgnored();
  await testOnlyCurrentlyLabeledMessagesProcess();
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed) process.exit(1);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});