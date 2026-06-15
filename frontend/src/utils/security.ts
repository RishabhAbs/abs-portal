/**
 * Security Utilities
 * Provides protection against casual data extraction attempts
 */

// DevTools detection using various methods
let devToolsOpen = false;
let devToolsWarningShown = false;

const detectDevTools = () => {
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;

    if (widthThreshold || heightThreshold) {
        if (!devToolsOpen) {
            devToolsOpen = true;
            handleDevToolsOpen();
        }
    } else {
        devToolsOpen = false;
    }
};

// Alternative DevTools detection using debugger timing
const detectDevToolsDebugger = () => {
    const start = performance.now();
    // This line will pause if DevTools is open with breakpoints
    // eslint-disable-next-line no-debugger
    debugger;
    const end = performance.now();

    if (end - start > 100) {
        handleDevToolsOpen();
    }
};

const handleDevToolsOpen = () => {
    if (!devToolsWarningShown) {
        devToolsWarningShown = true;
        console.clear();
        console.log('%c⚠️ SECURITY WARNING', 'color: red; font-size: 40px; font-weight: bold;');
        console.log('%cThis is a secure application. Unauthorized data extraction is prohibited.', 'color: orange; font-size: 16px;');
        console.log('%cAll activities are monitored and logged.', 'color: gray; font-size: 14px;');
    }
};

// Disable right-click context menu
const disableRightClick = () => {
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
};

// Disable text selection
const disableTextSelection = () => {
    document.addEventListener('selectstart', (e) => {
        // Allow selection in input fields
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return true;
        }
        e.preventDefault();
        return false;
    });

    // Add CSS to prevent selection
    const style = document.createElement('style');
    style.textContent = `
    * {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
    }
    input, textarea, [contenteditable="true"] {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      user-select: text !important;
    }
  `;
    document.head.appendChild(style);
};

// Disable keyboard shortcuts for DevTools and view source
const disableKeyboardShortcuts = () => {
    document.addEventListener('keydown', (e) => {
        // F12
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }
        // Ctrl+Shift+I (DevTools)
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            return false;
        }
        // Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && e.key === 'J') {
            e.preventDefault();
            return false;
        }
        // Ctrl+U (View Source)
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
            return false;
        }
        // Ctrl+S (Save)
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            return false;
        }
        // Ctrl+P (Print)
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            return false;
        }
        return true;
    });
};

// Clear console periodically
const clearConsolePeriodically = () => {
    // Initial clear
    console.clear();

    // Clear every 5 seconds
    setInterval(() => {
        if (devToolsOpen) {
            console.clear();
            console.log('%c⚠️ SECURITY WARNING', 'color: red; font-size: 20px; font-weight: bold;');
        }
    }, 5000);
};

// Disable console methods in production
const disableConsoleMethods = () => {
    if (process.env.NODE_ENV === 'production') {
        const noop = () => { };
        console.log = noop;
        console.warn = noop;
        console.error = noop;
        console.info = noop;
        console.debug = noop;
        console.table = noop;
    }
};

// Initialize all security measures
export const initSecurityProtections = () => {
    // Only enable in production or when explicitly set
    const isProtectionEnabled = process.env.NODE_ENV === 'production' ||
        process.env.REACT_APP_ENABLE_SECURITY === 'true';

    if (!isProtectionEnabled) {
        return;
    }

    // Initialize protections
    disableRightClick();
    disableTextSelection();
    disableKeyboardShortcuts();
    disableConsoleMethods();
    clearConsolePeriodically();

    // DevTools detection - check periodically
    setInterval(detectDevTools, 1000);

    // Log security initialization
};

export default initSecurityProtections;
