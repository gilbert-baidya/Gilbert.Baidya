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

  formatTimePacific(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return isoString;
    }
  },

  formatDateTimeRange(startIso, endIso) {
    if (!startIso) return '—';
    const dateStr = this.formatDatePacific(startIso);
    const startStr = this.formatTimePacific(startIso);
    const endStr = endIso ? this.formatTimePacific(endIso) : '';
    return endStr ? `${dateStr} · ${startStr} – ${endStr} (PT)` : `${dateStr} · ${startStr} (PT)`;
  },

  combineDateAndTimeToISO(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    // Assemble local date time object in Pacific context
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const localDate = new Date(year, month - 1, day, hours, minutes, 0);
    return localDate.toISOString();
  },

  splitISOToDateAndTime(isoString) {
    if (!isoString) return { date: '', time: '' };
    const d = new Date(isoString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`
    };
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

    return {
      iCalUid: uid,
      title: summary.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, '\n'),
      start: dtstart || new Date().toISOString(),
      end: dtend || new Date(Date.now() + 3600000).toISOString(),
      location: location.replace(/\\,/g, ','),
      meetingUrl: meetingUrl,
      notes: description.replace(/\\n/g, '\n'),
      category: summary.toLowerCase().includes('interview') ? 'INTERVIEW' : 'OTHER',
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
      return {
        title: title.slice(0, 80),
        company: emailText.includes('interview') ? 'Company' : '',
        position: '',
        date: new Date().toISOString().split('T')[0],
        startTime: '10:00',
        endTime: '11:00',
        timezone: DEFAULT_TIMEZONE,
        meetingUrl: urlMatch ? urlMatch[0] : '',
        category: emailText.toLowerCase().includes('interview') ? 'INTERVIEW' : 'OTHER',
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
  open(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  },

  close(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
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
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
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
  await refreshDashboard();
  checkOllamaStatus();
}

async function refreshDashboard() {
  const [events, tasks, interviews, jobs, intakeItems] = await Promise.all([
    fetchCollection('events'),
    fetchCollection('tasks'),
    fetchCollection('interviews'),
    fetchCollection('jobs'),
    fetchCollection('emailIntake')
  ]);

  renderTodaySchedule(events);
  renderPriorities(tasks, events, interviews);
  renderUpcomingInterviews(interviews);
  renderConflicts(events);
  renderTasks(tasks);
  renderInterviews(interviews);
  renderJobs(jobs);
  renderEmailIntake(intakeItems);

  if (calendar) calendar.refetchEvents();
}

async function fetchCollection(collectionName) {
  if (!currentUser) return [];
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection(collectionName).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error(`Error fetching collection ${collectionName}:`, err);
    return [];
  }
}

// ==========================================================================
// CALENDAR SETUP & FULLCALENDAR BINDINGS
// ==========================================================================

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
          let color = '#2563eb';
          if (e.category === 'INTERVIEW') color = '#8b5cf6';
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
            id: e.id,
            title: `${sourceIndicator} ${e.title || '(No Title)'}`,
            start: e.start,
            end: e.end,
            backgroundColor: color,
            borderColor: color,
            extendedProps: e
          };
        });
        successCallback(formatted);
      } catch (err) {
        failCallback(err);
      }
    },
    dateClick: (info) => {
      openAddEventModal(info.dateStr);
    },
    eventClick: (info) => {
      const eventData = {
        ...info.event.extendedProps,
        id: info.event.id,
        title: info.event.extendedProps.title || info.event.title,
        start: info.event.start?.toISOString() || info.event.extendedProps.start,
        end: info.event.end?.toISOString() || info.event.extendedProps.end
      };
      openEventDetailsModal(eventData);
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

  if (todayEvents.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-text">No events scheduled today. Enjoy your day or schedule focus time!</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${todayEvents.map(e => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${escapeHtml(e.title)}</div>
            <div class="list-item-sub">
              <span>🕒 ${DateUtils.formatTimePacific(e.start)} – ${DateUtils.formatTimePacific(e.end)}</span>
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

  const upcoming = (interviews || []).filter(i => {
    if (!i.interviewDate) return false;
    return new Date(i.interviewDate) >= new Date(new Date().setHours(0,0,0,0));
  }).sort((a, b) => new Date(i.interviewDate) - new Date(b.interviewDate)).slice(0, 5);

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
            <div class="list-item-sub">${escapeHtml(i.position || 'Interview')} · ${DateUtils.formatDatePacific(i.interviewDate)}</div>
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
              ${t.dueDate ? `<span>📅 Due: ${t.dueDate} ${t.dueTime || ''}</span>` : ''}
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

function renderInterviews(interviews) {
  const container = document.getElementById('interviewsListContainer');
  if (!container) return;

  if (!interviews || interviews.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💼</div><div class="empty-state-text">No interviews currently in pipeline. Add an upcoming interview round!</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="item-list">
      ${interviews.map(i => `
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">${escapeHtml(i.company)} — <span style="font-weight:400; color:var(--text-secondary);">${escapeHtml(i.position)}</span></div>
            <div class="list-item-sub">
              <span>📅 ${i.interviewDate ? DateUtils.formatDatePacific(i.interviewDate) : 'Date TBD'}</span>
              <span>🗣️ Format: ${i.interviewType || 'Google Meet'}</span>
              ${i.recruiter ? `<span>👤 Recruiter: ${escapeHtml(i.recruiter)}</span>` : ''}
              ${i.meetingUrl ? `<span>🔗 <a href="${escapeHtml(i.meetingUrl)}" target="_blank" style="color:var(--primary);">Meeting Link</a></span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <span class="badge badge-interview">${i.stage || 'TECHNICAL'}</span>
            <button class="btn btn-secondary btn-sm" onclick='editInterviewModal("${i.id}")'>Edit</button>
            <button class="btn btn-danger btn-sm" onclick='deleteInterviewConfirm("${i.id}")'>Delete</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
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
    await db.collection('users').doc(currentUser.uid).collection('events').add({
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
        category: document.getElementById('eventCategory').value,
        priority: document.getElementById('eventPriority').value,
        company: document.getElementById('eventCompany').value.trim(),
        position: document.getElementById('eventPosition').value.trim(),
        meetingUrl: document.getElementById('eventMeetingUrl').value.trim(),
        status: document.getElementById('eventStatus').value,
        notes: document.getElementById('eventNotes').value.trim(),
        timezone: DEFAULT_TIMEZONE,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (payload.category === 'INTERVIEW') {
        payload.interviewStage = document.getElementById('eventInterviewStage').value;
        payload.interviewType = document.getElementById('eventInterviewType').value;
        payload.recruiter = document.getElementById('eventRecruiter').value.trim();
      }

      if (eventId) {
        await db.collection('users').doc(currentUser.uid).collection('events').doc(eventId).update(payload);
        showToast('Event updated successfully');
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('events').add(payload);
        showToast('Event created successfully');
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
        await db.collection('users').doc(currentUser.uid).collection('events').add({
          ...normalized,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('users').doc(currentUser.uid).collection('emailIntake').add({
          ...normalized,
          status: 'AUTO_ADD',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast(`New calendar event automatically added: ${normalized.title}`);
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
  let category = cand.category;
  if (!category) {
    if (/interview|screening|recruiter|technical/i.test(combined)) category = 'INTERVIEW';
    else if (/church|worship|service/i.test(combined)) category = 'CHURCH';
    else if (/focus|deep work/i.test(combined)) category = 'FOCUS';
    else if (/doctor|dentist|appointment/i.test(combined)) category = 'PERSONAL';
    else category = 'OTHER';
  }

  return {
    title: cand.title || 'Forwarded Event',
    company: cand.company || '',
    position: cand.position || '',
    category,
    start: cand.start,
    end: cand.end,
    timezone: cand.timezone || DEFAULT_TIMEZONE,
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

function openAddEventModal(dateStr = '') {
  document.getElementById('eventForm').reset();
  document.getElementById('eventId').value = '';
  document.getElementById('eventModalTitle').innerText = 'Add Event';
  document.getElementById('eventDate').value = dateStr || new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
  document.getElementById('eventCategory').value = 'OTHER';
  document.getElementById('eventPriority').value = 'NORMAL';
  document.getElementById('eventStatus').value = 'CONFIRMED';
  document.getElementById('interviewSpecificFields').style.display = 'none';
  ModalManager.open('eventModal');
}

async function openEventDetailsModalById(eventId) {
  const doc = await db.collection('users').doc(currentUser.uid).collection('events').doc(eventId).get();
  if (!doc.exists) {
    showToast('Event no longer exists.', 'error');
    return;
  }
  openEventDetailsModal({ id: doc.id, ...doc.data() });
}

function openEventDetailsModal(eventData) {
  if (!eventData?.id) {
    showToast('Unable to open event details.', 'error');
    return;
  }

  const optionalRow = (label, value, renderedValue = '') => value ? `
    <div class="event-detail-field">
      <div class="event-detail-label">${escapeHtml(label)}</div>
      <div class="event-detail-value">${renderedValue || escapeHtml(String(value))}</div>
    </div>` : '';
  const meetingUrl = /^https?:\/\//i.test(eventData.meetingUrl || '') ? eventData.meetingUrl : '';
  const locationUrl = /^https?:\/\//i.test(eventData.location || '') ? eventData.location : '';
  const organizerEmail = String(eventData.organizer || '').replace(/^mailto:/i, '');
  const notes = eventData.notes || eventData.description || '';
  const imported = eventData.source === 'EMAIL_INTAKE';

  document.getElementById('detailsTitle').innerText = eventData.title || 'Event Details';
  document.getElementById('eventDetailsBody').innerHTML = `
    <div class="event-detail-badges">
      <span class="badge badge-${escapeHtml((eventData.category || 'other').toLowerCase())}">${escapeHtml(eventData.category || 'OTHER')}</span>
      <span class="badge badge-normal">${escapeHtml(eventData.status || 'CONFIRMED')}</span>
      ${imported ? '<span class="badge badge-normal">Email Imported</span>' : '<span class="badge badge-normal">Manual</span>'}
      ${eventData.parserUsed ? `<span class="badge badge-normal">${escapeHtml(eventData.parserUsed)}</span>` : ''}
    </div>
    <div class="form-row-3">
      ${optionalRow('Date', DateUtils.formatDatePacific(eventData.start))}
      ${optionalRow('Start Time', DateUtils.formatTimePacific(eventData.start))}
      ${optionalRow('End Time', DateUtils.formatTimePacific(eventData.end))}
    </div>
    <div class="form-row">
      ${optionalRow('Priority', eventData.priority)}
      ${optionalRow('Company', eventData.company)}
    </div>
    ${optionalRow('Position / Role', eventData.position)}
    ${optionalRow('Location', eventData.location, locationUrl ? `<a href="${escapeHtml(locationUrl)}" target="_blank" rel="noopener noreferrer">Open location</a>` : '')}
    <div class="form-row">
      ${optionalRow('Interview Stage', eventData.interviewStage)}
      ${optionalRow('Interview Format', eventData.interviewType)}
    </div>
    ${optionalRow('Organizer', eventData.organizer, organizerEmail ? `<a href="mailto:${escapeHtml(organizerEmail)}">${escapeHtml(organizerEmail)}</a>` : '')}
    ${optionalRow('Source', imported ? 'Email Imported' : eventData.source || 'Manual')}
    ${optionalRow('Original Subject', eventData.originalSubject)}
    ${optionalRow('Received', eventData.receivedAt ? DateUtils.formatDateTimeRange(eventData.receivedAt, null) : '')}
    ${optionalRow('Processed', eventData.processedAt ? DateUtils.formatDateTimeRange(eventData.processedAt, null) : '')}
    ${notes ? `<details class="event-detail-notes"><summary>Notes / Preparation</summary><div>${escapeHtml(notes)}</div></details>` : ''}
    ${meetingUrl ? `<a class="btn btn-primary" href="${escapeHtml(meetingUrl)}" target="_blank" rel="noopener noreferrer">Join Meeting</a>` : ''}
  `;

  document.getElementById('detailsEditBtn').onclick = () => {
    ModalManager.close('eventDetailsModal');
    editEventModal(eventData);
  };
  document.getElementById('detailsDeleteBtn').onclick = () => {
    ModalManager.close('eventDetailsModal');
    deleteEvent(eventData.id, eventData.title);
  };
  ModalManager.open('eventDetailsModal');
}

function editEventModal(eventData) {
  document.getElementById('eventForm').reset();
  document.getElementById('eventId').value = eventData.id;
  document.getElementById('eventModalTitle').innerText = 'Edit Event';
  document.getElementById('eventTitle').value = eventData.title || '';

  if (eventData.start) {
    const start = DateUtils.splitISOToDateAndTime(eventData.start);
    document.getElementById('eventDate').value = start.date;
    document.getElementById('eventStartTime').value = start.time;
  }
  if (eventData.end) document.getElementById('eventEndTime').value = DateUtils.splitISOToDateAndTime(eventData.end).time;

  document.getElementById('eventCategory').value = eventData.category || 'OTHER';
  document.getElementById('eventPriority').value = eventData.priority || 'NORMAL';
  document.getElementById('eventCompany').value = eventData.company || '';
  document.getElementById('eventPosition').value = eventData.position || '';
  document.getElementById('eventMeetingUrl').value = eventData.meetingUrl || '';
  document.getElementById('eventStatus').value = eventData.status || 'CONFIRMED';
  document.getElementById('eventNotes').value = eventData.notes || eventData.description || '';
  document.getElementById('eventInterviewStage').value = eventData.interviewStage || 'TECHNICAL';
  document.getElementById('eventInterviewType').value = eventData.interviewType || 'Other';
  document.getElementById('eventRecruiter').value = eventData.recruiter || '';
  document.getElementById('interviewSpecificFields').style.display = eventData.category === 'INTERVIEW' ? 'block' : 'none';
  ModalManager.open('eventModal');
}

function deleteEvent(eventId, title) {
  ModalManager.confirm(`Delete "${title || 'this event'}"? This action cannot be undone.`, async () => {
    try {
      await db.collection('users').doc(currentUser.uid).collection('events').doc(eventId).delete();
      showToast('Event deleted');
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

// Window load init
window.addEventListener('DOMContentLoaded', () => {
  init().then(() => setupRealtimeListeners()).catch(err => console.error('Dashboard init failed:', err));
});

