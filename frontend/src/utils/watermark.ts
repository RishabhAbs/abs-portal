/**
 * Watermarking Utility
 * Injects invisible characters into text to trace leaks to specific users/sessions.
 */

// Zero-width characters that are invisible but detectable
const ZERO_WIDTH_CHARS = [
    '\u200B', // Zero Width Space
    '\u200C', // Zero Width Non-Joiner
    '\u200D', // Zero Width Joiner
    '\uFEFF'  // Zero Width No-Break Space
];

/**
 * Encodes a simple numeric ID (like user ID hash) into a sequence of zero-width characters
 * and appends them to the text.
 */
export const addWatermark = (text: string, identifier: string): string => {
    if (!text) return text;

    // Simple hash of identifier to stay short
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
        hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
        hash |= 0;
    }
    hash = Math.abs(hash);

    // Convert hash to base-4 (since we have 4 zero-width chars)
    let watermark = '';
    const hashStr = hash.toString(4);

    for (let i = 0; i < hashStr.length; i++) {
        watermark += ZERO_WIDTH_CHARS[parseInt(hashStr[i])];
    }

    return text + watermark;
};

/**
 * Extracts potential watermark from text (for verification)
 */
export const extractWatermark = (text: string): string | null => {
    let extracted = '';
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // Check if it's one of our zero-width chars
        if (code === 0x200B || code === 0x200C || code === 0x200D || code === 0xFEFF) {
            extracted += '\\u' + code.toString(16).toUpperCase();
        }
    }
    return extracted || null;
};
