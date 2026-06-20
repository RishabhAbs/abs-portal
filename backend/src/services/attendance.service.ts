import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { DbService } from '../database/db.service';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class AttendanceService implements OnModuleInit {
  constructor(
    private db: DbService
  ) {}

  async onModuleInit() {
    try {
      // 1. Office details table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS office_check_in_out_details_new (
          id INT AUTO_INCREMENT PRIMARY KEY,
          office_name VARCHAR(255) NOT NULL,
          latitude DECIMAL(10, 8) NOT NULL,
          longitude DECIMAL(11, 8) NOT NULL,
          radius INT DEFAULT 100,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 2. User attendance records table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS user_checkin_checkout_details_new (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(50) NOT NULL,
          date DATE NOT NULL,
          checkin_time TIME,
          checkin_latitude DECIMAL(10, 8),
          checkin_longitude DECIMAL(11, 8),
          checkin_address TEXT,
          checkout_time TIME,
          checkout_latitude DECIMAL(10, 8),
          checkout_longitude DECIMAL(11, 8),
          checkout_address TEXT,
          working_hours TIME,
          status ENUM('Present', 'Absent', 'Pending') DEFAULT 'Pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_user_date (user_id, date)
        )
      `);

      // 3. User location history (for path tracking)
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS user_location_history (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(50) NOT NULL,
          latitude DECIMAL(10, 8) NOT NULL,
          longitude DECIMAL(11, 8) NOT NULL,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          KEY idx_user_time (user_id, recorded_at)
        )
      `);

      // 4. Holidays table
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS cloud_attendance_holidays (
          id INT AUTO_INCREMENT PRIMARY KEY,
          holiday_date DATE NOT NULL UNIQUE,
          description VARCHAR(255),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

    } catch (error) {
      console.error('AttendanceService: Schema sync error:', error.message);
    }
  }

  // Helper to get current date in IST (YYYY-MM-DD)
  private getISTDate(): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).split('/').reverse().join('-');
  }

  // Helper to get current time in IST (HH:MM:SS)
  private getISTTime(): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  // Haversine formula to calculate distance in meters
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  async validateLocation(lat: number, lng: number): Promise<{ valid: boolean; office?: any }> {
    const offices = await this.db.query<any>(`SELECT * FROM office_check_in_out_details_new`);
    
    console.log(`[Attendance] Validating loc: ${lat}, ${lng}`);
    for (const office of offices) {
      const distance = this.calculateDistance(lat, lng, parseFloat(office.latitude), parseFloat(office.longitude));
      console.log(`[Attendance] Office: ${office.office_name} (${office.latitude}, ${office.longitude}) vs User (${lat}, ${lng}), Dist: ${distance}m`);
      if (distance <= office.radius) {
        console.log(`[Attendance] Match found!`);
        return { valid: true, office };
      }
    }
    
    return { valid: false };
  }

  async checkIn(userId: string, lat: number, lng: number) {
    // 1. Check if already checked in today
    const today = this.getISTDate();
    const existing = await this.db.queryOne<any>(`
      SELECT * FROM user_checkin_checkout_details_new 
      WHERE user_id = ? AND date = ?
    `, [userId, today]);

    if (existing) {
      if (existing.checkout_time) {
        throw new BadRequestException('You have already completed your attendance for today.');
      }
      if (existing.checkin_time) {
        throw new BadRequestException('You have already checked in today.');
      }
    }

    // 2. Fetch User Tag (Inside vs Outside)
    const user = await this.db.queryOne<any>(`SELECT tag, name FROM cloud_users WHERE id = ?`, [userId]);
    const isInside = user?.tag === 'Inside' || !user?.tag; // Default to Inside if null
    console.log(`[Attendance] CheckIn Request: User=${user?.name}, ID=${userId}, Tag=${user?.tag}, IsInside=${isInside}, Lat=${lat}, Lng=${lng}`);

    // 3. Validate Geofence
    // For Outside users, we still want to find the NEAREST office for the record,
    // but we don't block them if they are far away.
    let checkinOffice = 'Remote';
    let checkinValid = false;

    // Find nearest office logic
    const offices = await this.db.query<any>(`SELECT * FROM office_check_in_out_details_new`);
    let minDistance = Infinity;
    let nearestOfficeObj = null;

    for (const office of offices) {
      const distance = this.calculateDistance(lat, lng, parseFloat(office.latitude), parseFloat(office.longitude));
      console.log(`[Attendance] Distance to ${office.office_name}: ${distance}m (Radius: ${office.radius}m)`);
      
      // Strict check for Inside users
      if (distance <= office.radius) {
        checkinValid = true;
        checkinOffice = office.office_name;
        // Break only if we found a valid office for Inside users or just to optimize
        // For Outside users, we might want the absolute nearest? 
        // Actually, if we match ANY office radius, we are "at an office" regardless of tag.
        if (isInside) break; 
      }

      // Track nearest for tagging purposes (if not strictly inside one)
      if (distance < minDistance) {
        minDistance = distance;
        nearestOfficeObj = office;
      }
    }

    // Logic Branch
    if (isInside) {
      if (!checkinValid) {
        console.warn(`[Attendance] blocked 'Inside' user ${user?.name} - MinDist=${minDistance}m (Strict limit: 100m)`);
        throw new BadRequestException(`You are not within range (100m) of an office. Nearest: ${Math.round(minDistance)}m`);
      }
    } else {
      // Outside user - always allow, but tag nearest office if available
      // If they ARE inside an office radius, checkinValid is true and checkinOffice is set.
      // If NOT, we check nearest.
      if (!checkinValid) {
          checkinValid = true;
          if (nearestOfficeObj) {
            checkinOffice = `${nearestOfficeObj.office_name} (${Math.round(minDistance)}m)`;
          } else {
            checkinOffice = 'Remote Location';
          }
      }
    }

    console.log(`[Attendance] Allowed CheckIn: User=${user?.name}, Office=${checkinOffice}`);

    // 4. Create Record
    await this.db.execute(`
      INSERT INTO user_checkin_checkout_details_new (
        user_id, date, checkin_time, checkin_latitude, checkin_longitude, checkin_address, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Present', NOW())
    `, [userId, today, this.getISTTime(), lat, lng, checkinOffice]);

    return { success: true, message: 'Checked in successfully', office: checkinOffice };
  }

  async forceCheckIn(userId: string, date: string, time: string, latitude: number, longitude: number, address: string) {
    const existing = await this.db.queryOne<any>(`
      SELECT id FROM user_checkin_checkout_details_new 
      WHERE user_id = ? AND date = ?
    `, [userId, date]);

    if (existing) {
       await this.db.execute(`
        UPDATE user_checkin_checkout_details_new 
        SET checkin_time = ?, checkin_latitude = ?, checkin_longitude = ?, checkin_address = ?, status = 'Present'
        WHERE id = ?
      `, [time, latitude, longitude, address + " (Force Allowed)", existing.id]);
    } else {
      await this.db.execute(`
        INSERT INTO user_checkin_checkout_details_new (
          user_id, date, checkin_time, checkin_latitude, checkin_longitude, checkin_address, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'Present')
      `, [userId, date, time, latitude, longitude, address + " (Force Allowed)"]);
    }
    return { success: true, message: 'Force check-in successful' };
  }

  async forceCheckOut(userId: string, date: string, time: string, latitude: number, longitude: number, address: string) {
    const record = await this.db.queryOne<any>(`
      SELECT id, checkin_time FROM user_checkin_checkout_details_new 
      WHERE user_id = ? AND date = ?
    `, [userId, date]);

    if (!record) {
      throw new BadRequestException('No attendance record found for this date to check out.');
    }

    await this.db.execute(`
      UPDATE user_checkin_checkout_details_new 
      SET checkout_time = ?, 
          checkout_latitude = ?, 
          checkout_longitude = ?, 
          checkout_address = ?,
          working_hours = TIMEDIFF(?, checkin_time)
      WHERE id = ?
    `, [time, latitude, longitude, address + " (Force Allowed)", time, record.id]);

    return { success: true, message: 'Force check-out successful' };
  }

  async checkOut(userId: string, lat: number, lng: number) {
    const today = this.getISTDate();
    const currentTime = this.getISTTime();
    
    // 1. Find today's record
    const record = await this.db.queryOne<any>(`
      SELECT * FROM user_checkin_checkout_details_new 
      WHERE user_id = ? AND date = ?
    `, [userId, today]);

    if (!record) {
      throw new BadRequestException('No check-in record found for today.');
    }

    if (record.checkout_time) {
      throw new BadRequestException('You have already checked out today.');
    }

    // 2. Fetch User Tag
    const user = await this.db.queryOne<any>(`SELECT tag, name FROM cloud_users WHERE id = ?`, [userId]);
    const isInside = user?.tag === 'Inside' || !user?.tag;
    console.log(`[Attendance] CheckOut Request: User=${user?.name}, ID=${userId}, Tag=${user?.tag}, IsInside=${isInside}`);

    // 3. Validate Geofence
    const offices = await this.db.query<any>(`SELECT * FROM office_check_in_out_details_new`);
    let checkoutOffice = 'Remote';
    let valid = false;
    let minDistance = Infinity;
    let nearestOfficeObj = null;

    for (const office of offices) {
      const distance = this.calculateDistance(lat, lng, parseFloat(office.latitude), parseFloat(office.longitude));
      
      if (distance <= office.radius) {
        valid = true;
        checkoutOffice = office.office_name;
        if(isInside) break;
      }
       if (distance < minDistance) {
        minDistance = distance;
        nearestOfficeObj = office;
      }
    }

    if (isInside) {
      if (!valid) {
        console.warn(`[Attendance] blocked 'Inside' user checkout ${user?.name}`);
        throw new BadRequestException('You must be within office range to check out.');
      }
    } else {
       // Outside user - allow
       if(!valid) {
          valid = true;
          if (nearestOfficeObj) {
            checkoutOffice = `${nearestOfficeObj.office_name} (${Math.round(minDistance)}m)`;
          } else {
            checkoutOffice = 'Remote Location';
          }
       }
    }

    // 4. Update Record
    await this.db.execute(`
      UPDATE user_checkin_checkout_details_new
      SET checkout_time = ?,
          checkout_latitude = ?,
          checkout_longitude = ?,
          checkout_address = ?,
          working_hours = TIMEDIFF(?, checkin_time)
      WHERE id = ?
    `, [currentTime, lat, lng, checkoutOffice, currentTime, record.id]);

    return { success: true, message: 'Checked out successfully' };
  }

  async getTodayStatus(userId: string) {
    const today = this.getISTDate();
    const record = await this.db.queryOne<any>(`
      SELECT * FROM user_checkin_checkout_details_new 
      WHERE user_id = ? AND date = ?
    `, [userId, today]);

    if (!record) return { status: 'Pending' };
    if (record.checkout_time) return { status: 'Checked Out', checkin: record.checkin_time, checkout: record.checkout_time, working_hours: record.working_hours };
    return { status: 'Checked In', checkin: record.checkin_time };
  }

  // Admin: Get daily report for all users with monthly stats
  async getDailyReport(date: string) {
    // Parse YYYY-MM-DD directly — using `new Date(date)` parses as UTC midnight
    // and then `.getMonth()` returns the month in the server's local timezone,
    // which silently shifts to the previous month on hosts west of UTC.
    const [yearStr, monthStr] = date.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    // 1. Get holidays for this month
    const holidays = await this.db.query<any>(`
      SELECT COUNT(*) as count FROM cloud_attendance_holidays 
      WHERE YEAR(holiday_date) = ? AND MONTH(holiday_date) = ?
    `, [year, month]);
    const holidayCount = holidays[0]?.count || 0;

    // 2. Compute "days elapsed" for absent calculation:
    //    - past month  → full month length
    //    - current month → days up to today (IST)
    //    - future month → 0
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const nowYear = nowIST.getFullYear();
    const nowMonth = nowIST.getMonth() + 1;
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    let daysElapsed = 0;
    if (year < nowYear || (year === nowYear && month < nowMonth)) {
      daysElapsed = lastDayOfMonth;
    } else if (year === nowYear && month === nowMonth) {
      daysElapsed = nowIST.getDate();
    }

    // 3. Fetch records with stats subqueries.
    //    Buckets are MUTUALLY EXCLUSIVE per day, mirroring the Daily Report
    //    hierarchy (most-severe wins): Half Day > Early > Late > On Time.
    //    So:  PRESENT = ON TIME + LATE + EARLY + HALF DAY, no double-counting.
    //    Status column in the table is always 'Present', so we derive from
    //    raw checkin / checkout times.
    const HD_COND = `(
      (s.checkout_time IS NOT NULL AND s.checkout_time < '14:00:00')
      OR COALESCE(s.checkout_address, '') LIKE '%Auto Check-Out (Midnight)%'
      OR (s.checkout_time IS NOT NULL AND s.checkout_time >= '23:00:00')
    )`;
    const EARLY_COND = `(
      s.checkout_time IS NOT NULL
      AND s.checkout_time >= '14:00:00' AND s.checkout_time < '18:20:00'
      AND COALESCE(s.checkout_address, '') NOT LIKE '%Auto Check-Out (Midnight)%'
    )`;
    const LATE_COND = `(s.checkin_time > '10:10:00')`;

    const records = await this.db.query<any>(`
      SELECT
        u.id as user_id, u.name, u.email, u.last_location, u.last_location_at,
        a.id as attendance_id, a.checkin_time, a.checkin_address,
        a.checkin_latitude, a.checkin_longitude,
        a.checkout_time, a.checkout_address,
        a.checkout_latitude, a.checkout_longitude,
        a.working_hours,
        a.status as db_status,
        (SELECT COUNT(*) FROM user_checkin_checkout_details_new s
         WHERE s.user_id = u.id AND s.checkin_time IS NOT NULL
         AND YEAR(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ? AND MONTH(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ?) as total_present,
        (SELECT COUNT(*) FROM user_checkin_checkout_details_new s
         WHERE s.user_id = u.id AND s.checkin_time IS NOT NULL
         AND ${HD_COND}
         AND YEAR(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ? AND MONTH(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ?) as total_half_day,
        (SELECT COUNT(*) FROM user_checkin_checkout_details_new s
         WHERE s.user_id = u.id AND s.checkin_time IS NOT NULL
         AND NOT ${HD_COND} AND ${EARLY_COND}
         AND YEAR(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ? AND MONTH(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ?) as total_early,
        (SELECT COUNT(*) FROM user_checkin_checkout_details_new s
         WHERE s.user_id = u.id AND s.checkin_time IS NOT NULL
         AND NOT ${HD_COND} AND NOT ${EARLY_COND} AND ${LATE_COND}
         AND YEAR(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ? AND MONTH(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ?) as total_late,
        (SELECT COUNT(*) FROM user_checkin_checkout_details_new s
         WHERE s.user_id = u.id AND s.checkin_time IS NOT NULL
         AND NOT ${HD_COND} AND NOT ${EARLY_COND} AND NOT ${LATE_COND}
         AND YEAR(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ? AND MONTH(DATE_ADD(s.date, INTERVAL 330 MINUTE)) = ?) as total_on_time
      FROM cloud_users u
      LEFT JOIN user_checkin_checkout_details_new a ON u.id = a.user_id AND DATE(DATE_ADD(a.date, INTERVAL 330 MINUTE)) = ?
      WHERE u.status = 'active'
      ORDER BY u.name ASC
    `, [year, month, year, month, year, month, year, month, year, month, date]);

    const processedRecords = records.map(r => {
      let status = r.db_status || 'Absent';
      const checkin = r.checkin_time;
      const checkout = r.checkout_time;
      const checkoutAddress = r.checkout_address || '';

      // Status logic based on new rules
      if (checkin) {
        status = 'Present'; // Reset to Present then check for infractions

        // 1. Late Comer: > 10:10 AM
        if (checkin > '10:10:00') {
          status = 'Late Comer';
        }
        
        // 2. Early Leaver: < 06:20 PM (18:20)
        if (checkout && checkout < '18:20:00') {
           status = 'Early Leaver';
        }

        // 3. Half Day Rules:
        // - If check out before 2 pm (14:00)
        // - If no check out before 11 pm (23:00) - Marked by Midnight Auto-Checkout
        if (checkout && checkout < '14:00:00') {
          status = 'Half Day';
        }

        if (checkoutAddress.includes('Auto Check-Out (Midnight)') || (checkout && checkout >= '23:00:00')) {
          status = 'Half Day';
        }
      }

      // Absent for the period = elapsed days − present − holidays (never < 0)
      const totalPresent = Number(r.total_present) || 0;
      const totalAbsent = Math.max(0, daysElapsed - totalPresent - holidayCount);

      return {
        ...r,
        status: status, // Use the calculated status
        last_location: typeof r.last_location === 'string' ? JSON.parse(r.last_location) : r.last_location,
        total_holiday: holidayCount,
        total_absent: totalAbsent,
        total_on_time: Number(r.total_on_time) || 0,
        total_late: Number(r.total_late) || 0,
        total_early: Number(r.total_early) || 0,
        total_half_day: Number(r.total_half_day) || 0,
      };
    });

    // Save calculated status back to DB if it's currently 'Present' or different to ensure stats are accurate
    // This is optional but helps with the total_present/absent counts in the subqueries.
    // However, since we're in a Get request, we shouldn't really modify data.
    // The subqueries should ideally be updated to includes all "Present-like" statuses.
    // I updated the subqueries above.

    // 3. Daily Summary KPIs
    const summary = {
      total: processedRecords.length,
      present: processedRecords.filter(r => r.checkin_time).length,
      absent: processedRecords.filter(r => !r.checkin_time).length,
      half_day: processedRecords.filter(r => r.status === 'Half Day').length,
      late: processedRecords.filter(r => r.status === 'Late Comer').length,
      early: processedRecords.filter(r => r.status === 'Early Leaver').length
    };

    return { records: processedRecords, summary };
  }

  // Holiday Management
  async addHoliday(date: string, description: string) {
    await this.db.execute(`
      INSERT INTO cloud_attendance_holidays (holiday_date, description) 
      VALUES (?, ?) 
      ON DUPLICATE KEY UPDATE description = ?
    `, [date, description, description]);
    return { success: true, message: 'Holiday added successfully' };
  }

  async removeHoliday(date: string) {
    await this.db.execute(`DELETE FROM cloud_attendance_holidays WHERE holiday_date = ?`, [date]);
    return { success: true, message: 'Holiday removed successfully' };
  }

  async getHolidays() {
    return this.db.query<any>(`SELECT * FROM cloud_attendance_holidays ORDER BY holiday_date DESC`);
  }

  async bulkAddHolidays(holidays: { date: string; description: string }[]) {
    if (!holidays || holidays.length === 0) return { success: true };
    
    return this.db.withTransaction(async (conn) => {
      for (const h of holidays) {
        await this.db.execute(`
          INSERT INTO cloud_attendance_holidays (holiday_date, description) 
          VALUES (?, ?) 
          ON DUPLICATE KEY UPDATE description = VALUES(description)
        `, [h.date, h.description], conn);
      }
      return { success: true, message: `Added ${holidays.length} holidays` };
    });
  }

  // Get user's own monthly stats (present, absent, half-day, holiday counts + daily details)
  async getMyMonthlyStats(userId: string, month: number, year: number) {
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Get user name
    const user = await this.db.queryOne<any>(`SELECT name FROM cloud_users WHERE id = ?`, [userId]);

    // Get attendance records for the month
    const records = await this.db.query<any>(`
      SELECT * FROM user_checkin_checkout_details_new
      WHERE user_id = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC
    `, [userId, from, to]);

    // Get holidays for this month
    const holidays = await this.db.query<any>(`
      SELECT holiday_date, description FROM cloud_attendance_holidays 
      WHERE YEAR(holiday_date) = ? AND MONTH(holiday_date) = ?
    `, [year, month]);
    const holidayDates = new Set(holidays.map(h => h.holiday_date.toISOString?.()?.split('T')[0] || String(h.holiday_date).split('T')[0]));

    // Process records to compute statuses
    const processedRecords = records.map(r => {
      const checkin = r.checkin_time;
      const checkout = r.checkout_time;
      const checkoutAddress = r.checkout_address || '';
      let status = r.status || 'Present';

      if (checkin) {
        status = 'Present';
        if (checkin > '10:10:00') status = 'Late Comer';
        if (checkout && checkout < '18:20:00') status = 'Early Leaver';
        if (checkout && checkout < '14:00:00') status = 'Half Day';
        if (checkoutAddress.includes('Auto Check-Out (Midnight)') || (checkout && checkout >= '23:00:00')) {
          status = 'Half Day';
        }
      }

      return { ...r, status };
    });

    // Build daily map
    const recordMap: Record<string, any> = {};
    for (const r of processedRecords) {
      const dateStr = r.date?.toISOString?.()?.split('T')[0] || String(r.date).split('T')[0];
      recordMap[dateStr] = r;
    }

    // Count stats
    let present = 0, absent = 0, halfDay = 0;
    const today = this.getISTDate();

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dateStr > today) continue; // Skip future dates
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      const isSunday = dayOfWeek === 0;
      const isHoliday = holidayDates.has(dateStr);

      if (isSunday || isHoliday) continue; // Don't count holidays/sundays

      const record = recordMap[dateStr];
      if (record) {
        if (record.status === 'Half Day') halfDay++;
        else present++;
      } else {
        absent++;
      }
    }

    return {
      user_id: userId,
      name: user?.name || 'Unknown',
      month, year,
      summary: {
        total_days: lastDay,
        present,
        absent,
        half_day: halfDay,
        holidays: holidays.length,
      },
      records: processedRecords,
      holiday_dates: Array.from(holidayDates),
    };
  }

  // Admin: Get monthly attendance matrix for Excel export
  async getMonthlyExport(month: number, year: number) {
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Get all active users
    const users = await this.db.query<any>(
      `SELECT id, name FROM cloud_users WHERE status = 'active' ORDER BY name ASC`
    );

    // Get all attendance records for the month
    const records = await this.db.query<any>(`
      SELECT user_id, date, checkin_time, checkout_time
      FROM user_checkin_checkout_details_new
      WHERE date BETWEEN ? AND ?
      ORDER BY date ASC
    `, [from, to]);

    // Build lookup: userId -> date -> { checkin, checkout }
    const lookup: Record<string, Record<string, { checkin: string | null; checkout: string | null }>> = {};
    for (const r of records) {
      const dateStr = r.date?.toISOString?.()?.split('T')[0] || String(r.date).split('T')[0];
      if (!lookup[r.user_id]) lookup[r.user_id] = {};
      lookup[r.user_id][dateStr] = {
        checkin: r.checkin_time || null,
        checkout: r.checkout_time || null,
      };
    }

    // Build date columns
    const dates: { date: string; day: string }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      dates.push({ date: dateStr, day: dayNames[dayOfWeek] });
    }

    // Build user rows
    const rows = users.map((u: any, idx: number) => {
      const userDates: Record<string, { checkin: string | null; checkout: string | null }> = {};
      for (const dt of dates) {
        userDates[dt.date] = lookup[u.id]?.[dt.date] || { checkin: null, checkout: null };
      }
      return {
        sr: idx + 1,
        user_id: u.id,
        name: u.name,
        attendance: userDates,
      };
    });

    return { dates, rows };
  }

  // Get specific user history
  async getUserHistory(userId: string, from: string, to: string) {
    const history = await this.db.query<any>(`
      SELECT * FROM user_checkin_checkout_details_new
      WHERE user_id = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC
    `, [userId, from, to]);
    return history;
  }

  // 11:50 PM Auto Check-out, Mark Half Day, and Force Logout
  @Cron('50 23 * * *', { timeZone: 'Asia/Kolkata' })
  async handleAutoTimeout() {
    console.log('[Attendance Cron] Triggering 11:50 PM auto-checkout and force logout...');
    const today = this.getISTDate();

    try {
      // 1. Auto Check-out users who are still checked in — mark as Half Day
      const pendingcheckouts = await this.db.query<any>(`
        SELECT * FROM user_checkin_checkout_details_new
        WHERE date = ? AND checkout_time IS NULL
      `, [today]);

      for (const record of pendingcheckouts) {
        await this.db.execute(`
          UPDATE user_checkin_checkout_details_new
          SET checkout_time = '23:50:00',
              checkout_address = 'Auto Check-Out (Half Day)',
              working_hours = TIMEDIFF('23:50:00', checkin_time),
              status = 'Half Day'
          WHERE id = ?
        `, [record.id]);
      }

      // 2. Force Logout: Clear all sessions
      await this.db.execute(`TRUNCATE TABLE cloud_user_sessions`);

      console.log(`[Attendance Cron] Success: ${pendingcheckouts.length} users auto checked-out as Half Day. Sessions cleared.`);
    } catch (error) {
      console.error('[Attendance Cron] Error:', error);
    }
  }
}
