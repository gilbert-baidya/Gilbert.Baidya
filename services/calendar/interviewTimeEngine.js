(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InterviewTimeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MINUTE_MS = 60 * 1000;
  const DEFAULT_PREPARATION_MINUTES = 30;
  const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
  const TIME_ZONE_ALIASES = {
    'india standard time': 'Asia/Kolkata',
    'pacific standard time': 'America/Los_Angeles',
    'mountain standard time': 'America/Denver',
    'central standard time': 'America/Chicago',
    'eastern standard time': 'America/New_York',
    'gmt standard time': 'Europe/London',
    'greenwich standard time': 'Europe/London',
    'coordinated universal time': 'UTC'
  };

  function resolveTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
    const raw = String(value || '').trim();
    const alias = TIME_ZONE_ALIASES[raw.toLowerCase()];
    const candidate = alias || raw;
    if (candidate) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        return { raw: raw || null, timeZone: candidate, valid: true, aliased: Boolean(alias) };
      } catch (error) {}
    }
    return { raw: raw || null, timeZone: fallback, valid: false, aliased: false };
  }

  function normalizeTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
    return resolveTimeZone(value, fallback).timeZone;
  }

  function toDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getEventRange(event) {
    const start = toDate(event?.startAt || event?.normalizedStartAt || event?.start || event?.interviewDate);
    if (!start) return null;
    const end = toDate(event?.endAt || event?.normalizedEndAt || event?.end) || new Date(start.getTime() + 30 * MINUTE_MS);
    return { start, end: end > start ? end : new Date(start.getTime() + 30 * MINUTE_MS) };
  }

  function calculatePreparationWindow(event, preparationMinutes = DEFAULT_PREPARATION_MINUTES) {
    const range = getEventRange(event);
    if (!range) return null;
    const minutes = Math.max(0, Number(preparationMinutes) || DEFAULT_PREPARATION_MINUTES);
    return {
      start: new Date(range.start.getTime() - minutes * MINUTE_MS),
      end: range.start,
      minutes
    };
  }

  function overlapMinutes(firstStart, firstEnd, secondStart, secondEnd) {
    const start = Math.max(firstStart.getTime(), secondStart.getTime());
    const end = Math.min(firstEnd.getTime(), secondEnd.getTime());
    return Math.max(0, Math.ceil((end - start) / MINUTE_MS));
  }

  function sameEvent(interview, event) {
    return interview === event ||
      Boolean(interview?.id && event?.id && interview.id === event.id) ||
      Boolean(interview?.icalUid && event?.icalUid && interview.icalUid === event.icalUid) ||
      Boolean(interview?.googleCalendarEventId && event?.googleCalendarEventId && interview.googleCalendarEventId === event.googleCalendarEventId);
  }

  function uniqueEvents(events) {
    const seen = new Set();
    return (events || []).filter(event => {
      const range = getEventRange(event);
      if (!range || event.status === 'CANCELLED') return false;
      const key = event.id || event.icalUid || event.googleCalendarEventId || `${event.title || ''}|${range.start.toISOString()}|${range.end.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function detectInterviewConflict(interview, events, preparationMinutes = DEFAULT_PREPARATION_MINUTES) {
    const interviewRange = getEventRange(interview);
    const preparation = calculatePreparationWindow(interview, preparationMinutes);
    if (!interviewRange || !preparation) return { level: 'NONE', conflicts: [], availablePreparationMinutes: 0, preparation };

    const conflicts = [];
    const boundaryEvents = [];
    for (const event of uniqueEvents(events)) {
      if (sameEvent(interview, event)) continue;
      const eventRange = getEventRange(event);
      if (eventRange.end.getTime() === preparation.start.getTime()) boundaryEvents.push(event);
      const interviewOverlap = overlapMinutes(interviewRange.start, interviewRange.end, eventRange.start, eventRange.end);
      const preparationOverlap = overlapMinutes(preparation.start, preparation.end, eventRange.start, eventRange.end);
      if (!interviewOverlap && !preparationOverlap) continue;
      conflicts.push({
        event,
        type: interviewOverlap ? 'INTERVIEW' : 'PREPARATION',
        interviewOverlapMinutes: interviewOverlap,
        preparationOverlapMinutes: preparationOverlap
      });
    }

    const interviewConflicts = conflicts.filter(conflict => conflict.interviewOverlapMinutes > 0);
    const prepIntervals = conflicts
      .filter(conflict => conflict.preparationOverlapMinutes > 0)
      .map(conflict => {
        const range = getEventRange(conflict.event);
        return [Math.max(preparation.start.getTime(), range.start.getTime()), Math.min(preparation.end.getTime(), range.end.getTime())];
      })
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of prepIntervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push(interval.slice());
    }
    const occupiedPrepMinutes = Math.round(merged.reduce((total, interval) => total + interval[1] - interval[0], 0) / MINUTE_MS);
    const availablePreparationMinutes = Math.max(0, preparation.minutes - occupiedPrepMinutes);
    const level = interviewConflicts.length ? 'INTERVIEW' : occupiedPrepMinutes ? 'PREPARATION' : 'NONE';

    return { level, conflicts, boundaryEvents, availablePreparationMinutes, preparation };
  }

  function calculateAvailablePrepTime(interview, events, preparationMinutes = DEFAULT_PREPARATION_MINUTES) {
    return detectInterviewConflict(interview, events, preparationMinutes).availablePreparationMinutes;
  }

  function calculateInterviewCountdown(event, nowValue = new Date()) {
    const range = getEventRange(event);
    const now = toDate(nowValue) || new Date();
    if (!range) return { state: 'UNKNOWN', label: 'Time TBD', millisecondsUntilStart: null };
    const untilStart = range.start.getTime() - now.getTime();
    const sinceEnd = now.getTime() - range.end.getTime();

    if (untilStart > 24 * 60 * MINUTE_MS) {
      const days = Math.floor(untilStart / (24 * 60 * MINUTE_MS));
      return { state: 'UPCOMING', label: `Starts in ${days} day${days === 1 ? '' : 's'}`, millisecondsUntilStart: untilStart };
    }
    if (untilStart > 60 * MINUTE_MS) {
      const hours = Math.floor(untilStart / (60 * MINUTE_MS));
      const minutes = Math.floor((untilStart % (60 * MINUTE_MS)) / MINUTE_MS);
      return { state: 'UPCOMING', label: `Starts in ${hours}h ${minutes}m`, millisecondsUntilStart: untilStart };
    }
    if (untilStart > 15 * MINUTE_MS) {
      const minutes = Math.max(1, Math.ceil(untilStart / MINUTE_MS));
      return { state: 'SOON', label: `Starts in ${minutes} minutes`, millisecondsUntilStart: untilStart };
    }
    if (untilStart > MINUTE_MS) {
      const minutes = Math.max(1, Math.ceil(untilStart / MINUTE_MS));
      return { state: 'URGENT', label: `STARTING IN ${minutes} MINUTES`, millisecondsUntilStart: untilStart };
    }
    if (untilStart > -MINUTE_MS) return { state: 'NOW', label: 'STARTING NOW', millisecondsUntilStart: untilStart };
    if (now < range.end) return { state: 'LIVE', label: 'IN PROGRESS', millisecondsUntilStart: untilStart };
    const endedMinutes = Math.max(1, Math.floor(sinceEnd / MINUTE_MS));
    return { state: 'ENDED', label: `Ended ${endedMinutes} minute${endedMinutes === 1 ? '' : 's'} ago`, millisecondsUntilStart: untilStart };
  }

  function getContextLabel(event, nowValue = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const range = getEventRange(event);
    const now = toDate(nowValue) || new Date();
    if (!range) return '';
    const zone = normalizeTimeZone(timeZone);
    const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
    const eventKey = dateKey(range.start);
    if (eventKey === dateKey(now)) return 'TODAY';
    if (eventKey === dateKey(new Date(now.getTime() + 24 * 60 * MINUTE_MS))) return 'TOMORROW';
    const days = Math.floor((range.start.getTime() - now.getTime()) / (24 * 60 * MINUTE_MS));
    if (days >= 0 && days < 7) return 'THIS WEEK';
    if (days >= 7 && days < 14) return 'NEXT WEEK';
    return 'UPCOMING';
  }

  function formatInterviewDateTime(event, timeZone) {
    const range = getEventRange(event);
    if (!range) return null;
    const zone = normalizeTimeZone(timeZone || event.displayTimezone || DEFAULT_TIME_ZONE);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(range.start).toUpperCase();
    const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(range.start).toUpperCase();
    const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(range.start).find(part => part.type === 'timeZoneName')?.value || zone;
    return {
      weekday,
      date,
      startTime: timeFormatter.format(range.start),
      endTime: timeFormatter.format(range.end),
      timeZone: zoneName,
      label: `${timeFormatter.format(range.start)} – ${timeFormatter.format(range.end)} ${zoneName}`
    };
  }

  function formatLocalDateTime(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = toDate(value);
    if (!date) return { date: '', time: '' };
    const zone = normalizeTimeZone(timeZone);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }

  function zonedDateTimeToIso(parts, timeZone = DEFAULT_TIME_ZONE) {
    const zone = normalizeTimeZone(timeZone);
    const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const offsetAt = timestamp => {
      const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
      return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) - timestamp;
    };
    const firstPass = wallClockUtc - offsetAt(wallClockUtc);
    return new Date(wallClockUtc - offsetAt(firstPass)).toISOString();
  }

  function sortInterviews(interviews) {
    return [...(interviews || [])].sort((first, second) => {
      const firstRange = getEventRange(first);
      const secondRange = getEventRange(second);
      if (!firstRange) return 1;
      if (!secondRange) return -1;
      return firstRange.start - secondRange.start;
    });
  }

  return {
    DEFAULT_PREPARATION_MINUTES,
    DEFAULT_TIME_ZONE,
    resolveTimeZone,
    normalizeTimeZone,
    calculateInterviewCountdown,
    calculatePreparationWindow,
    detectInterviewConflict,
    calculateAvailablePrepTime,
    formatInterviewDateTime,
    formatLocalDateTime,
    zonedDateTimeToIso,
    getContextLabel,
    sortInterviews
  };
});
