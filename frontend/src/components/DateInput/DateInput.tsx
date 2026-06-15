import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';

interface DateInputProps {
    value: string; // Expected in YYYY-MM-DD format
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

// Convert YYYY-MM-DD to DD/MM/YYYY for display
const toDisplayFormat = (isoDate: string): string => {
    if (!isoDate) return '';
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        const [, year, month, day] = match;
        return `${day}/${month}/${year}`;
    }
    return isoDate;
};

// Convert DD/MM/YYYY to YYYY-MM-DD for value
const toISOFormat = (displayDate: string): string => {
    if (!displayDate) return '';
    const match = displayDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
        const [, day, month, year] = match;
        return `${year}-${month}-${day}`;
    }
    return displayDate;
};

// Validate DD/MM/YYYY format
const isValidDisplayFormat = (str: string): boolean => {
    const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false;
    const [, day, month, year] = match;
    const d = parseInt(day), m = parseInt(month), y = parseInt(year);
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    if (y < 1900 || y > 2100) return false;
    // Basic days-in-month validation
    const daysInMonth = new Date(y, m, 0).getDate();
    return d <= daysInMonth;
};

const DateInput: React.FC<DateInputProps> = ({
    value,
    onChange,
    placeholder = 'dd/mm/yyyy',
    className = '',
    disabled = false
}) => {
    const [displayValue, setDisplayValue] = useState(toDisplayFormat(value));
    const [showPicker, setShowPicker] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const pickerRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sync display value when prop changes
    useEffect(() => {
        setDisplayValue(toDisplayFormat(value));
    }, [value]);

    // Handle text input changes
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let input = e.target.value;

        // Auto-add slashes as user types
        const nums = input.replace(/\D/g, '');
        if (nums.length <= 2) {
            input = nums;
        } else if (nums.length <= 4) {
            input = `${nums.slice(0, 2)}/${nums.slice(2)}`;
        } else {
            input = `${nums.slice(0, 2)}/${nums.slice(2, 4)}/${nums.slice(4, 8)}`;
        }

        setDisplayValue(input);

        // Only update parent if valid complete date
        if (isValidDisplayFormat(input)) {
            onChange(toISOFormat(input));
        }
    };

    // Handle blur - validate and format
    const handleBlur = () => {
        if (displayValue && !isValidDisplayFormat(displayValue)) {
            // Reset to last valid value
            setDisplayValue(toDisplayFormat(value));
        }
    };

    // Handle native date picker change
    const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        if (newValue) {
            onChange(newValue);
            setDisplayValue(toDisplayFormat(newValue));
        }
        setShowPicker(false);
    };

    // Close picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowPicker(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <input
                ref={inputRef}
                type="text"
                value={displayValue}
                onChange={handleInputChange}
                onBlur={handleBlur}
                placeholder={placeholder}
                disabled={disabled}
                className="w-full pr-8 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none disabled:bg-gray-100"
                maxLength={10}
            />
            <button
                type="button"
                onClick={() => {
                    if (!disabled) {
                        setShowPicker(!showPicker);
                        setTimeout(() => pickerRef.current?.showPicker?.(), 0);
                    }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                disabled={disabled}
                tabIndex={-1}
            >
                <Calendar className="h-4 w-4" />
            </button>

            {/* Hidden native date picker for calendar popup */}
            <input
                ref={pickerRef}
                type="date"
                value={value}
                onChange={handlePickerChange}
                className="absolute opacity-0 w-0 h-0 pointer-events-none"
                tabIndex={-1}
            />
        </div>
    );
};

export default DateInput;
