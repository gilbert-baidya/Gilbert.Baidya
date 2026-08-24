// ==========================================================================
// GILBERT COMMAND CENTER — CORE APPLICATION ARCHITECTURE
// Production MVP with Firestore CRUD, Conflict Detection, ICS Parser,
// AI Layer Abstraction, Modal Engine & Deterministic Priority Scoring
// ==========================================================================

const EXPECTED_PROJECT_ID = 'gilbert-command-center-ff543';
const ALLOWED_EMAILS = ['gilbert.cgpt@gmail.com'];
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

let firebaseApp = null;
let db = null;
let auth = null;
let currentUser = null;
let calendar = null;
let currentTaskFilter = 'ALL';
let currentDashboardEvents = [];
let currentDashboardInterviews = [];
let interviewCountdownTimer = null;

// ==========================================================================
// UTILITY SERVICES: Date, Conflict Detection, Priorities, Duplicate Engine
// ==========================================================================

const DateUtils = {
  formatDatePacific(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return isoString;
    }
  },

  formatTimePacific(isoString, includeTimeZone = false) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(includeTimeZone ? { timeZoneName: 'short' } : {})
      });
    } catch (e) {
      return isoString;
    }
  },

  formatDateTimeRange(startIso, endIso) {
    if (!startIso) return '—';
    const dateStr = this.formatDatePacific(startIso);
    const startStr = this.formatTimePacific(startIso);
    const endStr = endIso ? this.formatTimePacific(endIso, true) : '';
    return endStr ? `${dateStr} · ${startStr} – ${endStr}` : `${dateStr} · ${this.formatTimePacific(startIso, true)}`;
  },

  combineDateAndTimeToISO(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return InterviewTimeEngine.zonedDateTimeToIso({ year, month, day, hour: hours, minute: minutes, second: 0 }, DEFAULT_TIMEZONE);
  },

  splitISOToDateAndTime(isoString) {
    if (!isoString) return { date: '', time: '' };
    return InterviewTimeEngine.formatLocalDateTime(isoString, DEFAULT_TIMEZONE);
  }
};

const ConflictService = {
  detectConflicts(events) {
    const activeEvents = (events || []).filter(e => e.status !== 'CANCELLED' && e.start && e.end);
    const conflicts = [];

    for (let i = 0; i < activeEvents.length; i++) {
      for (let j = i + 1; j < activeEvents.length; j++) {
        const a = activeEvents[i];
        const b = activeEvents[j];
        const aS = new Date(a.start).getTime();
        const aE = new Date(a.end).getTime();
        const bS = new Date(b.start).getTime();
        const bE = new Date(b.end).getTime();

        // Check strict overlap (not just touching at boundary)
        if (Math.max(aS, bS) < Math.min(aE, bE)) {
          const overlapMs = Math.min(aE, bE) - Math.max(aS, bS);
          const minutes = Math.round(overlapMs / 60000);
          conflicts.push({
            eventA: a,
            eventB: b,
            overlapMinutes: minutes
          });
        }
      }
    }
    return conflicts;
  }
};

const PriorityService = {
  calculateScore(item, type) {
    let score = 0;
    const now = new Date().getTime();

    if (type === 'TASK') {
      if (item.priority === 'URGENT') score += 80;
      else if (item.priority === 'HIGH') score += 50;
      else if (item.priority === 'MEDIUM') score += 30;
      else score += 10;

      if (item.dueDate) {
        const due = new Date(item.dueDate + (item.dueTime ? `T${item.dueTime}` : 'T23:59:59')).getTime();
        if (due < now) {
          score += 100; // Overdue task
        } else if (due - now <= 24 * 3600 * 1000) {
          score += 70; // Task due today
        }
      }
    } else if (type === 'INTERVIEW' || type === 'EVENT') {
      const eventTime = new Date(item.start || item.interviewDate).getTime();
      const diffHours = (eventTime - now) / (3600 * 1000);

      if (diffHours >= 0 && diffHours <= 24) {
        score += 90; // Interview/Event within 24 hours
      } else if (diffHours > 24 && diffHours <= 72) {
        score += 60; // Interview/Event within 72 hours
      }

      if (item.priority === 'URGENT') score += 80;
      else if (item.priority === 'HIGH') score += 50;
    }
    return score;
  },

  getTopPriorities(tasks, events, interviews) {
    const items = [];

    (tasks || []).filter(t => t.status !== 'DONE').forEach(t => {
      items.push({
        id: t.id,
        title: t.title,
        type: 'Task',
        priority: t.priority || 'NORMAL',
        score: this.calculateScore(t, 'TASK'),
        sub: t.dueDate ? `Due: ${t.dueDate}` : 'No due date'
      });
    });

    (interviews || []).filter(i => i.stage !== 'REJECTED' && i.stage !== 'WITHDRAWN' && i.stage !== 'OFFER').forEach(i => {
      items.push({
        id: i.id,
        title: `${i.company} — ${i.position || 'Interview'}`,
        type: 'Interview',
        priority: 'HIGH',
        score: this.calculateScore(i, 'INTERVIEW'),
        sub: i.interviewDate ? `Date: ${DateUtils.formatDatePacific(i.interviewDate)}` : 'Stage: ' + i.stage
      });
    });

    return items.sort((a, b) => b.score - a.score).slice(0, 5);
  }
};

const DuplicateService = {
  findDuplicate(candidate, existingEvents) {
    if (!existingEvents || existingEvents.length === 0) return null;

    // 1. iCalendar UID match
    if (candidate.iCalUid) {
      const match = existingEvents.find(e => e.iCalUid === candidate.iCalUid);
      if (match) return { match, reason: 'iCal UID Match' };
    }

    // 2. Gmail Message ID match
    if (candidate.gmailMessageId) {
      const match = existingEvents.find(e => e.gmailMessageId === candidate.gmailMessageId);
      if (match) return { match, reason: 'Gmail Message ID Match' };
    }

    // 3. Fallback: Normalized Title + Normalized Start Time
    if (candidate.title && candidate.start) {
      const normTitle = candidate.title.trim().toLowerCase();
      const candStart = new Date(candidate.start).getTime();
      const match = existingEvents.find(e => {
        if (!e.title || !e.start) return false;
        const eTitle = e.title.trim().toLowerCase();
        const eStart = new Date(e.start).getTime();
        return normTitle === eTitle && Math.abs(candStart - eStart) < 60000; // within 1 minute
      });
      if (match) return { match, reason: 'Title and Time Match' };
    }

    return null;
  }
};

// ==========================================================================
// ICS PARSER SERVICE
// ==========================================================================

const ICSParser = {
  parse(icsText) {
    if (!icsText || typeof icsText !== 'string') return null;

    const parseLine = (tag) => {
      const regex = new RegExp(`^${tag}(?:;[^:]*)?:(.*)$`, 'm');
      const match = icsText.match(regex);
      return match ? match[1].trim() : null;
    };

    const parseDate = (val) => {
      if (!val) return null;
      // Formats: 20260825T170000Z or 20260825T100000
      const clean = val.replace(/[^0-9T]/g, '');
      const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/);
      if (match) {
        const [_, y, m, d, h, min, s] = match;
        const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s || 0)));
        return date.toISOString();
      }
      return null;
    };

    const uid = parseLine('UID') || `ics-${Date.now()}`;
    const summary = parseLine('SUMMARY') || 'Imported Calendar Event';
    const description = parseLine('DESCRIPTION') || '';
    const location = parseLine('LOCATION') || '';
    const dtstart = parseDate(parseLine('DTSTART'));
    const dtend = parseDate(parseLine('DTEND'));

    // Extract meeting URL if present in location or description
    const urlMatch = (location + ' ' + description).match(/https?:\/\/[^\s]+/);
    const meetingUrl = urlMatch ? urlMatch[0] : '';
    const classification = InterviewClassifier.classifyInterviewIntent({
      title: summary,
      description,
      location,
      meetingUrl
    });

    return {
      iCalUid: uid,
      title: summary.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n'),
      start: dtstart || new Date().toISOString(),
      end: dtend || new Date(Date.now() + 3600000).toISOString(),
      location: location.replace(/\\,/g, ','),
      meetingUrl: meetingUrl,
      notes: description.replace(/\\n/g, '\n'),
      category: classification.category,
      isInterview: classification.isInterview,
      classification,
      interviewStage: classification.stage,
      status: 'CONFIRMED'
    };
  }
};

// ==========================================================================
// AI ABSTRACTION LAYER (Ollama & Fallback)
// ==========================================================================

const AIService = {
  provider: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3:latest',

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch (e) {
      return false;
    }
  },

  async parseMeetingEmail(emailText) {
    if (!emailText) return null;
    // Fallback structured parser if Ollama is unavailable
    const isOnline = await this.checkHealth();
    if (!isOnline) {
      // Deterministic rule-based extraction
      const lines = emailText.split('\n');
      const title = lines[0] || 'Meeting Request';
      const urlMatch = emailText.match(/https?:\/\/[^\s]+/);
      const classification = InterviewClassifier.classifyInterviewIntent({ title, description: emailText });
      return {
        title: title.slice(0, 80),
        company: classification.company,
        position: classification.position,
        date: new Date().toISOString().split('T')[0],
        startTime: '10:00',
        endTime: '11:00',
        timezone: DEFAULT_TIMEZONE,
        meetingUrl: urlMatch ? urlMatch[0] : '',
        category: classification.category,
        isInterview: classification.isInterview,
        classification,
        interviewStage: classification.stage,
        priority: 'NORMAL',
        confidence: 0.85,
        notes: emailText
      };
    }

    try {
      const prompt = `Extract meeting details as JSON with schema: {"title":"","company":"","position":"","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","timezone":"","meetingUrl":"","category":"INTERVIEW|RECRUITER|JOB_1|JOB_2|JOB_3|CHURCH|PERSONAL|FOCUS|OTHER","priority":"NORMAL|HIGH|URGENT","confidence":1.0,"notes":""} from:\n${emailText}`;
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, format: 'json', stream: false })
      });
      const data = await res.json();
      return JSON.parse(data.response);
    } catch (e) {
      console.warn('AI Parsing failed, falling back to deterministic extraction', e);
      return null;
    }
  }
};

// ==========================================================================
// TOAST NOTIFICATIONS & UI MODAL CONTROLLER
// ==========================================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

const ModalManager = {
  _previousFocus: null,

  open(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    this._previousFocus = document.activeElement;
    el.classList.add('active');
    const focusable = el.querySelector('button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  },

  close(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
    if (this._previousFocus?.focus) this._previousFocus.focus();
    this._previousFocus = null;
  },

  confirm(message, onConfirm, title = 'Confirm Action') {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').innerText = title;
    document.getElementById('confirmModalMessage').innerText = message;
    
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const cancelBtn = document.getElementById('confirmModalCancelBtn');

    const handleConfirm = () => {
      cleanup();
      ModalManager.close('confirmModal');
      onConfirm();
    };

    const handleCancel = () => {
      cleanup();
      ModalManager.close('confirmModal');
    };

    const cleanup = () => {
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    ModalManager.open('confirmModal');
  }
};

// Setup Modal Close Handlers & Esc Key
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      ModalManager.close(modalId);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(modal => ModalManager.close(modal.id));
    }
    if (e.key === 'Tab') {
      const modal = document.querySelector('.modal-overlay.active');
      if (!modal) return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Category change listener for dynamic interview fields
  document.getElementById('eventCategory')?.addEventListener('change', (e) => {
    const interviewFields = document.getElementById('interviewSpecificFields');
    if (interviewFields) {
      interviewFields.style.display = e.target.value === 'INTERVIEW' ? 'block' : 'none';
    }
  });
});

// ==========================================================================
// FIREBASE INITIALIZATION & AUTH GUARD
// ==========================================================================

async function loadConfig() {
  try {
    const res = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Missing /firebase-config.json');
    const cfg = await res.json();
    if (cfg.projectId && cfg.projectId !== EXPECTED_PROJECT_ID) {
      console.warn(`[Firebase Mismatch] Expected project "${EXPECTED_PROJECT_ID}", got "${cfg.projectId}".`);
    }
    return cfg;
  } catch (e) {
    document.querySelector('#todayScheduleContainer').innerHTML = 
      `<div class="empty-state"><div class="empty-state-text">Missing /firebase-config.json. Please configure Firebase.</div></div>`;
    throw e;
  }
}

async function init() {
  const cfg = await loadConfig();
  if (!firebase.apps.length) {
    firebaseApp = firebase.initializeApp(cfg);
  } else {
    firebaseApp = firebase.app();
  }
  auth = firebase.auth();
  db = firebase.firestore();

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.replace('/login.html');
      return;
    }
    if (!ALLOWED_EMAILS.includes(user.email)) {
      alert(`Access denied for ${user.email}.`);
      await auth.signOut();
      window.location.replace('/login.html');
      return;
    }
    currentUser = user;
    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) userEmailEl.innerText = user.email;

    setupNavigation();
    setupEventListeners();
    await startApp();
  });
}

function signOutUser() {
  auth.signOut().then(() => {
    window.location.replace('/login.html');
  });
}

// ==========================================================================
// NAVIGATION & MODULE ROUTING
// ==========================================================================

