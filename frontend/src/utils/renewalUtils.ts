import { getISTDateParts, getSafeISTDate, toLocalDateString, getDaysInMonth } from './dateUtils';
import { Activity } from '../context/DataContext';

export interface RenewalConfig {
    start_from: string;
    new_expiry_date: string;
    billing_cycle: string;
    billing_mode: string;
    billing_units: number;
    last_bill_rate: number;
    purchase_units: number;
    purchase_rate: number;
}

// Logic to calculate the "Next" activity configuration based on:
// 1. Previous Activity (for context)
// 2. Server/Mapping details
// 3. Cycle/Mode definitions
export const calculateNextActivityConfig = (
    lastExpiryDate: string | null, // The NEW expiry date of the *previous* activity
    cycle: string,
    mode: 'day_to_day' | 'month_to_month',
    billRate: number,
    billUnits: number,
    purchaseRate: number,
    purchaseUnits: number
): RenewalConfig => {

    // 1. Calculate Start Date: Expiry + 1 Day (or Today if no expiry)
    let startFrom = toLocalDateString();
    if (lastExpiryDate) {
        const { year, month, day } = getISTDateParts(lastExpiryDate);
        const safeExpiry = getSafeISTDate(year, month, day);
        safeExpiry.setDate(safeExpiry.getDate() + 1);
        startFrom = toLocalDateString(safeExpiry);
    }

    // 2. Calculate New Expiry based on Cycle & Mode
    const { year, month, day } = getISTDateParts(startFrom);
    let newExpiry = '';
    const cycleMonths = cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Half-Yearly' ? 6 : 12;

    if (mode === 'month_to_month') {
        // M2M: End of Cycle Month
        // Target Month = Start Month + (Cycle Months - 1)
        let targetYear = year;
        let targetMonth = month + (cycleMonths - 1);

        // Normalize month/year overflow
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }

        const lastDay = getDaysInMonth(targetYear, targetMonth);
        newExpiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, lastDay));
    } else {
        // D2D: Start Date + Cycle Months (Exact Date)
        let targetYear = year;
        let targetMonth = month + cycleMonths;

        // Normalize month/year overflow
        while (targetMonth > 11) { targetYear += 1; targetMonth -= 12; }

        // Handle days overflow (e.g. Jan 31 + 1 month = Feb 28/29)
        const maxDays = getDaysInMonth(targetYear, targetMonth);
        const targetDay = Math.min(day, maxDays);

        newExpiry = toLocalDateString(getSafeISTDate(targetYear, targetMonth, targetDay));
    }

    return {
        start_from: startFrom,
        new_expiry_date: newExpiry,
        billing_cycle: cycle,
        billing_mode: mode,
        billing_units: billUnits,
        last_bill_rate: billRate,
        purchase_units: purchaseUnits,
        purchase_rate: purchaseRate
    };
};
