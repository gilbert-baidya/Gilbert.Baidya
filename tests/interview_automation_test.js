const assert = require('assert');
const ServerStore = require('../services/firebase/serverStore');

async function run() {
  let exists = false;
  let writes = 0;
  let writtenTask = null;
  let taskId = null;

  const store = Object.create(ServerStore.prototype);
  store.clean = value => JSON.parse(JSON.stringify(value));
  store.userRef = {
    collection(name) {
      assert.strictEqual(name, 'tasks');
      return {
        doc(id) {
          taskId = id;
          return {
            async get() { return { exists }; },
            async set(payload) {
              writes++;
              exists = true;
              writtenTask = payload;
            }
          };
        }
      };
    }
  };

  const event = {
    company: 'KANINI',
    position: 'Automation QA',
    interviewStage: 'Technical Discussion',
    start: '2026-08-26T17:00:00.000Z',
    timezone: 'America/Los_Angeles',
    icalUid: 'kanini-interview@example.com'
  };

  await store.ensureInterviewPreparationTask('kanini-event', event);
  await store.ensureInterviewPreparationTask('kanini-event', event);

  assert.strictEqual(taskId, 'interview-prep-kanini-event');
  assert.strictEqual(writes, 1);
  assert.strictEqual(writtenTask.sourceEventId, 'kanini-event');
  assert.strictEqual(writtenTask.sourceIcalUid, 'kanini-interview@example.com');
  assert.strictEqual(writtenTask.title, 'Prepare: KANINI — Technical Discussion');
  assert.strictEqual(writtenTask.description, 'Role: Automation QA');
  assert.strictEqual(writtenTask.dueAt, '2026-08-26T16:30:00.000Z');
  assert.strictEqual(writtenTask.dueTime, '09:30');
  assert.strictEqual(writtenTask.interviewStart, event.start);
  console.log('PASS: repeated interview processing creates exactly one preparation task');
}

run().catch(error => {
  console.error(`FAIL: interview preparation task idempotency (${error.message})`);
  process.exit(1);
});