function setupNavigation() {
  const navItems = document.querySelectorAll('.gcc-nav-item');
  const sections = document.querySelectorAll('.gcc-section');
  const titleMap = {
    today: "Today's Overview",
    calendar: "Interactive Calendar",
    interviews: "Interview Pipeline",
    jobs: "Job Opportunities",
    tasks: "Tasks Management",
    'email-intake': "Email & Calendar Intake",
    settings: "System & Account Settings"
  };

  function switchTab(tabId) {
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === tabId) item.classList.add('active');
      else item.classList.remove('active');
    });

    sections.forEach(sec => {
      if (sec.id === `section-${tabId}`) sec.classList.add('active');
      else sec.classList.remove('active');
    });

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle && titleMap[tabId]) pageTitle.innerText = titleMap[tabId];

    if (tabId === 'calendar' && calendar) {
      setTimeout(() => calendar.render(), 50);
    }
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      window.location.hash = tab;
      switchTab(tab);

      // Close mobile sidebar if open
      document.getElementById('sidebar')?.classList.remove('open');
    });
  });

  // Hash route listener
  const initialHash = window.location.hash.replace('#', '') || 'today';
  if (titleMap[initialHash]) switchTab(initialHash);

  // Mobile menu toggle
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });
  document.getElementById('sidebarBackdrop')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
  });
  document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
}

// ==========================================================================
// APP START & ORCHESTRATION
// ==========================================================================

async function startApp() {
  await setupCalendar();
  await NotificationService.loadSettings();
  await refreshDashboard();
  checkOllamaStatus();
  checkCalendarSyncStatus();
  NotificationService.scheduleUpcomingAlerts();
  loadNotificationSettings();
  renderFollowUps();
}

async function refreshDashboard() {
  let [events, tasks, interviews, jobs, intakeItems] = await Promise.all([
    fetchCollection('events'),
    fetchCollection('tasks'),
    fetchCollection('interviews'),
    fetchCollection('jobs'),
    fetchCollection('emailIntake')
  ]);

  const reclassification = await reclassifyInterviewEvents(events, tasks);
  events = reclassification.events;
  tasks = reclassification.tasks;
  const allInterviews = mergeInterviewRecords(interviews, events);
  currentDashboardEvents = events;
  currentDashboardInterviews = allInterviews;

  renderTodaySchedule(events);
  renderPriorities(tasks, events, allInterviews);
  renderUpcomingInterviews(allInterviews);
  renderConflicts(events);
  renderTasks(tasks);
  renderInterviews(allInterviews, events);
  renderJobs(jobs);
  renderEmailIntake(intakeItems);

  if (calendar) calendar.refetchEvents();
  ensureInterviewCalendarReminders(events);

  // Reschedule notification alerts with refreshed event data
  if (typeof NotificationService !== 'undefined') NotificationService.rescheduleOnRefresh();
}

function eventAsInterview(event) {
  return {
    ...event,
    sourceType: 'EVENT',
    interviewDate: event.start,
    stage: event.interviewStage || event.classification?.stage || 'Interview',
    interviewType: event.interviewType || (/teams\.microsoft\.com/i.test(event.meetingUrl || '') ? 'Microsoft Teams' : 'Virtual Meeting'),
    recruiter: event.recruiter || event.organizer || '',
    position: event.position || 'Role not specified'
  };
}

function mergeInterviewRecords(interviews, events) {
  const eventInterviews = (events || [])
    .filter(event => event.isInterview === true || event.category === 'INTERVIEW')
    .map(eventAsInterview);
  const manualInterviews = (interviews || []).filter(item => !eventInterviews.some(event => {
    if (item.sourceEventId && item.sourceEventId === event.id) return true;
    if (item.icalUid && item.icalUid === event.icalUid) return true;
    const sameStart = item.interviewDate && new Date(item.interviewDate).getTime() === new Date(event.interviewDate).getTime();
    const sameCompany = String(item.company || '').toLowerCase() === String(event.company || '').toLowerCase();
    return sameStart && sameCompany;
  }));
  return [...eventInterviews, ...manualInterviews.map(item => ({ ...item, sourceType: 'INTERVIEW_RECORD' }))];
}

async function reclassifyInterviewEvents(events, tasks) {
  if (!currentUser || typeof InterviewClassifier === 'undefined') return { events, tasks };

  const updatedEvents = [...(events || [])];
  const updatedTasks = [...(tasks || [])];
  const writes = [];

  for (let index = 0; index < updatedEvents.length; index++) {
    const event = updatedEvents[index];
    const classification = InterviewClassifier.classifyInterviewIntent(event);
    if (!classification.isInterview) continue;

    const patch = {
      category: 'INTERVIEW',
      isInterview: true,
      interviewStage: classification.stage,
      sourceTimezone: event.sourceTimezone || event.timezone || null,
      displayTimezone: DEFAULT_TIMEZONE,
      classification: {
        type: 'interview',
        confidence: classification.confidence,
        stage: classification.stage,
        reasons: classification.reasons
      }
    };
    if (!event.company && classification.company) patch.company = classification.company;
    if (!event.position && classification.position) patch.position = classification.position;

    const changed = event.category !== patch.category ||
      event.isInterview !== true ||
      event.interviewStage !== patch.interviewStage ||
      event.sourceTimezone !== patch.sourceTimezone ||
      event.displayTimezone !== patch.displayTimezone ||
      JSON.stringify(event.classification || {}) !== JSON.stringify(patch.classification) ||
      Boolean(patch.company) || Boolean(patch.position);

    updatedEvents[index] = { ...event, ...patch };
    if (changed) {
      writes.push(db.collection('users').doc(currentUser.uid).collection('events').doc(event.id).set({
        ...patch,
        classificationUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }));
    }

    if (event.status !== 'CANCELLED') {
      const taskId = `interview-prep-${event.id}`;
      const existingTask = updatedTasks.find(task => task.id === taskId || task.sourceEventId === event.id);
      const interview = updatedEvents[index];
      const preparation = InterviewTimeEngine.calculatePreparationWindow(interview, getInterviewPreparationMinutes());
      const due = preparation?.start || null;
      const dueAt = due && !isNaN(due.getTime()) ? due.toISOString() : null;
      const localDue = InterviewTimeEngine.formatLocalDateTime(due, DEFAULT_TIMEZONE);
      const hasTask = Boolean(existingTask);
      if (!hasTask) {
        const task = {
          id: taskId,
          title: `Prepare: ${interview.company || 'Interview'} — ${interview.interviewStage || 'Interview'}`,
          description: interview.position ? `Role: ${interview.position}` : 'Review the role and prepare interview notes.',
          dueDate: localDue.date,
          dueTime: localDue.time,
          dueAt: due && !isNaN(due.getTime()) ? due.toISOString() : null,
          interviewStart: interview.start || null,
          interviewPreparationMinutes: preparation?.minutes || 30,
          priority: 'HIGH',
          status: 'TODO',
          generatedBy: 'INTERVIEW_CLASSIFICATION',
          sourceEventId: event.id,
          sourceIcalUid: event.icalUid || null
        };
        updatedTasks.push(task);
        writes.push(db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId).set({
          ...task,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
      } else if (existingTask.generatedBy === 'INTERVIEW_CLASSIFICATION' && (
        existingTask.dueAt !== dueAt || existingTask.dueDate !== localDue.date || existingTask.dueTime !== localDue.time
      )) {
        const taskPatch = {
          dueDate: localDue.date,
          dueTime: localDue.time,
          dueAt,
          interviewStart: interview.start || null,
          interviewPreparationMinutes: preparation?.minutes || 30
        };
        Object.assign(existingTask, taskPatch);
        writes.push(db.collection('users').doc(currentUser.uid).collection('tasks').doc(existingTask.id || taskId).set({
          ...taskPatch,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }));
      }
    }
  }

  if (writes.length) await Promise.all(writes);
  return { events: updatedEvents, tasks: updatedTasks };
}

async function fetchCollection(collectionName) {
  if (!currentUser) return [];
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection(collectionName).get();
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  } catch (err) {
    console.error(`Error fetching collection ${collectionName}:`, err);
    return [];
  }
}

// ==========================================================================
// CALENDAR SETUP & FULLCALENDAR BINDINGS
// ==========================================================================

let lastCalendarEventClickTimestamp = 0;

function logCalendarRouting(message, value) {
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  if (arguments.length > 1) console.log(message, value);
  else console.log(message);
}

async function setupCalendar() {
  const el = document.getElementById('calendarEl');
  if (!el) return;

  calendar = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    editable: false,
    selectable: true,
    dayMaxEvents: true,
    timeZone: DEFAULT_TIMEZONE,
    events: async (info, successCallback, failCallback) => {
      try {
        const events = await fetchCollection('events');
        const formatted = events.map(e => {
          const firestoreId = EventViewModel.getCanonicalEventId(e) || e.id || '';
          let color = '#2563eb';
          if (e.category === 'INTERVIEW' || e.isInterview) color = '#8b5cf6';
          else if (e.category === 'PERSONAL') color = '#10b981';
          else if (e.category === 'CHURCH') color = '#ec4899';
          else if (e.category === 'FOCUS') color = '#f59e0b';
          if (e.status === 'CANCELLED') color = '#4b5563';
          const sourceIndicator = e.source === 'EMAIL_INTAKE'
            ? '📧'
            : e.source === 'CALENDAR_SYNC'
              ? '🔄'
              : '✍';

          return {
            id: firestoreId,
            title: EventViewModel.getCalendarTitle(e),
            start: EventViewModel.getStart(e),
            end: EventViewModel.getEnd(e),
            backgroundColor: color,
            borderColor: color,
            extendedProps: {
              ...e,
              firestoreId: firestoreId,
              id: firestoreId,
              sourceIndicator
            }
          };
        });
        successCallback(formatted);
      } catch (err) {
        failCallback(err);
      }
    },
    dateClick: (info) => {
      // 1. If an event was clicked within the last 500ms, ignore dateClick completely
      if (Date.now() - lastCalendarEventClickTimestamp < 500) {
        return;
      }
      // 2. If the click target originated inside any calendar event element, ignore dateClick
      if (info.jsEvent && info.jsEvent.target) {
        const isInsideEvent = info.jsEvent.target.closest('.fc-event, .fc-daygrid-event, .fc-timegrid-event');
        if (isInsideEvent) {
          return;
        }
      }
      logCalendarRouting('[FC] DATE CLICK');
      openCreateEventModal(info.dateStr);
    },
    select: (info) => {
      // Drag selection is intentionally not a create route. Creation is limited
      // to a single empty-date click or the Manual Event button.
      logCalendarRouting('[FC] SELECT');
      calendar?.unselect();
    },
    eventClick: async (info) => {
      lastCalendarEventClickTimestamp = Date.now();
      if (info.jsEvent) {
        info.jsEvent.preventDefault();
        info.jsEvent.stopPropagation();
        info.jsEvent.stopImmediatePropagation?.();
      }
      const interaction = EventViewModel.getCalendarEventInteraction(info.event);
      logCalendarRouting('[FC] EVENT CLICK');
      logCalendarRouting('[FC] EVENT ID:', info.event.id || '');
      logCalendarRouting('[FC] EVENT TITLE:', info.event.title || '');
      logCalendarRouting('[FC] FIRESTORE ID:', info.event.extendedProps?.firestoreId || '');
      if (interaction.mode === 'DETAILS' && interaction.eventId) {
        await openEventDetailsModalById(interaction.eventId);
      } else {
        console.error('[FullCalendar eventClick] Could not resolve canonical event ID:', info.event);
        showToast('Could not load this existing event.', 'error');
      }
    },
    eventDidMount: (info) => {
      const event = { id: info.event.id, ...info.event.extendedProps };
      const dateTime = InterviewTimeEngine.formatInterviewDateTime(event, DEFAULT_TIMEZONE);
      const provider = EventViewModel.getMeetingProvider(event);
      info.el.title = [event.company || event.title, event.position, dateTime?.label, provider].filter(Boolean).join('\n');
    }
  });

  calendar.render();
}

// ==========================================================================
// TODAY & DASHBOARD VIEWS RENDERING
// ==========================================================================

