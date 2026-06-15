// Date formatting utility - DD/MM/YYYY format site-wide
export const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';

  let dateOnly = dateStr;

  // If it's ISO format with time, extract just the date part
  if (dateStr.includes('T')) {
    dateOnly = dateStr.split('T')[0];
  }

  // Parse YYYY-MM-DD format directly (avoids timezone issues)
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }

  // Handle MM/DD/YYYY or other formats - extract numbers
  const parts = dateOnly.match(/(\d+)/g);
  if (parts && parts.length >= 3) {
    // If first part is 4 digits, assume YYYY-MM-DD order
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
    // Otherwise assume it's already in some day/month/year format
    // Just return as DD/MM/YYYY
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }

  return '-';
};

// Convert Year, Month, Day numbers to YYYY-MM-DD string using Asia/Kolkata (IST)
// Uses a noon UTC baseline to be 100% immune to local timezone shifts.
export const toLocalDateString = (date: Date = new Date()): string => {
  // If we only have y, m, d, we should use noon UTC
  // But for an existing Date object, we just format it to IST
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
};

// Construct a Date object at 12:00 UTC to ensure same-day IST formatting
export const getSafeISTDate = (year: number, month: number, day: number): Date => {
  return new Date(Date.UTC(year, month, day, 12, 0, 0));
};

// Extract Year, Month, Day from a string (supports YYYY-MM-DD or DD/MM/YYYY)
// Crucially, it NEVER uses the Date constructor which is prone to timezone shifts.
export const getISTDateParts = (dateStr: string) => {
  if (!dateStr || dateStr === '-') return { year: 0, month: 0, day: 0 };

  const cleanDate = dateStr.split('T')[0];
  let year = 0, month = 0, day = 0;

  // Handle YYYY-MM-DD
  if (cleanDate.includes('-')) {
    const p = cleanDate.split('-');
    if (p.length === 3) {
      year = parseInt(p[0]);
      month = parseInt(p[1]) - 1; // 0-indexed
      day = parseInt(p[2]);
    }
  }
  // Handle DD/MM/YYYY
  else if (cleanDate.includes('/')) {
    const p = cleanDate.split('/');
    if (p.length === 3) {
      // If first part is 4 digits, it's YYY-MM-DD with slashes (rare but possible)
      if (p[0].length === 4) {
        year = parseInt(p[0]);
        month = parseInt(p[1]) - 1;
        day = parseInt(p[2]);
      } else {
        day = parseInt(p[0]);
        month = parseInt(p[1]) - 1;
        year = parseInt(p[2]);
      }
    }
  }

  return { year, month, day };
};

// Robust helper to get days in a month (leap-year aware)
export const getDaysInMonth = (year: number, month: number): number => {
  // month is 0-indexed
  return new Date(year, month + 1, 0).getDate();
};
