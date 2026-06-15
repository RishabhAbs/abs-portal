/**
 * Get current date in IST (Asia/Kolkata) timezone as YYYY-MM-DD string
 */
export const getISTDateString = (date: Date = new Date()): string => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    return `${year}-${month}-${day}`;
};

/**
 * Get current date/time in IST (Asia/Kolkata) as ISO-like string
 */
export const getISTISOString = (date: Date = new Date()): string => {
    return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date).replace(/(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/, '$3-$2-$1T$4:$5:$6');
};

/**
 * Get date components (year, month, day) in IST
 */
export const getISTComponents = (date: Date) => {
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
    return {
        year: parseInt(y || '0'),
        month: parseInt(m || '0') - 1,
        day: parseInt(d || '0')
    };
};
/**
 * Add months to a date string (YYYY-MM-DD) and return YYYY-MM-DD in IST
 */
export const addISTMonths = (dateStr: string, months: number): string => {
    const { year, month, day } = getISTComponents(new Date(dateStr));
    const targetDate = new Date(year, month + months, day);
    return getISTDateString(targetDate);
};

/**
 * Add days to a date string (YYYY-MM-DD) and return YYYY-MM-DD in IST
 */
export const addISTDays = (dateStr: string, days: number): string => {
    const { year, month, day } = getISTComponents(new Date(dateStr));
    const targetDate = new Date(year, month, day + days);
    return getISTDateString(targetDate);
};