function renderTodaySchedule(events) {
  const container = document.getElementById('todayScheduleContainer');
  if (!container) return;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE }); // YYYY-MM-DD
  const todayEvents = (events || []).filter(e => {
    if (!e.start || e.status === 'CANCELLED') return false;
    const eventDate = new Date(e.start).toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
    return eventDate === todayStr;
  }).sort((a, b) => new Date(a.start) - new Date(b.start));

  const todayInterview = todayEvents.find(event => event.isInterview || event.category === 'INTERVIEW');
  const interviewSummary = todayInterview ? buildTodayInterviewSummary(eventAsInterview(todayInterview), events) : '';

  if (todayEvents.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">No events scheduled today. Enjoy your day or schedule focus time!</div></div>`;
    return;
  }

  container.innerHTML = `
    ${interviewSummary}
    <div class="item-list">
      ${todayEvents.map(e => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${escapeHtml(e.title)}</div>
            <div class="list-item-sub">
              <span>🕒 ${DateUtils.formatTimePacific(e.start)} – ${DateUtils.formatTimePacific(e.end, true)}</span>
              ${e.company ? `<span>🏢 ${escapeHtml(e.company)}</span>` : ''}
              ${e.meetingUrl ? `<span>🔗 <a href="${escapeHtml(e.meetingUrl)}" target="_blank" style="color:var(--primary);">Join Meeting</a></span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-${(e.category || 'other').toLowerCase()}">${e.category || 'OTHER'}</span>
            <button class="btn btn-secondary btn-sm" onclick='openEventDetailsModalById("${e.id}")'>Details</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPriorities(tasks, events, interviews) {
  const container = document.getElementById('topPrioritiesContainer');
  if (!container) return;

  const topItems = PriorityService.getTopPriorities(tasks, events, interviews);
  if (topItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">No urgent priorities right now. All caught up!</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${topItems.map(item => `
        <div class="list-item" style="padding: 0.5rem 0.75rem;">
          <div class="list-item-main">
            <div class="list-item-title" style="font-size: 0.85rem;">${escapeHtml(item.title)}</div>
            <div class="list-item-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="badge badge-${item.priority.toLowerCase()}">${item.priority}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderUpcomingInterviews(interviews) {
  const container = document.getElementById('upcomingInterviewsContainer');
  if (!container) return;

  const upcoming = InterviewTimeEngine.sortInterviews((interviews || []).filter(i => {
    if (!i.interviewDate) return false;
    const end = i.end ? new Date(i.end) : new Date(new Date(i.interviewDate).getTime() + 30 * 60000);
    return end >= new Date();
  })).slice(0, 5);

  if (upcoming.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">No upcoming interviews scheduled.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${upcoming.map(i => `
        <div class="list-item" style="padding: 0.5rem 0.75rem;">
          <div class="list-item-main">
            <div class="list-item-title" style="font-size: 0.85rem;">${escapeHtml(i.company)}</div>
            <div class="list-item-sub">${escapeHtml(i.position || 'Interview')} · ${DateUtils.formatDatePacific(i.interviewDate)} · <strong class="interview-countdown" data-interview-start="${escapeHtml(i.interviewDate)}" data-interview-end="${escapeHtml(i.end || '')}">${InterviewTimeEngine.calculateInterviewCountdown(i).label}</strong></div>
          </div>
          <span class="badge badge-interview">${i.stage || 'TECHNICAL'}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderConflicts(events) {
  const container = document.getElementById('conflictsContainer');
  if (!container) return;

  const conflicts = ConflictService.detectConflicts(events);
  if (conflicts.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">No schedule conflicts detected.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${conflicts.map(c => `
        <div class="list-item" style="border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.05); padding: 0.5rem 0.75rem;">
          <div class="list-item-main">
            <div class="list-item-title" style="color: #f87171; font-size: 0.85rem;">⚠️ Conflict: ${escapeHtml(c.eventA.title)} ↔ ${escapeHtml(c.eventB.title)}</div>
            <div class="list-item-sub">${c.overlapMinutes}-minute overlap detected</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ==========================================================================
// TASKS MODULE CRUD
// ==========================================================================

function renderTasks(tasks) {
  const container = document.getElementById('tasksListContainer');
  if (!container) return;

  let filtered = tasks || [];
  if (currentTaskFilter === 'PENDING') filtered = filtered.filter(t => t.status !== 'DONE');
  else if (currentTaskFilter === 'DONE') filtered = filtered.filter(t => t.status === 'DONE');

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No tasks found matching filter.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${filtered.map(t => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title" style="${t.status === 'DONE' ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(t.title)}</div>
            <div class="list-item-sub">
              ${t.dueAt ? `<span>Due: ${DateUtils.formatDatePacific(t.dueAt)} ${DateUtils.formatTimePacific(t.dueAt, true)}</span>` : t.dueDate ? `<span>Due: ${t.dueDate} ${t.dueTime || ''}</span>` : ''}
              ${t.description ? `<span>📝 ${escapeHtml(t.description.slice(0, 60))}</span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-${(t.priority || 'normal').toLowerCase()}">${t.priority || 'NORMAL'}</span>
            <span class="badge badge-${(t.status || 'todo').toLowerCase()}">${t.status || 'TODO'}</span>
            ${t.status !== 'DONE' 
              ? `<button class="btn btn-secondary btn-sm" onclick='toggleTaskStatus("${t.id}", "DONE")'>✓ Complete</button>`
              : `<button class="btn btn-secondary btn-sm" onclick='toggleTaskStatus("${t.id}", "TODO")'>Reopen</button>`
            }
            <button class="btn btn-secondary btn-sm" onclick='editTaskModal("${t.id}")'>Edit</button>
            <button class="btn btn-danger btn-sm" onclick='deleteTaskConfirm("${t.id}")'>Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function toggleTaskStatus(taskId, newStatus) {
  try {
    await db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast(`Task marked as ${newStatus === 'DONE' ? 'Completed' : 'To Do'}`);
    await refreshDashboard();
  } catch (e) {
    showToast('Failed to update task: ' + e.message, 'error');
  }
}

function deleteTaskConfirm(taskId) {
  ModalManager.confirm('Are you sure you want to permanently delete this task?', async () => {
    try {
      await db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId).delete();
      showToast('Task deleted successfully');
      await refreshDashboard();
    } catch (e) {
      showToast('Failed to delete task: ' + e.message, 'error');
    }
  }, 'Delete Task');
}

// ==========================================================================
// INTERVIEWS MODULE CRUD
// ==========================================================================

function getInterviewPreparationMinutes() {
  return Number(NotificationService?._settings?.interviewPreparationMinutes) || InterviewTimeEngine.DEFAULT_PREPARATION_MINUTES;
}

function getInterviewPhoneAlertStatus(interview) {
  const configured = interview.reminderMinutes || [];
  const hasPreparationAlert = configured.map(Number).includes(30);
  if (interview.calendarSyncStatus === 'SYNCED' && hasPreparationAlert) return { active: true, label: 'Phone alerts active' };
  return { active: false, label: 'Phone alerts need setup' };
}

function buildConflictStatus(interview, events) {
  const result = InterviewTimeEngine.detectInterviewConflict(interview, events, getInterviewPreparationMinutes());
  if (result.level === 'INTERVIEW') {
    return `<div class="interview-conflict interview-conflict-critical"><strong>TIME CONFLICT</strong><span>Another event overlaps this interview.</span><button class="btn btn-secondary btn-sm" onclick="openInterviewConflictModal('${interview.id}')">View Conflict</button></div>`;
  }
  if (result.level === 'PREPARATION') {
    const message = result.availablePreparationMinutes === 0
      ? 'The protected preparation window is unavailable.'
      : `Only ${result.availablePreparationMinutes} minutes available to prepare.`;
    return `<div class="interview-conflict interview-conflict-warning"><strong>PREP TIME CONFLICT</strong><span>${message}</span><button class="btn btn-secondary btn-sm" onclick="openInterviewConflictModal('${interview.id}')">View Conflict</button></div>`;
  }
  if (result.boundaryEvents?.length) {
    return `<div class="interview-prep-status">Preparation window begins immediately after previous interview.</div>`;
  }
  return `<div class="interview-prep-status">Full ${result.availablePreparationMinutes}-minute preparation window available</div>`;
}

function buildTodayInterviewSummary(interview, events) {
  const preparation = InterviewTimeEngine.calculatePreparationWindow(interview, getInterviewPreparationMinutes());
  const conflict = InterviewTimeEngine.detectInterviewConflict(interview, events, getInterviewPreparationMinutes());
  const conflictText = conflict.level === 'INTERVIEW'
    ? 'Time conflict detected'
    : conflict.level === 'PREPARATION'
      ? `Only ${conflict.availablePreparationMinutes} minutes prep time available`
      : '';
  return `<div class="today-interview-summary">
    <div><span class="interview-eyebrow">NEXT INTERVIEW</span><strong>${escapeHtml(interview.company || 'Interview')} — ${escapeHtml(interview.stage || 'Interview')}</strong></div>
    <div class="today-interview-time">${DateUtils.formatTimePacific(interview.interviewDate, true)} <span class="interview-countdown" data-interview-start="${escapeHtml(interview.interviewDate)}" data-interview-end="${escapeHtml(interview.end || '')}">${InterviewTimeEngine.calculateInterviewCountdown(interview).label}</span></div>
    <div>Prep starts: ${DateUtils.formatTimePacific(preparation?.start?.toISOString(), true)}${conflictText ? ` · <span class="today-conflict">${conflictText}</span>` : ''}</div>
    ${interview.meetingUrl ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(interview.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join</a>` : ''}
  </div>`;
}

function buildNextInterviewSummary(interview, events) {
  const dateTime = InterviewTimeEngine.formatInterviewDateTime(interview, DEFAULT_TIMEZONE);
  const preparation = InterviewTimeEngine.calculatePreparationWindow(interview, getInterviewPreparationMinutes());
  const conflict = InterviewTimeEngine.detectInterviewConflict(interview, events, getInterviewPreparationMinutes());
  return `<div class="next-interview-summary">
    <div class="next-interview-copy"><span class="interview-eyebrow">NEXT INTERVIEW</span><h2>${escapeHtml(interview.company || 'Interview')}</h2><p>${escapeHtml(interview.stage || 'Interview')} — ${escapeHtml(interview.position || 'Role not specified')}</p><strong>${dateTime.weekday.slice(0, 3)} ${dateTime.date} · ${dateTime.startTime} ${dateTime.timeZone}</strong><small>Preparation begins ${DateUtils.formatTimePacific(preparation.start.toISOString(), true)}</small></div>
    <div class="next-interview-countdown"><span>STARTS IN</span><strong class="interview-countdown" data-interview-start="${escapeHtml(interview.interviewDate)}" data-interview-end="${escapeHtml(interview.end || '')}">${InterviewTimeEngine.calculateInterviewCountdown(interview).label.replace(/^Starts in /i, '')}</strong>${conflict.level !== 'NONE' ? `<small>${conflict.level === 'INTERVIEW' ? 'Time' : 'Prep-time'} conflict detected</small>` : ''}</div>
    ${interview.meetingUrl ? `<a class="btn btn-primary" href="${escapeHtml(interview.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join Meeting</a>` : ''}
  </div>`;
}

function renderInterviews(interviews, events = currentDashboardEvents) {
  const container = document.getElementById('interviewsListContainer');
  const summary = document.getElementById('nextInterviewSummary');
  if (!container) return;

  if (!interviews || interviews.length === 0) {
    if (summary) summary.innerHTML = '';
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💼</div><div class="empty-state-text">No interviews currently in pipeline. Add an upcoming interview round!</div></div>`;
    return;
  }

  const now = new Date();
  const sorted = InterviewTimeEngine.sortInterviews(interviews);
  const upcoming = sorted.filter(interview => {
    const end = interview.end ? new Date(interview.end) : new Date(new Date(interview.interviewDate).getTime() + 30 * 60000);
    return end >= now && interview.status !== 'CANCELLED';
  });
  const past = sorted.filter(interview => !upcoming.includes(interview));
  if (summary) summary.innerHTML = upcoming[0] ? buildNextInterviewSummary(upcoming[0], events) : '';

  container.innerHTML = `
    <div class="interview-section-label">UPCOMING</div>
    <div class="interview-card-list">
      ${upcoming.map((interview, index) => buildInterviewCard(interview, events, index === 0)).join('') || '<div class="empty-state"><div class="empty-state-text">No upcoming interviews.</div></div>'}
    </div>
    ${past.length ? `<details class="past-interviews"><summary>Past interviews (${past.length})</summary><div class="interview-card-list">${past.map(interview => buildInterviewCard(interview, events, false)).join('')}</div></details>` : ''}
  `;
  scheduleInterviewCountdownRefresh();
}

function buildInterviewCard(interview, events, isNext) {
  const dateTime = InterviewTimeEngine.formatInterviewDateTime(interview, DEFAULT_TIMEZONE) || { weekday: 'DATE', date: 'TBD', label: 'Time TBD' };
  const preparation = InterviewTimeEngine.calculatePreparationWindow(interview, getInterviewPreparationMinutes());
  const countdown = InterviewTimeEngine.calculateInterviewCountdown(interview);
  const context = InterviewTimeEngine.getContextLabel(interview, new Date(), DEFAULT_TIMEZONE);
  const phone = getInterviewPhoneAlertStatus(interview);
  return `<article class="interview-card interview-state-${countdown.state.toLowerCase()}${isNext ? ' interview-card-next' : ''}">
    <div class="interview-card-main">
      <div class="interview-eyebrow">${context}${isNext ? ' · NEXT INTERVIEW' : ''}</div>
      <h3>${escapeHtml(interview.company || 'Interview')} — <span>${escapeHtml(interview.position || 'Role not specified')}</span></h3>
      <div class="interview-stage">${escapeHtml(interview.stage || 'Interview')}</div>
      <div class="interview-date-block"><strong>${dateTime.weekday}</strong><span>${dateTime.date}</span><b>${dateTime.label}</b></div>
      <div class="interview-countdown" data-interview-start="${escapeHtml(interview.interviewDate)}" data-interview-end="${escapeHtml(interview.end || '')}">${countdown.label}</div>
      ${preparation ? `<div class="interview-preparation"><span>Preparation</span><strong>${DateUtils.formatTimePacific(preparation.start.toISOString())} – ${DateUtils.formatTimePacific(preparation.end.toISOString(), true)}</strong></div>` : ''}
      ${buildConflictStatus(interview, events)}
      <div class="interview-meta"><span>${escapeHtml(interview.interviewType || 'Virtual Meeting')}</span>${interview.recruiter ? `<span>Recruiter: ${escapeHtml(interview.recruiter)}</span>` : ''}${interview.status ? `<span>${escapeHtml(interview.status)}</span>` : ''}<span class="${phone.active ? 'phone-alert-active' : 'phone-alert-warning'}">${phone.label}</span></div>
    </div>
    <div class="interview-card-actions">${interview.meetingUrl ? `<a class="btn btn-primary" href="${escapeHtml(interview.meetingUrl)}" target="_blank" rel="noopener noreferrer">Join Meeting</a>` : ''}${interview.sourceType === 'EVENT' ? `<button class="btn btn-secondary btn-sm" onclick='openEventDetailsModalById("${interview.id}")'>Details</button>` : `<button class="btn btn-secondary btn-sm" onclick='editInterviewModal("${interview.id}")'>Edit</button><button class="btn btn-danger btn-sm" onclick='deleteInterviewConfirm("${interview.id}")'>Delete</button>`}</div>
  </article>`;
}

function scheduleInterviewCountdownRefresh() {
  if (interviewCountdownTimer) clearTimeout(interviewCountdownTimer);
  const update = () => {
    document.querySelectorAll('.interview-countdown[data-interview-start]').forEach(element => {
      const countdown = InterviewTimeEngine.calculateInterviewCountdown({ start: element.dataset.interviewStart, end: element.dataset.interviewEnd || null });
      element.textContent = countdown.label;
      element.dataset.state = countdown.state;
    });
    const hasNearInterview = currentDashboardInterviews.some(interview => {
      const difference = new Date(interview.interviewDate).getTime() - Date.now();
      return difference > -3600000 && difference < 86400000;
    });
    interviewCountdownTimer = setTimeout(update, hasNearInterview ? 30000 : 60000);
  };
  update();
}

function openInterviewConflictModal(interviewId) {
  const interview = currentDashboardInterviews.find(item => item.id === interviewId);
  if (!interview) return;
  const result = InterviewTimeEngine.detectInterviewConflict(interview, currentDashboardEvents, getInterviewPreparationMinutes());
  const body = document.getElementById('interviewConflictBody');
  if (!body) return;
  body.innerHTML = `<div class="conflict-detail-summary"><strong>${result.level === 'INTERVIEW' ? 'TIME CONFLICT' : 'PREP TIME CONFLICT'}</strong><span>Available preparation: ${result.availablePreparationMinutes} minutes</span><span>Required preparation: ${result.preparation.minutes} minutes</span></div>${result.conflicts.map(conflict => `<div class="conflict-detail-item"><h4>${escapeHtml(conflict.event.title || 'Calendar event')}</h4><p>${DateUtils.formatTimePacific(conflict.event.start)} – ${DateUtils.formatTimePacific(conflict.event.end, true)}</p><p>Source: ${escapeHtml(conflict.event.source || 'Command Center')}</p><p>${conflict.interviewOverlapMinutes ? `${conflict.interviewOverlapMinutes} minutes overlap with interview` : `${conflict.preparationOverlapMinutes} minutes overlap with preparation`}</p></div>`).join('')}`;
  ModalManager.open('interviewConflictModal');
}

function deleteInterviewConfirm(interviewId) {
  ModalManager.confirm('Are you sure you want to delete this interview record?', async () => {
    try {
      await db.collection('users').doc(currentUser.uid).collection('interviews').doc(interviewId).delete();
      showToast('Interview deleted');
      await refreshDashboard();
    } catch (e) {
      showToast('Failed to delete interview: ' + e.message, 'error');
    }
  }, 'Delete Interview');
}

// ==========================================================================
// JOBS MODULE CRUD
// ==========================================================================

function renderJobs(jobs) {
  const container = document.getElementById('jobsListContainer');
  if (!container) return;

  if (!jobs || jobs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎯</div><div class="empty-state-text">No job opportunities tracked yet. Track your target positions here!</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${jobs.map(j => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${escapeHtml(j.company)} — ${escapeHtml(j.role)}</div>
            <div class="list-item-sub">
              ${j.location ? `<span>📍 ${escapeHtml(j.location)}</span>` : ''}
              ${j.salaryRange ? `<span>💵 ${escapeHtml(j.salaryRange)}</span>` : ''}
              ${j.nextAction ? `<span>⚡ Next: ${escapeHtml(j.nextAction)} ${j.nextActionDate ? `(${j.nextActionDate})` : ''}</span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-job_1">${j.status || 'APPLIED'}</span>
            <button class="btn btn-secondary btn-sm" onclick='editJobModal("${j.id}")'>Edit</button>
            <button class="btn btn-danger btn-sm" onclick='deleteJobConfirm("${j.id}")'>Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function deleteJobConfirm(jobId) {
  ModalManager.confirm('Are you sure you want to delete this job opportunity?', async () => {
    try {
      await db.collection('users').doc(currentUser.uid).collection('jobs').doc(jobId).delete();
      showToast('Job opportunity deleted');
      await refreshDashboard();
    } catch (e) {
      showToast('Failed to delete job: ' + e.message, 'error');
    }
  }, 'Delete Job');
}

let currentIntakeFilter = 'NEEDS_REVIEW';
let eventListenerUnsubscribe = null;
let intakeListenerUnsubscribe = null;

// ==========================================================================
// EMAIL INTAKE MODULE & APPROVAL WORKFLOW
// ==========================================================================

function setIntakeFilter(filter) {
  currentIntakeFilter = filter;
  ['intakeFilterReview', 'intakeFilterAdded', 'intakeFilterUpdated', 'intakeFilterCancelled', 'intakeFilterIgnored'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  if (filter === 'NEEDS_REVIEW') document.getElementById('intakeFilterReview')?.classList.add('active');
  if (filter === 'AUTO_ADD') document.getElementById('intakeFilterAdded')?.classList.add('active');
  if (filter === 'AUTO_UPDATE') document.getElementById('intakeFilterUpdated')?.classList.add('active');
  if (filter === 'AUTO_CANCEL') document.getElementById('intakeFilterCancelled')?.classList.add('active');
  if (filter === 'IGNORED') document.getElementById('intakeFilterIgnored')?.classList.add('active');

  fetchCollection('emailIntake').then(items => renderEmailIntake(items));
}

function renderEmailIntake(items) {
  const container = document.getElementById('emailIntakeListContainer');
  if (!container) return;

  const allItems = items || [];
  
  // Update badge counters
  document.getElementById('countReview') && (document.getElementById('countReview').innerText = allItems.filter(i => i.status === 'NEEDS_REVIEW' || i.needsReview).length);
  document.getElementById('countAdded') && (document.getElementById('countAdded').innerText = allItems.filter(i => i.status === 'AUTO_ADD' || i.status === 'ADDED').length);
  document.getElementById('countUpdated') && (document.getElementById('countUpdated').innerText = allItems.filter(i => i.status === 'AUTO_UPDATE' || i.status === 'UPDATED').length);
  document.getElementById('countCancelled') && (document.getElementById('countCancelled').innerText = allItems.filter(i => i.status === 'AUTO_CANCEL' || i.status === 'CANCELLED').length);
  document.getElementById('countIgnored') && (document.getElementById('countIgnored').innerText = allItems.filter(i => i.status === 'IGNORED' || i.status === 'IGNORED_PAST').length);

  let filtered = allItems.filter(i => {
    if (currentIntakeFilter === 'NEEDS_REVIEW') return i.status === 'NEEDS_REVIEW' || i.needsReview;
    if (currentIntakeFilter === 'AUTO_ADD') return i.status === 'AUTO_ADD' || i.status === 'ADDED';
    if (currentIntakeFilter === 'AUTO_UPDATE') return i.status === 'AUTO_UPDATE' || i.status === 'UPDATED';
    if (currentIntakeFilter === 'AUTO_CANCEL') return i.status === 'AUTO_CANCEL' || i.status === 'CANCELLED';
    if (currentIntakeFilter === 'IGNORED') return i.status === 'IGNORED' || i.status === 'IGNORED_PAST';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📥</div><div class="empty-state-text">No items in the ${currentIntakeFilter.replace('_', ' ').toLowerCase()} queue.</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${filtered.map(item => `
        <div class="list-item" style="border-left: 4px solid ${item.needsReview ? 'var(--warning)' : 'var(--primary)'};">
          <div class="list-item-main">
            <div class="list-item-title">
              ${escapeHtml(item.title)}
              ${item.needsReview ? '<span class="badge badge-urgent" style="margin-left: 0.5rem;">Needs Review</span>' : ''}
            </div>
            <div class="list-item-sub">
              <span>🕒 ${DateUtils.formatDateTimeRange(item.start, item.end)}</span>
              ${item.company ? `<span>🏢 ${escapeHtml(item.company)}</span>` : ''}
              ${item.meetingUrl ? `<span>🔗 <a href="${escapeHtml(item.meetingUrl)}" target="_blank" style="color:var(--primary);">Meeting Link</a></span>` : ''}
              <span>Source: <strong>${item.source === 'EMAIL_INTAKE' || item.gmailMessageId ? 'Email Imported' : 'Manual'}</strong></span>
              <span>Result: <strong>${escapeHtml(item.action || item.status || 'PENDING')}</strong></span>
              <span>Parser: <strong>${escapeHtml(item.parserUsed === 'Deterministic' ? 'Email Parser' : item.parserUsed === 'Ollama' ? 'AI Assisted' : item.parserUsed || 'ICS')}</strong></span>
              <span style="color: #60a5fa;">🎯 Confidence: ${Math.round((item.confidence || 0.9) * 100)}%</span>
            </div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-normal">${item.status || 'PENDING'}</span>
            ${(item.status === 'NEEDS_REVIEW' || item.needsReview) ? `
              <button class="btn btn-primary btn-sm" onclick='approveIntakeItem("${item.id}")'>✓ Approve & Add</button>
              <button class="btn btn-secondary btn-sm" onclick='editIntakeItem("${item.id}")'>Review / Edit</button>
            ` : ''}
            <button class="btn btn-danger btn-sm" onclick='ignoreIntakeItem("${item.id}")'>Ignore</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function approveIntakeItem(itemId) {
  try {
    const doc = await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).get();
    if (!doc.exists) return;
    const item = doc.data();

    // Check duplicate or update existing
    const existingEvents = await fetchCollection('events');
    const duplicate = DuplicateService.findDuplicate(item, existingEvents);

    if (duplicate) {
      ModalManager.confirm(`Duplicate found (${duplicate.reason}): "${duplicate.match.title}". Do you want to update the existing event?`, async () => {
        await db.collection('users').doc(currentUser.uid).collection('events').doc(duplicate.match.id).update({
          title: item.title,
          start: item.start,
          end: item.end,
          location: item.location || '',
          meetingUrl: item.meetingUrl || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).update({
          status: 'AUTO_UPDATE',
          needsReview: false
        });
        showToast('Existing event updated from intake');
        await refreshDashboard();
      }, 'Duplicate / Update Detected');
      return;
    }

    // Add as new calendar event
    const newDocRef = await db.collection('users').doc(currentUser.uid).collection('events').add({
      title: item.title,
      start: item.start,
      end: item.end,
      category: item.category || 'INTERVIEW',
      priority: item.priority || 'NORMAL',
      company: item.company || '',
      position: item.position || '',
      location: item.location || '',
      meetingUrl: item.meetingUrl || '',
      notes: item.notes || '',
      icalUid: item.icalUid || item.iCalUid || '',
      status: 'CONFIRMED',
      source: 'EMAIL_INTAKE',
      sourceEmail: item.sourceEmail || 'gilbert.cgpt@gmail.com',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Sync to Google Calendar (fire-and-forget, non-blocking)
    CalendarSyncService.syncEvent({
      id: newDocRef.id,
      title: item.title,
      start: item.start,
      end: item.end,
      category: item.category,
      isInterview: item.isInterview,
      timezone: item.timezone || DEFAULT_TIMEZONE,
      meetingUrl: item.meetingUrl || '',
      notes: item.notes || ''
    }).catch(() => {});

    await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).update({
      status: 'AUTO_ADD',
      needsReview: false
    });

    showToast(`New calendar event added from email: ${item.title}`);
    await refreshDashboard();
  } catch (e) {
    showToast('Approval failed: ' + e.message, 'error');
  }
}

async function editIntakeItem(itemId) {
  const doc = await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).get();
  if (!doc.exists) return;
  const d = doc.data();

  openAddEventModal();
  document.getElementById('eventTitle').value = d.title || '';
  if (d.start) {
    const parts = DateUtils.splitISOToDateAndTime(d.start);
    document.getElementById('eventDate').value = parts.date;
    document.getElementById('eventStartTime').value = parts.time;
  }
  if (d.end) {
    const parts = DateUtils.splitISOToDateAndTime(d.end);
    document.getElementById('eventEndTime').value = parts.time;
  }
  if (d.category) document.getElementById('eventCategory').value = d.category;
  if (d.company) document.getElementById('eventCompany').value = d.company;
  if (d.position) document.getElementById('eventPosition').value = d.position;
  if (d.meetingUrl) document.getElementById('eventMeetingUrl').value = d.meetingUrl;
  if (d.notes) document.getElementById('eventNotes').value = d.notes;

  // Cleanup intake item upon manual save
  await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).delete();
}

async function ignoreIntakeItem(itemId) {
  try {
    await db.collection('users').doc(currentUser.uid).collection('emailIntake').doc(itemId).update({
      status: 'IGNORED'
    });
    showToast('Intake item dismissed');
    await refreshDashboard();
  } catch (e) {
    showToast('Failed to dismiss intake item: ' + e.message, 'error');
  }
}

// Setup realtime listener for instant calendar updates
function setupRealtimeListeners() {
  if (!currentUser) return;
  if (eventListenerUnsubscribe) eventListenerUnsubscribe();
  if (intakeListenerUnsubscribe) intakeListenerUnsubscribe();

  eventListenerUnsubscribe = db.collection('users').doc(currentUser.uid).collection('events')
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' && !snapshot.metadata.hasPendingWrites) {
          const data = change.doc.data();
          if (data.source === 'EMAIL_INTAKE') {
            showToast(`New calendar event added from email: ${data.title}`);
          }
        }
      });
      refreshDashboard();
    }, (err) => console.warn('Firestore realtime listener error:', err));

  intakeListenerUnsubscribe = db.collection('users').doc(currentUser.uid).collection('emailIntake')
    .onSnapshot((snapshot) => {
      renderEmailIntake(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => console.warn('Email intake realtime listener error:', err));
}

// Form & Fixture Event Listeners
function setupEventListeners() {
  // Quick Action Buttons
  document.getElementById('quickAddEventBtn')?.addEventListener('click', () => openAddEventModal());
  document.getElementById('quickAddTaskBtn')?.addEventListener('click', () => openAddTaskModal());
  document.getElementById('addTaskBtn')?.addEventListener('click', () => openAddTaskModal());
  document.getElementById('addInterviewBtn')?.addEventListener('click', () => openAddInterviewModal());
  document.getElementById('addJobBtn')?.addEventListener('click', () => openAddJobModal());
  document.getElementById('addEmailIntakeItemBtn')?.addEventListener('click', () => ModalManager.open('emailIntakeModal'));

  // Task Filters
  document.getElementById('filterAllTasks')?.addEventListener('click', () => setTaskFilter('ALL'));
  document.getElementById('filterPendingTasks')?.addEventListener('click', () => setTaskFilter('PENDING'));
  document.getElementById('filterCompletedTasks')?.addEventListener('click', () => setTaskFilter('DONE'));

  // Sample Fixture Buttons
  document.getElementById('loadCleanInterviewFixture')?.addEventListener('click', () => {
    document.getElementById('icsRawContent').value = `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:interview-clean-12345@google.com\nSEQUENCE:0\nSTATUS:CONFIRMED\nSUMMARY:Senior QA Automation Engineer Interview\nDESCRIPTION:Technical interview for Senior QA Automation Architect with Gilbert.\\nMeeting link: https://meet.google.com/abc-defg-hij\nDTSTART;TZID=America/Los_Angeles:20260825T100000\nDTEND;TZID=America/Los_Angeles:20260825T110000\nLOCATION:https://meet.google.com/abc-defg-hij\nORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com\nEND:VEVENT\nEND:VCALENDAR`;
  });

  document.getElementById('loadRescheduleFixture')?.addEventListener('click', () => {
    document.getElementById('icsRawContent').value = `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:interview-clean-12345@google.com\nSEQUENCE:1\nSTATUS:CONFIRMED\nSUMMARY:Senior QA Automation Engineer Interview (Rescheduled)\nDESCRIPTION:Rescheduled technical interview with Gilbert.\\nMeeting link: https://meet.google.com/abc-defg-hij\nDTSTART;TZID=America/Los_Angeles:20260825T113000\nDTEND;TZID=America/Los_Angeles:20260825T123000\nLOCATION:https://meet.google.com/abc-defg-hij\nORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com\nEND:VEVENT\nEND:VCALENDAR`;
  });

  document.getElementById('loadCancelFixture')?.addEventListener('click', () => {
    document.getElementById('icsRawContent').value = `BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:CANCEL\nBEGIN:VEVENT\nUID:interview-clean-12345@google.com\nSEQUENCE:2\nSTATUS:CANCELLED\nSUMMARY:Senior QA Automation Engineer Interview (Canceled)\nDTSTART;TZID=America/Los_Angeles:20260825T113000\nDTEND;TZID=America/Los_Angeles:20260825T123000\nORGANIZER;CN=Recruiting Team:mailto:recruiter@company.com\nEND:VEVENT\nEND:VCALENDAR`;
  });

  document.getElementById('loadNlpFixture')?.addEventListener('click', () => {
    document.getElementById('icsRawContent').value = `Hi Gilbert,\n\nWe would like to schedule your technical interview next Tuesday, August 25, 2026 at 2:00 PM for 45 minutes.\n\nPlease join via Microsoft Teams: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123\n\nBest regards,\nSarah Connor\nStaff Technical Recruiter`;
  });

  // Manual trigger to query Gmail API
  document.getElementById('triggerGmailSyncBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('triggerGmailSyncBtn');
    btn.disabled = true;
    btn.innerText = 'Checking...';
    try {
      const res = await fetch('/.netlify/functions/gmail-process', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'STANDBY') {
        showToast('Gmail OAuth not yet authorized. Use Simulate button or connect OAuth.', 'info');
      } else {
        showToast(`Gmail sync complete. ${data.processedCount || 0} items processed.`);
      }
      await refreshDashboard();
    } catch (e) {
      showToast('Gmail check: ' + e.message, 'info');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Check Gmail`;
    }
  });

  // 1. EVENT FORM SUBMISSION
  document.getElementById('eventForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveEventBtn');
    btn.disabled = true;

    try {
      const eventId = document.getElementById('eventId').value;
      const saveOperation = EventViewModel.getSaveOperation(eventId);
      const title = document.getElementById('eventTitle').value.trim();
      const date = document.getElementById('eventDate').value;
      const startTime = document.getElementById('eventStartTime').value;
      const endTime = document.getElementById('eventEndTime').value;

      const startIso = DateUtils.combineDateAndTimeToISO(date, startTime);
      const endIso = DateUtils.combineDateAndTimeToISO(date, endTime);

      if (new Date(endIso) <= new Date(startIso)) {
        showToast('End time must be strictly after start time.', 'error');
        btn.disabled = false;
        return;
      }

      const payload = {
        title,
        start: startIso,
        end: endIso,
        startAt: startIso,
        endAt: endIso,
        normalizedStartAt: startIso,
        normalizedEndAt: endIso,
        category: document.getElementById('eventCategory').value,
        priority: document.getElementById('eventPriority').value,
        company: document.getElementById('eventCompany').value.trim(),
        position: document.getElementById('eventPosition').value.trim(),
        meetingUrl: document.getElementById('eventMeetingUrl').value.trim(),
        status: document.getElementById('eventStatus').value,
        notes: document.getElementById('eventNotes').value.trim(),
        timezone: DEFAULT_TIMEZONE,
        displayTimezone: DEFAULT_TIMEZONE,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (payload.category === 'INTERVIEW') {
        payload.interviewStage = document.getElementById('eventInterviewStage').value;
        payload.interviewType = document.getElementById('eventInterviewType').value;
        payload.recruiter = document.getElementById('eventRecruiter').value.trim();
      }

      if (saveOperation.type === 'UPDATE') {
        await db.collection('users').doc(currentUser.uid).collection('events').doc(saveOperation.eventId).update(payload);
        showToast('Event updated successfully');
        // Sync update to Google Calendar (idempotent \u2014 reuses existing googleCalendarEventId)
        const evDoc = await db.collection('users').doc(currentUser.uid).collection('events').doc(saveOperation.eventId).get();
        const existingGcalId = evDoc.exists ? evDoc.data().googleCalendarEventId : null;
        CalendarSyncService.syncEvent({ id: saveOperation.eventId, ...payload, googleCalendarEventId: existingGcalId || null }).catch(() => {});
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const docRef = await db.collection('users').doc(currentUser.uid).collection('events').add(payload);
        showToast('Event created successfully');
        // Sync new event to Google Calendar
        CalendarSyncService.syncEvent({ id: docRef.id, ...payload }).catch(() => {});
      }

      ModalManager.close('eventModal');
      await refreshDashboard();
    } catch (err) {
      console.error('Error saving event:', err);
      showToast('Error saving event: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // 2. TASK FORM SUBMISSION
  document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const taskId = document.getElementById('taskId').value;
      const payload = {
        title: document.getElementById('taskTitle').value.trim(),
        dueDate: document.getElementById('taskDueDate').value,
        dueTime: document.getElementById('taskDueTime').value,
        priority: document.getElementById('taskPriority').value,
        status: document.getElementById('taskStatus').value,
        description: document.getElementById('taskDescription').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (taskId) {
        await db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId).update(payload);
        showToast('Task updated');
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('tasks').add(payload);
        showToast('Task added');
      }
      ModalManager.close('taskModal');
      await refreshDashboard();
    } catch (err) {
      showToast('Error saving task: ' + err.message, 'error');
    }
  });

  // 3. INTERVIEW FORM SUBMISSION
  document.getElementById('interviewForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const interviewId = document.getElementById('interviewId').value;
      const payload = {
        company: document.getElementById('interviewCompany').value.trim(),
        position: document.getElementById('interviewPosition').value.trim(),
        stage: document.getElementById('interviewStage').value,
        interviewType: document.getElementById('interviewType').value,
        interviewDate: document.getElementById('interviewDate').value,
        followUpDate: document.getElementById('interviewFollowUpDate').value,
        recruiter: document.getElementById('interviewRecruiter').value.trim(),
        recruiterEmail: document.getElementById('interviewRecruiterEmail').value.trim(),
        meetingUrl: document.getElementById('interviewMeetingUrl').value.trim(),
        notes: document.getElementById('interviewNotes').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (interviewId) {
        await db.collection('users').doc(currentUser.uid).collection('interviews').doc(interviewId).update(payload);
        showToast('Interview updated');
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('interviews').add(payload);
        showToast('Interview added to tracker');
      }
      ModalManager.close('interviewModal');
      await refreshDashboard();
    } catch (err) {
      showToast('Error saving interview: ' + err.message, 'error');
    }
  });

  // 4. JOB FORM SUBMISSION
  document.getElementById('jobForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const jobId = document.getElementById('jobId').value;
      const payload = {
        company: document.getElementById('jobCompany').value.trim(),
        role: document.getElementById('jobRole').value.trim(),
        status: document.getElementById('jobStatus').value,
        location: document.getElementById('jobLocation').value.trim(),
        salaryRange: document.getElementById('jobSalary').value.trim(),
        jobUrl: document.getElementById('jobUrl').value.trim(),
        nextAction: document.getElementById('jobNextAction').value.trim(),
        nextActionDate: document.getElementById('jobNextActionDate').value,
        notes: document.getElementById('jobNotes').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (jobId) {
        await db.collection('users').doc(currentUser.uid).collection('jobs').doc(jobId).update(payload);
        showToast('Job opportunity updated');
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('jobs').add(payload);
        showToast('Job opportunity added');
      }
      ModalManager.close('jobModal');
      await refreshDashboard();
    } catch (err) {
      showToast('Error saving job: ' + err.message, 'error');
    }
  });

  // 5. EMAIL INTAKE FORM SUBMISSION (Automatic Ingestion Engine)
  document.getElementById('emailIntakeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = document.getElementById('icsRawContent').value.trim();
    if (!raw) return;

    try {
      const existingEvents = await fetchCollection('events');
      let parsed = null;
      let parserUsed = 'Unknown';

      // 1. ICS First
      if (raw.includes('BEGIN:VCALENDAR') || raw.includes('BEGIN:VEVENT')) {
        parsed = ICSParser.parse(raw);
        parserUsed = 'ICS';
      } else {
        // 2. Deterministic NLP
        parsed = parseDeterministicText(raw);
        parserUsed = 'Deterministic';
        
        // 3. Ollama Fallback if confidence is low
        if (!parsed || !parsed.start) {
          const aiResult = await AIService.parseMeetingEmail(raw);
          if (aiResult) {
            parsed = aiResult;
            parserUsed = 'Ollama';
          }
        }
      }

      if (!parsed || !parsed.title) {
        showToast('Could not extract appointment details. Queued to Needs Review.', 'warning');
        parsed = {
          title: 'Unparsed Forwarded Email',
          notes: raw,
          confidence: 0.1,
          needsReview: true,
          parserUsed: 'Unparsed'
        };
      }

      const normalized = normalizeCandidate(parsed, parserUsed);
      const duplicateEval = DuplicateService.findDuplicate(normalized, existingEvents);

      // Decision Execution: Auto Add / Auto Update / Auto Cancel / Needs Review
      if (normalized.status === 'CANCELLED' || (duplicateEval && parsed.method === 'CANCEL')) {
        if (duplicateEval) {
          await db.collection('users').doc(currentUser.uid).collection('events').doc(duplicateEval.match.id).update({
            status: 'CANCELLED',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        }
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').add({
          ...normalized,
          status: 'AUTO_CANCEL',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Event automatically marked as CANCELLED');
      } else if (duplicateEval) {
        // Reschedule / Update existing event
        await db.collection('users').doc(currentUser.uid).collection('events').doc(duplicateEval.match.id).update({
          title: normalized.title,
          start: normalized.start,
          end: normalized.end,
          location: normalized.location || '',
          meetingUrl: normalized.meetingUrl || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').add({
          ...normalized,
          status: 'AUTO_UPDATE',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`Calendar event automatically updated: ${normalized.title}`);
      } else if (normalized.confidence >= 0.85 && !normalized.needsReview) {
        // High confidence: AUTO ADD DIRECTLY TO CALENDAR
        const autoDocRef = await db.collection('users').doc(currentUser.uid).collection('events').add({
          ...normalized,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').add({
          ...normalized,
          status: 'AUTO_ADD',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`New calendar event automatically added: ${normalized.title}`);
        // Sync to Google Calendar (fire-and-forget)
        CalendarSyncService.syncEvent({ id: autoDocRef.id, ...normalized }).catch(() => {});
      } else {
        // Low / Medium confidence: Route to Needs Review queue
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').add({
          ...normalized,
          status: 'NEEDS_REVIEW',
          needsReview: true,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Item saved to Email Intake (Needs Review)');
      }

      document.getElementById('icsRawContent').value = '';
      ModalManager.close('emailIntakeModal');
      await refreshDashboard();
    } catch (err) {
      showToast('Error processing intake: ' + err.message, 'error');
    }
  });
}

function parseDeterministicText(text) {
  const dateMatch = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:\s*,?\s*(202\d))?/i);
  const timeMatch = text.match(/\b([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(am|pm)?\b/i);
  const durMatch = text.match(/\b(15|30|45|60|90)\s*(?:mins?|minutes)\b/i);
  const duration = durMatch ? parseInt(durMatch[1], 10) : 60;

  if (!dateMatch || !timeMatch) return null;

  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mIndex = monthNames.findIndex(m => dateMatch[1].toLowerCase().startsWith(m));
  const day = String(dateMatch[2]).padStart(2, '0');
  const year = dateMatch[3] || new Date().getFullYear();
  const month = String(mIndex + 1).padStart(2, '0');
  
  let hours = parseInt(timeMatch[1], 10);
  const mins = timeMatch[2] || '00';
  const ampm = (timeMatch[3] || '').toLowerCase();
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  const startIso = new Date(Date.UTC(year, mIndex, +day, hours, +mins, 0)).toISOString();
  const endIso = new Date(new Date(startIso).getTime() + duration * 60000).toISOString();

  const urlMatch = text.match(/https?:\/\/[^\s<>"{}|\\^`]+/i);

  return {
    title: text.split('\n')[0].slice(0, 60) || 'Interview Invitation',
    start: startIso,
    end: endIso,
    meetingUrl: urlMatch ? urlMatch[0] : '',
    notes: text,
    confidence: 0.85
  };
}

function normalizeCandidate(cand, parserUsed) {
  const combined = `${cand.title || ''} ${cand.notes || ''} ${cand.location || ''}`;
  const classification = InterviewClassifier.classifyInterviewIntent(cand);
  let category = cand.category;
  if (classification.isInterview) {
    category = 'INTERVIEW';
  } else if (!category) {
    if (/church|worship|service/i.test(combined)) category = 'CHURCH';
    else if (/focus|deep work/i.test(combined)) category = 'FOCUS';
    else if (/doctor|dentist|appointment/i.test(combined)) category = 'PERSONAL';
    else category = 'OTHER';
  }

  return {
    title: cand.title || 'Forwarded Event',
    company: cand.company || classification.company || '',
    position: cand.position || classification.position || '',
    category,
    isInterview: classification.isInterview,
    classification: {
      type: classification.isInterview ? 'interview' : 'other',
      confidence: classification.confidence,
      stage: classification.stage,
      reasons: classification.reasons
    },
    interviewStage: classification.stage || cand.interviewStage || null,
    start: cand.start,
    end: cand.end,
    timezone: InterviewTimeEngine.normalizeTimeZone(cand.timezone || DEFAULT_TIMEZONE),
    location: cand.location || '',
    meetingUrl: cand.meetingUrl || '',
    priority: cand.priority || (category === 'INTERVIEW' ? 'HIGH' : 'NORMAL'),
    status: cand.status || 'CONFIRMED',
    source: 'EMAIL_INTAKE',
    sourceEmail: 'gilbert.cgpt@gmail.com',
    icalUid: cand.icalUid || cand.iCalUid || null,
    notes: cand.notes || '',
    confidence: cand.confidence || 0.85,
    needsReview: cand.needsReview || !cand.start,
    parserUsed
  };
}

const ModalMode = {
  CREATE: 'create',
  VIEW: 'view',
  EDIT: 'edit'
};
let currentEventModalMode = null;

function openCreateEventModal(dateStr = '') {
  currentEventModalMode = ModalMode.CREATE;
  logCalendarRouting('[MODAL] CREATE');
  logCalendarRouting('[MODAL] modalMode:', currentEventModalMode);
  document.getElementById('eventForm').reset();
  document.getElementById('eventId').value = '';
  document.getElementById('eventModalTitle').innerText = 'Add Event';
  document.getElementById('eventDate').value = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
  document.getElementById('eventCategory').value = 'OTHER';
  document.getElementById('eventPriority').value = 'NORMAL';
  document.getElementById('eventStatus').value = 'CONFIRMED';
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventStartTime').value = '';
  document.getElementById('eventEndTime').value = '';
  document.getElementById('eventCompany').value = '';
  document.getElementById('eventPosition').value = '';
  document.getElementById('eventMeetingUrl').value = '';
  document.getElementById('eventNotes').value = '';
  document.getElementById('interviewSpecificFields').style.display = 'none';
  ModalManager.open('eventModal');
}

function openAddEventModal(dateStr = '') {
  openCreateEventModal(dateStr);
}

async function openEventDetailsModalById(eventId) {
  const canonicalId = EventViewModel.getCanonicalEventId(eventId);
  if (!canonicalId) {
    console.error('[openEventDetailsModalById] Missing or invalid event ID for event details modal:', eventId);
    showToast('Could not load this existing event.', 'error');
    return;
  }
  try {
    if (!currentUser?.uid) {
      console.error('[openEventDetailsModalById] No authenticated user found when loading event:', canonicalId);
      showToast('Could not load this existing event.', 'error');
      return;
    }
    const doc = await db.collection('users').doc(currentUser.uid).collection('events').doc(canonicalId).get();
    if (!doc.exists) {
      console.error(`[openEventDetailsModalById] Event "${canonicalId}" not found in Firestore collection users/${currentUser.uid}/events`);
      showToast('Could not load this existing event.', 'error');
      return;
    }
    openEventDetailsModal({ ...doc.data(), id: doc.id, firestoreId: doc.id });
  } catch (err) {
    console.error('[openEventDetailsModalById] Error loading event from Firestore:', err);
    showToast('Could not load this existing event.', 'error');
  }
}

function openEventDetailsModal(eventData) {
  const canonicalId = EventViewModel.getCanonicalEventId(eventData);
  if (!canonicalId) {
    console.error('[openEventDetailsModal] Missing canonical ID for event data:', eventData);
    showToast('Could not load this existing event.', 'error');
    return;
  }

  currentEventModalMode = ModalMode.VIEW;
  logCalendarRouting('[MODAL] VIEW');
  logCalendarRouting('[MODAL] modalMode:', currentEventModalMode);

  const optionalRow = (label, value, renderedValue = '') => value ? `
    <div class="event-detail-field">
      <div class="event-detail-label">${escapeHtml(label)}</div>
      <div class="event-detail-value">${renderedValue || escapeHtml(String(value))}</div>
    </div>` : '';
  const view = EventViewModel.getFormValues(eventData);
  const meetingUrl = /^https?:\/\//i.test(view.meetingUrl || '') ? view.meetingUrl : '';
  const locationUrl = /^https?:\/\//i.test(eventData.location || '') ? eventData.location : '';
  const organizer = view.organizer;
  const notes = view.notes;
  const sourceLabel = EventViewModel.getSourceLabel(eventData);
  const isInterview = view.category === 'INTERVIEW';
  const dateTime = InterviewTimeEngine.formatInterviewDateTime(eventData, DEFAULT_TIMEZONE) || { label: 'Time not available' };
  const preparation = isInterview ? InterviewTimeEngine.calculatePreparationWindow(eventData, getInterviewPreparationMinutes()) : null;
  const countdown = isInterview ? InterviewTimeEngine.calculateInterviewCountdown(eventData) : null;
  const phone = isInterview ? getInterviewPhoneAlertStatus(eventData) : null;

  document.getElementById('detailsTitle').innerText = view.title || 'Event Details';
  document.getElementById('eventDetailsBody').innerHTML = `
    ${isInterview ? `<div class="event-detail-hero"><strong>${escapeHtml(eventData.company || 'Interview')}</strong><span>${escapeHtml(EventViewModel.getInterviewStage(eventData))} — ${escapeHtml(eventData.position || 'Role not specified')}</span><b>${dateTime.label}</b><em>${countdown.label}</em></div>` : ''}
    <div class="event-detail-badges">
      <span class="badge badge-${escapeHtml(view.category.toLowerCase())}">${escapeHtml(view.category)}</span>
      <span class="badge badge-normal">${escapeHtml(view.status.charAt(0) + view.status.slice(1).toLowerCase())}</span>
      <span class="badge badge-normal">${escapeHtml(sourceLabel)}</span>
      ${eventData.parserUsed ? `<span class="badge badge-normal">${escapeHtml(eventData.parserUsed)}</span>` : ''}
    </div>
    <div class="form-row-3">
      ${optionalRow('Date', DateUtils.formatDatePacific(EventViewModel.getStart(eventData)))}
      ${optionalRow('Start Time', DateUtils.formatTimePacific(EventViewModel.getStart(eventData), true))}
      ${optionalRow('End Time', DateUtils.formatTimePacific(EventViewModel.getEnd(eventData), true))}
    </div>
    <div class="form-row">
      ${optionalRow('Priority', view.priority)}
      ${optionalRow('Company', eventData.company)}
    </div>
    ${optionalRow('Position / Role', view.position)}
    ${optionalRow('Location', eventData.location, locationUrl ? `<a href="${escapeHtml(locationUrl)}" target="_blank" rel="noopener noreferrer">Open location</a>` : '')}
    <div class="form-row">
      ${optionalRow('Interview Stage', EventViewModel.getInterviewStage(eventData))}
      ${optionalRow('Interview Format', view.interviewType)}
    </div>
    ${optionalRow('Recruiter', organizer.name || organizer.email, `${organizer.name ? `<strong>${escapeHtml(organizer.name)}</strong>` : ''}${organizer.email ? `<a href="mailto:${escapeHtml(organizer.email)}">${escapeHtml(organizer.email)}</a>` : ''}`)}
    ${preparation ? optionalRow('Preparation', preparation.start.toISOString(), `${DateUtils.formatTimePacific(preparation.start.toISOString())} – ${DateUtils.formatTimePacific(preparation.end.toISOString(), true)}`) : ''}
    ${phone ? optionalRow('Phone Alerts', phone.label) : ''}
    ${optionalRow('Source', sourceLabel)}
    ${optionalRow('Original Subject', eventData.originalSubject)}
    ${optionalRow('Received', eventData.receivedAt ? DateUtils.formatDateTimeRange(eventData.receivedAt, null) : '')}
    ${optionalRow('Processed', eventData.processedAt ? DateUtils.formatDateTimeRange(eventData.processedAt, null) : '')}
    ${notes ? `<details class="event-detail-notes"><summary>Notes / Preparation</summary><div>${escapeHtml(notes)}</div></details>` : ''}
    ${meetingUrl ? `<a class="btn btn-primary" href="${escapeHtml(meetingUrl)}" target="_blank" rel="noopener noreferrer">Join Meeting</a>` : ''}
    ${typeof buildRemindersSection === 'function' ? buildRemindersSection(eventData) : ''}
  `;

  document.getElementById('detailsEditBtn').onclick = () => {
    ModalManager.close('eventDetailsModal');
    openEditEventModal(eventData);
  };
  document.getElementById('detailsDeleteBtn').onclick = () => {
    ModalManager.close('eventDetailsModal');
    deleteEvent(canonicalId, eventData.title);
  };
  ModalManager.open('eventDetailsModal');
}

function openEditEventModal(eventData) {
  const canonicalId = EventViewModel.getCanonicalEventId(eventData);
  if (!canonicalId) {
    console.error('[openEditEventModal] Missing canonical ID for event:', eventData);
    showToast('Could not load this existing event.', 'error');
    return;
  }

  currentEventModalMode = ModalMode.EDIT;
  logCalendarRouting('[MODAL] EDIT');
  logCalendarRouting('[MODAL] modalMode:', currentEventModalMode);
  const view = EventViewModel.getFormValues(eventData);
  document.getElementById('eventForm').reset();
  document.getElementById('eventId').value = view.id || canonicalId;
  document.getElementById('eventModalTitle').innerText = 'Edit Event';
  document.getElementById('eventTitle').value = view.title;
  document.getElementById('eventDate').value = view.date;
  document.getElementById('eventStartTime').value = view.startTime;
  document.getElementById('eventEndTime').value = view.endTime;
  document.getElementById('eventCategory').value = view.category;
  document.getElementById('eventPriority').value = view.priority;
  document.getElementById('eventCompany').value = view.company;
  document.getElementById('eventPosition').value = view.position;
  document.getElementById('eventMeetingUrl').value = view.meetingUrl;
  document.getElementById('eventStatus').value = view.status;
  document.getElementById('eventNotes').value = view.notes;
  document.getElementById('eventInterviewStage').value = view.interviewStage;
  document.getElementById('eventInterviewType').value = view.interviewType;
  document.getElementById('eventRecruiter').value = view.recruiter;
  document.getElementById('interviewSpecificFields').style.display = view.category === 'INTERVIEW' ? 'block' : 'none';
  ModalManager.open('eventModal');
}

function editEventModal(eventData) {
  openEditEventModal(eventData);
}

function deleteEvent(eventId, title) {
  const canonicalId = EventViewModel.getCanonicalEventId(eventId);
  if (!canonicalId) {
    showToast('Could not delete event: Missing ID', 'error');
    return;
  }
  ModalManager.confirm(`Delete "${title || 'this event'}"? This action cannot be undone.`, async () => {
    try {
      // Get googleCalendarEventId before deleting
      const evDoc = await db.collection('users').doc(currentUser.uid).collection('events').doc(canonicalId).get();
      const gcalId = evDoc.exists ? evDoc.data().googleCalendarEventId : null;

      await db.collection('users').doc(currentUser.uid).collection('events').doc(canonicalId).delete();
      showToast('Event deleted');

      // Remove from Google Calendar too (fire-and-forget)
      if (gcalId) CalendarSyncService.deleteEvent(gcalId).catch(() => {});

      await refreshDashboard();
    } catch (error) {
      showToast('Failed to delete event: ' + error.message, 'error');
    }
  }, 'Delete Event');
}

function openAddTaskModal() {
  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = '';
  document.getElementById('taskModalTitle').innerText = 'Add Task';
  document.getElementById('taskDueDate').value = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
  ModalManager.open('taskModal');
}

async function editTaskModal(taskId) {
  const doc = await db.collection('users').doc(currentUser.uid).collection('tasks').doc(taskId).get();
  if (!doc.exists) return;
  const d = doc.data();

  document.getElementById('taskForm').reset();
  document.getElementById('taskId').value = doc.id;
  document.getElementById('taskModalTitle').innerText = 'Edit Task';
  document.getElementById('taskTitle').value = d.title || '';
  document.getElementById('taskDueDate').value = d.dueDate || '';
  document.getElementById('taskDueTime').value = d.dueTime || '';
  document.getElementById('taskPriority').value = d.priority || 'NORMAL';
  document.getElementById('taskStatus').value = d.status || 'TODO';
  document.getElementById('taskDescription').value = d.description || '';
  ModalManager.open('taskModal');
}

function openAddInterviewModal() {
  document.getElementById('interviewForm').reset();
  document.getElementById('interviewId').value = '';
  document.getElementById('interviewModalTitle').innerText = 'Add Interview';
  document.getElementById('interviewDate').value = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
  ModalManager.open('interviewModal');
}

async function editInterviewModal(interviewId) {
  const doc = await db.collection('users').doc(currentUser.uid).collection('interviews').doc(interviewId).get();
  if (!doc.exists) return;
  const d = doc.data();

  document.getElementById('interviewForm').reset();
  document.getElementById('interviewId').value = doc.id;
  document.getElementById('interviewModalTitle').innerText = 'Edit Interview';
  document.getElementById('interviewCompany').value = d.company || '';
  document.getElementById('interviewPosition').value = d.position || '';
  document.getElementById('interviewStage').value = d.stage || 'TECHNICAL';
  document.getElementById('interviewType').value = d.interviewType || 'Google Meet';
  document.getElementById('interviewDate').value = d.interviewDate || '';
  document.getElementById('interviewFollowUpDate').value = d.followUpDate || '';
  document.getElementById('interviewRecruiter').value = d.recruiter || '';
  document.getElementById('interviewRecruiterEmail').value = d.recruiterEmail || '';
  document.getElementById('interviewMeetingUrl').value = d.meetingUrl || '';
  document.getElementById('interviewNotes').value = d.notes || '';
  ModalManager.open('interviewModal');
}

function openAddJobModal() {
  document.getElementById('jobForm').reset();
  document.getElementById('jobId').value = '';
  document.getElementById('jobModalTitle').innerText = 'Add Job Opportunity';
  ModalManager.open('jobModal');
}

async function editJobModal(jobId) {
  const doc = await db.collection('users').doc(currentUser.uid).collection('jobs').doc(jobId).get();
  if (!doc.exists) return;
  const d = doc.data();

  document.getElementById('jobForm').reset();
  document.getElementById('jobId').value = doc.id;
  document.getElementById('jobModalTitle').innerText = 'Edit Job Opportunity';
  document.getElementById('jobCompany').value = d.company || '';
  document.getElementById('jobRole').value = d.role || '';
  document.getElementById('jobStatus').value = d.status || 'APPLIED';
  document.getElementById('jobLocation').value = d.location || '';
  document.getElementById('jobSalary').value = d.salaryRange || '';
  document.getElementById('jobUrl').value = d.jobUrl || '';
  document.getElementById('jobNextAction').value = d.nextAction || '';
  document.getElementById('jobNextActionDate').value = d.nextActionDate || '';
  document.getElementById('jobNotes').value = d.notes || '';
  ModalManager.open('jobModal');
}

function setTaskFilter(filter) {
  currentTaskFilter = filter;
  ['filterAllTasks', 'filterPendingTasks', 'filterCompletedTasks'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  if (filter === 'ALL') document.getElementById('filterAllTasks')?.classList.add('active');
  if (filter === 'PENDING') document.getElementById('filterPendingTasks')?.classList.add('active');
  if (filter === 'DONE') document.getElementById('filterCompletedTasks')?.classList.add('active');
  fetchCollection('tasks').then(tasks => renderTasks(tasks));
}

async function checkOllamaStatus() {
  const statusText = document.getElementById('ollamaStatusText');
  const statusBadge = document.getElementById('ollamaStatusBadge');
  if (!statusText || !statusBadge) return;

  const isOnline = await AIService.checkHealth();
  if (isOnline) {
    statusText.innerText = 'Connected (http://127.0.0.1:11434)';
    statusBadge.innerText = 'Online';
    statusBadge.style.background = 'var(--success-bg)';
    statusBadge.style.color = 'var(--success)';
  } else {
    statusText.innerText = 'Offline (Deterministic fallback active)';
    statusBadge.innerText = 'Offline';
    statusBadge.style.background = 'rgba(107, 114, 128, 0.2)';
    statusBadge.style.color = '#9ca3af';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// NOTIFICATIONS, ALARMS & CALENDAR SYNC
// Phases 1-15: Google Calendar sync, browser alerts, follow-up reminders,
// settings persistence, sound, idempotency, timezone correctness
// ==========================================================================

// --------------------------------------------------------------------------
// CALENDAR SYNC SERVICE
// Calls /.netlify/functions/calendar-sync (server-side, secrets never exposed)
// --------------------------------------------------------------------------
const CalendarSyncService = {
  /**
   * Create or update a Google Calendar event.
   * If event already has googleCalendarEventId -> UPDATE, else CREATE.
   * Idempotent: same event synced twice results in one calendar event.
   */
  async syncEvent(eventData) {
    const settings = await NotificationService.loadSettings();
    if (!settings.calendarSync) return { status: 'DISABLED' };

    try {
      const action = eventData.googleCalendarEventId ? 'UPDATE' : 'CREATE';
      const configuredMinutes = settings.reminderMinutes || [1440, 60, 30, 15, 5];
      const reminderMinutes = [...new Set([
        ...configuredMinutes,
        ...(eventData.isInterview || eventData.category === 'INTERVIEW' ? [30] : [])
      ])];

      const res = await fetch('/.netlify/functions/calendar-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          title: eventData.title,
          start: eventData.start,
          end: eventData.end,
          timezone: eventData.timezone || DEFAULT_TIMEZONE,
          meetingUrl: eventData.meetingUrl || '',
          description: eventData.notes || '',
          reminderMinutes,
          googleCalendarEventId: eventData.googleCalendarEventId || null
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.status === 'STANDBY') {
        console.info('[CalendarSync] Credentials not configured — Firestore-only mode');
        return data;
      }

      // Persist googleCalendarEventId back to Firestore
      if (data.googleCalendarEventId && eventData.id && currentUser) {
        await db.collection('users').doc(currentUser.uid).collection('events').doc(eventData.id).update({
          googleCalendarEventId: data.googleCalendarEventId,
          googleCalendarLink: data.calendarLink || '',
          calendarSyncStatus: 'SYNCED',
          reminderMinutes,
          calendarSyncedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      console.info(`[CalendarSync] ${action}: ${data.googleCalendarEventId}`);
      return data;
    } catch (err) {
      console.warn('[CalendarSync] Sync failed, event saved to Firestore only:', err.message);
      if (eventData.id && currentUser) {
        await db.collection('users').doc(currentUser.uid).collection('events').doc(eventData.id).update({
          calendarSyncStatus: 'PENDING'
        }).catch(() => {});
      }
      return { status: 'PENDING', error: err.message };
    }
  },

  async deleteEvent(googleCalendarEventId) {
    if (!googleCalendarEventId) return;
    const settings = await NotificationService.loadSettings();
    if (!settings.calendarSync) return;

    try {
      await fetch('/.netlify/functions/calendar-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE', googleCalendarEventId })
      });
    } catch (err) {
      console.warn('[CalendarSync] Delete failed:', err.message);
    }
  }
};

function ensureInterviewCalendarReminders(events) {
  (events || []).filter(event =>
    (event.isInterview || event.category === 'INTERVIEW') &&
    event.googleCalendarEventId &&
    event.calendarSyncStatus === 'SYNCED' &&
    !(event.reminderMinutes || []).map(Number).includes(30)
  ).forEach(event => CalendarSyncService.syncEvent(event).catch(() => {}));
}

// --------------------------------------------------------------------------
// NOTIFICATION SERVICE
// Browser Web Notifications + Audio Chime + Alert Banner
// --------------------------------------------------------------------------
const NotificationService = {
  _settings: null,
  _alertTimers: [],
  _muteKey: 'gcc_sound_muted',
  _snoozeKey: 'gcc_alert_snoozed',

  async init() {
    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(async () => {
        try {
          await Notification.requestPermission();
        } catch (e) {
          console.info('[Notifications] Permission request deferred');
        }
      }, 3000);
    }
  },

  async loadSettings() {
    if (this._settings) return this._settings;
    if (!currentUser) {
      this._settings = this._defaultSettings();
      return this._settings;
    }
    try {
      const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('notifications').get();
      this._settings = doc.exists ? { ...this._defaultSettings(), ...doc.data() } : this._defaultSettings();
    } catch (e) {
      this._settings = this._defaultSettings();
    }
    return this._settings;
  },

  _defaultSettings() {
    return {
      calendarSync: true,
      browserNotifications: true,
      soundAlerts: true,
      reminderMinutes: [1440, 60, 30, 15, 5],
      interviewPreparationMinutes: 30,
      personalEmailReminders: false,
      emailReminderMinutes: [30],
      followUpSuggestions: true
    };
  },

  async saveSettings(newSettings) {
    this._settings = { ...this._defaultSettings(), ...newSettings };
    if (!currentUser) return;
    await db.collection('users').doc(currentUser.uid).collection('settings').doc('notifications').set(this._settings);
    showToast('Notification settings saved', 'success');
  },

  isMuted() {
    return localStorage.getItem(this._muteKey) === '1';
  },

  toggleMute() {
    const newMuted = !this.isMuted();
    localStorage.setItem(this._muteKey, newMuted ? '1' : '0');
    return newMuted;
  },

  isSnoozed(eventId) {
    try {
      const snoozeData = JSON.parse(localStorage.getItem(this._snoozeKey) || '{}');
      const until = snoozeData[eventId];
      return until && Date.now() < until;
    } catch (e) {
      return false;
    }
  },

  snooze(eventId, minutes = 10) {
    try {
      const snoozeData = JSON.parse(localStorage.getItem(this._snoozeKey) || '{}');
      snoozeData[eventId] = Date.now() + minutes * 60 * 1000;
      localStorage.setItem(this._snoozeKey, JSON.stringify(snoozeData));
    } catch (e) {}
  },

  // Sound Chime using Web Audio API
  playChime() {
    if (this.isMuted()) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(1108.73, ctx.currentTime + 0.15);
      oscillator.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.3);

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.info('[Sound] Web Audio API unavailable');
    }
  },

  showBrowserNotification(title, body, eventId, meetingUrl) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const n = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: eventId || 'gcc-alert',
      requireInteraction: true
    });

    if (meetingUrl) {
      n.addEventListener('click', () => {
        window.open(meetingUrl, '_blank');
        n.close();
      });
    }
  },

  showAlertBanner(event, minutesBefore) {
    if (this.isSnoozed(event.id)) return;

    const existing = document.getElementById('gcc-alert-banner');
    if (existing) existing.remove();

    const whenStr = minutesBefore === 0
      ? 'NOW'
      : minutesBefore < 60
        ? `in ${minutesBefore}m`
        : minutesBefore < 1440
          ? `in ${Math.round(minutesBefore / 60)}h`
          : 'tomorrow';

    const banner = document.createElement('div');
    banner.id = 'gcc-alert-banner';
    banner.className = 'gcc-alert-banner';
    banner.innerHTML = `
      <div class="gcc-alert-content">
        <div class="gcc-alert-icon">🔔</div>
        <div class="gcc-alert-text">
          <div class="gcc-alert-title">${escapeHtml(event.title || 'Event Reminder')}</div>
          <div class="gcc-alert-sub">${whenStr} &bull; ${DateUtils.formatTimePacific(event.start, true)}${event.company ? ' &bull; ' + escapeHtml(event.company) : ''}</div>
        </div>
        <div class="gcc-alert-actions">
          ${event.meetingUrl ? `<a href="${escapeHtml(event.meetingUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Join</a>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="NotificationService.snooze('${event.id}', 10); document.getElementById('gcc-alert-banner')?.remove(); showToast('Snoozed 10 minutes');">Snooze 10m</button>
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('gcc-alert-banner')?.remove();">Dismiss</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 60000);

    const settings = this._settings || this._defaultSettings();
    if (settings.soundAlerts) this.playChime();
  },

  scheduleUpcomingAlerts() {
    this._alertTimers.forEach(t => clearTimeout(t));
    this._alertTimers = [];

    if (!currentUser) return;

    fetchCollection('events').then(events => {
      const now = Date.now();
      const settings = this._settings || this._defaultSettings();
      const configuredMinutes = settings.reminderMinutes || [1440, 60, 30, 15, 5];

      const upcoming = (events || []).filter(e => {
        if (!e.start || e.status === 'CANCELLED') return false;
        const diff = new Date(e.start).getTime() - now;
        return diff > 0 && diff <= 25 * 60 * 60 * 1000;
      });

      upcoming.forEach(event => {
        const eventTime = new Date(event.start).getTime();
        const minutes = [...new Set([
          ...configuredMinutes,
          ...(event.isInterview || event.category === 'INTERVIEW' ? [30] : [])
        ])];

        minutes.forEach(m => {
          const alertAt = eventTime - m * 60 * 1000;
          const delay = alertAt - now;

          if (delay >= 0 && delay < 25 * 60 * 60 * 1000) {
            const timer = setTimeout(() => {
              this.fireAlert(event, m);
            }, delay);
            this._alertTimers.push(timer);
          }

          if (delay > -60000 && delay <= 60000 && !this.isSnoozed(event.id)) {
            this.fireAlert(event, m);
          }
        });
      });
    }).catch(err => console.warn('[NotificationService] scheduleUpcomingAlerts error:', err));
  },

  fireAlert(event, minutesBefore) {
    const settings = this._settings || this._defaultSettings();
    const label = minutesBefore === 0 ? 'Starting now'
      : minutesBefore < 60 ? `In ${minutesBefore} minutes`
      : minutesBefore < 1440 ? `In ${Math.round(minutesBefore / 60)} hour(s)`
      : 'Tomorrow';

    const isInterview = event.isInterview || event.category === 'INTERVIEW';
    const alertTitle = isInterview && minutesBefore === 30
      ? `${event.company || 'Interview'} preparation starts now`
      : isInterview && minutesBefore === 15
        ? 'INTERVIEW IN 15 MINUTES'
        : isInterview && minutesBefore === 5
          ? 'INTERVIEW IN 5 MINUTES — JOIN NOW'
          : `🔔 ${event.title || 'Upcoming Event'}`;
    const body = `${label} • ${DateUtils.formatTimePacific(event.start, true)}${event.company ? ' • ' + event.company : ''}`;

    this.showAlertBanner({ ...event, title: alertTitle }, minutesBefore);

    if (settings.browserNotifications) {
      this.showBrowserNotification(alertTitle, body, event.id, event.meetingUrl);
    }
  },

  rescheduleOnRefresh() {
    this.scheduleUpcomingAlerts();
  }
};

// --------------------------------------------------------------------------
// FOLLOW-UP REMINDER SERVICE
// --------------------------------------------------------------------------
const FollowUpService = {
  PRESETS: [
    { id: '2h', label: 'Later Today (2h)', hours: 2 },
    { id: 'morning', label: 'Tomorrow Morning (9 AM)', hours: null, slot: 'morning' },
    { id: 'afternoon', label: 'Tomorrow Afternoon (2 PM)', hours: null, slot: 'afternoon' },
    { id: '2d', label: 'In 2 Days', hours: 48 },
    { id: '3d', label: 'In 3 Days', hours: 72 },
    { id: '1w', label: 'In 1 Week', hours: 168 }
  ],

  computeDueDate(presetId) {
    const now = new Date();
    const preset = this.PRESETS.find(p => p.id === presetId);
    if (!preset) return new Date(now.getTime() + 24 * 3600000).toISOString();

    if (preset.hours) {
      return new Date(now.getTime() + preset.hours * 3600000).toISOString();
    }

    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    if (preset.slot === 'morning') { target.setHours(9, 0, 0, 0); }
    else if (preset.slot === 'afternoon') { target.setHours(14, 0, 0, 0); }
    return target.toISOString();
  },

  async createFollowUp(eventId, type, presetId, customNote) {
    if (!currentUser) return;
    const dueDate = this.computeDueDate(presetId);

    const followUp = {
      eventId,
      type,
      note: customNote || '',
      dueDate,
      presetId,
      status: 'PENDING',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('users').doc(currentUser.uid).collection('followUps').add(followUp);
    showToast(`Follow-up reminder set: ${this.PRESETS.find(p => p.id === presetId)?.label || presetId}`);
    renderFollowUps();
  },

  async markComplete(followUpId) {
    if (!currentUser) return;
    await db.collection('users').doc(currentUser.uid).collection('followUps').doc(followUpId).update({
      status: 'COMPLETED',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    renderFollowUps();
  },

  async deleteFollowUp(followUpId) {
    if (!currentUser) return;
    await db.collection('users').doc(currentUser.uid).collection('followUps').doc(followUpId).delete();
    renderFollowUps();
  }
};

// --------------------------------------------------------------------------
// RENDER FOLLOW-UPS
// --------------------------------------------------------------------------
async function renderFollowUps() {
  const container = document.getElementById('followUpsContainer');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Sign in to view follow-ups.</div></div>';
    return;
  }

  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection('followUps')
      .where('status', '==', 'PENDING')
      .orderBy('dueDate', 'asc')
      .get();

    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-text">No pending follow-ups. All caught up!</div></div>';
      return;
    }

    container.innerHTML = `
      <div class="item-list">
        ${items.map(fu => {
          const overdue = new Date(fu.dueDate) < new Date();
          return `
          <div class="list-item" style="border-left: 4px solid ${overdue ? 'var(--danger)' : 'var(--warning)'}; background: ${overdue ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.05)'}">
            <div class="list-item-main">
              <div class="list-item-title">${escapeHtml(fu.note || fu.type)}</div>
              <div class="list-item-sub">
                <span>${overdue ? '⚠️ Overdue' : '📅'} Due: ${DateUtils.formatDatePacific(fu.dueDate)} · ${DateUtils.formatTimePacific(fu.dueDate)}</span>
                ${fu.type ? `<span>Type: ${escapeHtml(fu.type.replace('_', ' '))}</span>` : ''}
              </div>
            </div>
            <div class="list-item-actions">
              <button class="btn btn-primary btn-sm" onclick="FollowUpService.markComplete('${fu.id}')">✓ Done</button>
              <button class="btn btn-danger btn-sm" onclick="FollowUpService.deleteFollowUp('${fu.id}')">Remove</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Error loading follow-ups: ${escapeHtml(err.message)}</div></div>`;
  }
}

function openFollowUpModal(eventId, eventTitle) {
  const modal = document.getElementById('followUpModal');
  if (!modal) return;

  document.getElementById('followUpEventId').value = eventId || '';
  document.getElementById('followUpEventTitle').innerText = eventTitle || 'Event';
  document.getElementById('followUpNote').value = '';
  document.getElementById('followUpPreset').value = 'morning';
  ModalManager.open('followUpModal');
}

// --------------------------------------------------------------------------
// SETTINGS: Load & Save Notification Settings to Firestore
// --------------------------------------------------------------------------
async function loadNotificationSettings() {
  const settings = await NotificationService.loadSettings();
  const el = id => document.getElementById(id);

  if (el('settingCalendarSync')) el('settingCalendarSync').checked = settings.calendarSync !== false;
  if (el('settingBrowserNotifications')) el('settingBrowserNotifications').checked = settings.browserNotifications !== false;
  if (el('settingSoundAlerts')) el('settingSoundAlerts').checked = settings.soundAlerts !== false;
  if (el('settingFollowUpSuggestions')) el('settingFollowUpSuggestions').checked = settings.followUpSuggestions !== false;
  if (el('settingPersonalEmailReminders')) el('settingPersonalEmailReminders').checked = settings.personalEmailReminders === true;
  if (el('interviewPreparationMinutes')) el('interviewPreparationMinutes').value = String(settings.interviewPreparationMinutes || 30);

  const mins = settings.reminderMinutes || [1440, 60, 30, 15, 5];
  if (el('reminder1440')) el('reminder1440').checked = mins.includes(1440);
  if (el('reminder60')) el('reminder60').checked = mins.includes(60);
  if (el('reminder30')) el('reminder30').checked = mins.includes(30);
  if (el('reminder15')) el('reminder15').checked = mins.includes(15);
  if (el('reminder5')) el('reminder5').checked = mins.includes(5);

  updateNotificationSettingsStatus(settings);
}

async function saveNotificationSettings() {
  const el = id => document.getElementById(id);

  const reminderMinutes = [];
  if (el('reminder1440')?.checked) reminderMinutes.push(1440);
  if (el('reminder60')?.checked) reminderMinutes.push(60);
  if (el('reminder30')?.checked) reminderMinutes.push(30);
  if (el('reminder15')?.checked) reminderMinutes.push(15);
  if (el('reminder5')?.checked) reminderMinutes.push(5);

  const newSettings = {
    calendarSync: el('settingCalendarSync')?.checked ?? true,
    browserNotifications: el('settingBrowserNotifications')?.checked ?? true,
    soundAlerts: el('settingSoundAlerts')?.checked ?? true,
    followUpSuggestions: el('settingFollowUpSuggestions')?.checked ?? true,
    personalEmailReminders: el('settingPersonalEmailReminders')?.checked === true,
    emailReminderMinutes: [30],
    interviewPreparationMinutes: Number(el('interviewPreparationMinutes')?.value) || 30,
    reminderMinutes: reminderMinutes.length > 0 ? [...new Set(reminderMinutes)] : [60, 30, 15]
  };

  NotificationService._settings = null;
  await NotificationService.saveSettings(newSettings);
  updateNotificationSettingsStatus(newSettings);

  await NotificationService.loadSettings();
  NotificationService.scheduleUpcomingAlerts();
  await refreshDashboard();
}

function updateNotificationSettingsStatus(settings) {
  const calStatus = document.getElementById('calSyncStatus');
  const notifStatus = document.getElementById('browserNotifStatus');

  if (calStatus) {
    calStatus.innerText = settings.calendarSync ? 'Enabled' : 'Disabled';
    calStatus.style.background = settings.calendarSync ? 'var(--success-bg)' : 'rgba(107,114,128,0.2)';
    calStatus.style.color = settings.calendarSync ? 'var(--success)' : '#9ca3af';
  }

  if (notifStatus) {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    notifStatus.innerText = settings.browserNotifications && granted ? 'Active' : settings.browserNotifications ? 'Permission Needed' : 'Disabled';
    notifStatus.style.background = settings.browserNotifications && granted ? 'var(--success-bg)' : 'var(--warning-bg)';
    notifStatus.style.color = settings.browserNotifications && granted ? 'var(--success)' : 'var(--warning)';
  }
}

// --------------------------------------------------------------------------
// CALENDAR SYNC STATUS CHECK
// --------------------------------------------------------------------------
async function checkCalendarSyncStatus() {
  const badge = document.getElementById('calendarSyncStatusBadge');
  const text = document.getElementById('calendarSyncStatusText');

  if (!badge || !text) return;

  badge.innerText = 'Checking...';
  text.innerText = 'Verifying Google Calendar connection...';

  try {
    const res = await fetch('/.netlify/functions/calendar-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PING' })
    });
    const data = await res.json();

    if (data.status === 'STANDBY') {
      badge.innerText = 'Not Configured';
      badge.style.background = 'rgba(107,114,128,0.2)';
      badge.style.color = '#9ca3af';
      text.innerText = 'Google Calendar scope not authorized. Re-run OAuth with calendar.events scope.';
    } else if (data.error && data.error.includes('PING')) {
      badge.innerText = 'Connected';
      badge.style.background = 'var(--success-bg)';
      badge.style.color = 'var(--success)';
      text.innerText = 'Google Calendar API ready';
    } else {
      badge.innerText = 'Standby';
      badge.style.background = 'rgba(107,114,128,0.2)';
      badge.style.color = '#9ca3af';
      text.innerText = data.message || data.error || 'Ready for OAuth';
    }
  } catch (err) {
    badge.innerText = 'Unavailable';
    badge.style.background = 'rgba(107,114,128,0.2)';
    badge.style.color = '#9ca3af';
    text.innerText = 'Netlify function unreachable (run locally with netlify dev)';
  }
}

// --------------------------------------------------------------------------
// EVENT DETAILS MODAL — REMINDERS SECTION BUILDER
// --------------------------------------------------------------------------
function buildRemindersSection(eventData) {
  const settings = NotificationService._settings || NotificationService._defaultSettings();
  const mins = settings.reminderMinutes || [1440, 60, 30, 15, 5];

  const indicators = mins.map(m => {
    const label = m === 1440 ? '24h' : m === 60 ? '1h' : m === 15 ? '15m' : m === 5 ? '5m' : `${m}m`;
    return `<span class="badge badge-normal" style="font-size:0.7rem;">${label} before</span>`;
  }).join(' ');

  const syncStatus = eventData.calendarSyncStatus;
  const syncBadge = syncStatus === 'SYNCED'
    ? '<span class="badge" style="background:var(--success-bg);color:var(--success);">📅 Calendar Synced</span>'
    : syncStatus === 'PENDING'
      ? '<span class="badge" style="background:var(--warning-bg);color:var(--warning);">⏳ Sync Pending</span>'
      : '<span class="badge" style="background:rgba(107,114,128,0.2);color:#9ca3af;">Calendar: Not Synced</span>';

  const isInterview = eventData.category === 'INTERVIEW';

  return `
    <div class="event-detail-field" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-color);">
      <div class="event-detail-label">Reminders</div>
      <div class="event-detail-value" style="display:flex;flex-wrap:wrap;gap:0.375rem;align-items:center;">
        ${indicators}
        ${syncBadge}
      </div>
    </div>
    ${isInterview ? `
    <div class="event-detail-field" style="margin-top:0.75rem;">
      <div class="event-detail-label">Follow-up Actions</div>
      <div class="event-detail-value" style="display:flex;flex-wrap:wrap;gap:0.5rem;">
        <button class="btn btn-secondary btn-sm" onclick="openFollowUpModal('${eventData.id}', ${JSON.stringify(escapeHtml(eventData.title))}); ModalManager.close('eventDetailsModal');">+ Schedule Follow-up</button>
      </div>
    </div>` : ''}
  `;
}

// Window load init
window.addEventListener('DOMContentLoaded', () => {
  init().then(() => {
    setupRealtimeListeners();
    NotificationService.init();
  }).catch(err => console.error('Dashboard init failed:', err));
});
