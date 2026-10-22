export function formatTimestamp(ts: any): string {
  if (!ts) return '—';

  let date: Date;

  if (typeof ts?.toDate === 'function') {
    date = ts.toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (ts?.seconds) {
    date = new Date(ts.seconds * 1000);
  } else {
    return '—';
  }

  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function formatTimeOnly(ts: any): string {
  if (!ts) return '—';
  let date: Date;
  if (typeof ts?.toDate === 'function') {
    date = ts.toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (ts?.seconds) {
    date = new Date(ts.seconds * 1000);
  } else {
    return '—';
  }
  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(date);
}

export function formatRelativeTime(ts: any): string {
  if (!ts) return 'Never';
  let date: Date;
  if (typeof ts?.toDate === 'function') {
    date = ts.toDate();
  } else if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'number') {
    date = new Date(ts);
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (ts?.seconds) {
    date = new Date(ts.seconds * 1000);
  } else {
    return '—';
  }
  if (isNaN(date.getTime())) return '—';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
