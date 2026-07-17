import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Password hashing helper
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  } catch (err) {
    return false;
  }
}

// Session Token helper
export function createSessionToken(user: any): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  })).toString('base64url');
  
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(`${header}.${body}`);
  const signature = hmac.digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifySessionToken(token: string): any | null {
  try {
    const [header, body, signature] = token.split('.');
    const hmac = crypto.createHmac('sha256', SESSION_SECRET);
    hmac.update(`${header}.${body}`);
    const expectedSignature = hmac.digest('base64url');
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

// Database Engine
class DatabaseEngine {
  private pool: mysql.Pool | null = null;
  private isFallback = true;
  private fallbackFilePath = path.join(process.cwd(), 'db.json');
  private fallbackData: any = {
    leaders: [],
    schedules: [],
    schedule_participants: [],
    profiles: []
  };

  async init() {
    const host = process.env.MYSQL_HOST || process.env.VITE_MYSQL_HOST;
    const user = process.env.MYSQL_USER || process.env.VITE_MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD || process.env.VITE_MYSQL_PASSWORD;
    const database = process.env.MYSQL_DATABASE || process.env.VITE_MYSQL_DATABASE;
    const port = parseInt(process.env.MYSQL_PORT || process.env.VITE_MYSQL_PORT || '3306', 10);

    if (host && user && database) {
      try {
        console.log(`Attempting connection to MySQL database at ${host}:${port}...`);
        this.pool = mysql.createPool({
          host,
          user,
          password,
          database,
          port,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          dateStrings: true // Prevents local timezone conversion issues for dates and times
        });

        // Test connection
        await this.pool.query('SELECT 1');
        this.isFallback = false;
        console.log('Successfully connected to MySQL database!');
        await this.setupMySQLSchema();
        return;
      } catch (err: any) {
        console.log(`Note: MySQL connection failed (${err.message || err}).`);
        console.log('Falling back to high-performance local JSON database (db.json)...');
      }
    } else {
      console.log('MySQL credentials not fully provided. Using file-based JSON storage...');
    }

    this.isFallback = true;
    this.loadFallbackData();
  }

  private async setupMySQLSchema() {
    if (!this.pool) return;
    try {
      console.log('Ensuring MySQL database tables exist...');
      
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS leaders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          position VARCHAR(255) NOT NULL,
          department VARCHAR(255),
          phone VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS schedules (
          id INT AUTO_INCREMENT PRIMARY KEY,
          date DATE NOT NULL,
          time TIME NOT NULL,
          content TEXT NOT NULL,
          program_document VARCHAR(512),
          preparation VARCHAR(512),
          location VARCHAR(255),
          host VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS schedule_participants (
          schedule_id INT NOT NULL,
          leader_id INT NOT NULL,
          PRIMARY KEY (schedule_id, leader_id),
          FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
          FOREIGN KEY (leader_id) REFERENCES leaders(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          id VARCHAR(255) PRIMARY KEY,
          username VARCHAR(255) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'editor'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Check if an admin user exists, if not, create one
      const [rows]: any = await this.pool.query('SELECT * FROM profiles WHERE username = "admin"');
      if (rows.length === 0) {
        const adminId = crypto.randomUUID();
        const hashedPassword = hashPassword('admin123');
        await this.pool.query(
          'INSERT INTO profiles (id, username, password, role) VALUES (?, ?, ?, "admin")',
          [adminId, 'admin', hashedPassword]
        );
        console.log('Created default admin user for MySQL: admin / admin123');
      }

      console.log('MySQL database schema verified successfully.');
    } catch (err) {
      console.error('Error setting up MySQL schema:', err);
    }
  }

  private loadFallbackData() {
    try {
      if (fs.existsSync(this.fallbackFilePath)) {
        const fileContent = fs.readFileSync(this.fallbackFilePath, 'utf-8');
        this.fallbackData = JSON.parse(fileContent);
        // Ensure structure is sound
        if (!this.fallbackData.leaders) this.fallbackData.leaders = [];
        if (!this.fallbackData.schedules) this.fallbackData.schedules = [];
        if (!this.fallbackData.schedule_participants) this.fallbackData.schedule_participants = [];
        if (!this.fallbackData.profiles) this.fallbackData.profiles = [];
      } else {
        // Pre-seed mock data for an immediate elegant preview!
        const adminId = crypto.randomUUID();
        const hashedPassword = hashPassword('admin123');
        
        this.fallbackData = {
          leaders: [
            { id: 1, name: 'Đ/c Nguyễn Hữu Đông', position: 'Bí thư Tỉnh ủy', department: 'Tỉnh ủy', phone: '0912.345.678' },
            { id: 2, name: 'Đ/c Lò Minh Hùng', position: 'Phó Bí thư Thường trực', department: 'Tỉnh ủy', phone: '0983.456.789' },
            { id: 3, name: 'Đ/c Nguyễn Thái Hưng', position: 'Chủ tịch HĐND Tỉnh', department: 'HĐND Tỉnh', phone: '0945.123.456' },
            { id: 4, name: 'Đ/c Hoàng Quốc Khánh', position: 'Chủ tịch UBND Tỉnh', department: 'UBND Tỉnh', phone: '0903.987.654' }
          ],
          schedules: [
            {
              id: 1,
              date: new Date().toISOString().split('T')[0],
              time: '08:00:00',
              content: 'Họp Thường trực Tỉnh uỷ nghe báo cáo tình hình triển khai thực hiện nhiệm vụ trọng tâm quý III',
              program_document: 'Giấy mời số 145-GM/TU',
              preparation: 'Văn phòng Tỉnh ủy chuẩn bị tài liệu',
              location: 'Phòng họp Thường trực Tỉnh uỷ (Tầng 3)',
              host: 'Bí thư Tỉnh ủy'
            },
            {
              id: 2,
              date: new Date().toISOString().split('T')[0],
              time: '14:00:00',
              content: 'Hội nghị Ban Thường vụ Tỉnh uỷ kỳ thứ 45',
              program_document: 'Giấy mời số 148-GM/TU',
              preparation: 'Ban Tổ chức Tỉnh ủy chuẩn bị nội dung công tác cán bộ',
              location: 'Phòng họp BCH Đảng bộ tỉnh (Tầng 2)',
              host: 'Bí thư Tỉnh ủy'
            }
          ],
          schedule_participants: [
            { schedule_id: 1, leader_id: 1 },
            { schedule_id: 1, leader_id: 2 },
            { schedule_id: 2, leader_id: 1 },
            { schedule_id: 2, leader_id: 2 },
            { schedule_id: 2, leader_id: 3 },
            { schedule_id: 2, leader_id: 4 }
          ],
          profiles: [
            { id: adminId, username: 'admin', password: hashedPassword, role: 'admin' }
          ]
        };
        this.saveFallbackData();
      }
    } catch (err) {
      console.error('Error loading fallback database:', err);
    }
  }

  private saveFallbackData() {
    try {
      fs.writeFileSync(this.fallbackFilePath, JSON.stringify(this.fallbackData, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving fallback database:', err);
    }
  }

  // LEADERS API
  async getLeaders() {
    if (!this.isFallback && this.pool) {
      const [rows] = await this.pool.query('SELECT * FROM leaders ORDER BY id DESC');
      return rows;
    } else {
      return [...this.fallbackData.leaders].reverse();
    }
  }

  async createLeader(data: { name: string; position: string; department?: string; phone?: string }) {
    if (!this.isFallback && this.pool) {
      const [result]: any = await this.pool.query(
        'INSERT INTO leaders (name, position, department, phone) VALUES (?, ?, ?, ?)',
        [data.name, data.position, data.department || null, data.phone || null]
      );
      const [inserted]: any = await this.pool.query('SELECT * FROM leaders WHERE id = ?', [result.insertId]);
      return inserted[0];
    } else {
      const id = this.fallbackData.leaders.length > 0 
        ? Math.max(...this.fallbackData.leaders.map((l: any) => l.id)) + 1 
        : 1;
      const newLeader = {
        id,
        name: data.name,
        position: data.position,
        department: data.department || '',
        phone: data.phone || '',
        created_at: new Date().toISOString()
      };
      this.fallbackData.leaders.push(newLeader);
      this.saveFallbackData();
      return newLeader;
    }
  }

  async updateLeader(id: number, data: { name: string; position: string; department?: string; phone?: string }) {
    if (!this.isFallback && this.pool) {
      await this.pool.query(
        'UPDATE leaders SET name = ?, position = ?, department = ?, phone = ? WHERE id = ?',
        [data.name, data.position, data.department || null, data.phone || null, id]
      );
      const [updated]: any = await this.pool.query('SELECT * FROM leaders WHERE id = ?', [id]);
      return updated[0];
    } else {
      const idx = this.fallbackData.leaders.findIndex((l: any) => l.id === id);
      if (idx !== -1) {
        this.fallbackData.leaders[idx] = {
          ...this.fallbackData.leaders[idx],
          name: data.name,
          position: data.position,
          department: data.department || '',
          phone: data.phone || ''
        };
        this.saveFallbackData();
        return this.fallbackData.leaders[idx];
      }
      return null;
    }
  }

  async deleteLeader(id: number) {
    if (!this.isFallback && this.pool) {
      await this.pool.query('DELETE FROM leaders WHERE id = ?', [id]);
      return true;
    } else {
      this.fallbackData.leaders = this.fallbackData.leaders.filter((l: any) => l.id !== id);
      // Clean up participation links
      this.fallbackData.schedule_participants = this.fallbackData.schedule_participants.filter(
        (sp: any) => sp.leader_id !== id
      );
      this.saveFallbackData();
      return true;
    }
  }

  // SCHEDULES API
  async getSchedules(options?: { gte?: string; lte?: string; orders?: { column: string; ascending: boolean }[] }) {
    if (!this.isFallback && this.pool) {
      let sql = 'SELECT * FROM schedules';
      const params: any[] = [];
      const conditions: string[] = [];

      if (options?.gte) {
        conditions.push('date >= ?');
        params.push(options.gte);
      }
      if (options?.lte) {
        conditions.push('date <= ?');
        params.push(options.lte);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      if (options?.orders && options.orders.length > 0) {
        const orderClauses = options.orders.map(o => `\`${o.column}\` ${o.ascending ? 'ASC' : 'DESC'}`);
        sql += ' ORDER BY ' + orderClauses.join(', ');
      } else {
        sql += ' ORDER BY date DESC, time DESC';
      }

      const [schedules]: any = await this.pool.query(sql, params);

      // Fetch participants for each schedule
      for (const schedule of schedules) {
        const [participants]: any = await this.pool.query(`
          SELECT l.* 
          FROM leaders l
          JOIN schedule_participants sp ON l.id = sp.leader_id
          WHERE sp.schedule_id = ?
        `, [schedule.id]);

        schedule.schedule_participants = participants.map((p: any) => ({
          leaders: p
        }));
      }

      return schedules;
    } else {
      let filtered = [...this.fallbackData.schedules];

      if (options?.gte) {
        filtered = filtered.filter((s: any) => s.date >= options.gte!);
      }
      if (options?.lte) {
        filtered = filtered.filter((s: any) => s.date <= options.lte!);
      }

      // Sort
      if (options?.orders && options.orders.length > 0) {
        filtered.sort((a: any, b: any) => {
          for (const order of options.orders!) {
            let valA = a[order.column] || '';
            let valB = b[order.column] || '';
            if (valA !== valB) {
              const asc = order.ascending ? 1 : -1;
              return valA > valB ? asc : -asc;
            }
          }
          return 0;
        });
      } else {
        // Default sort descending
        filtered.sort((a: any, b: any) => {
          if (a.date !== b.date) return b.date > a.date ? 1 : -1;
          return b.time > a.time ? 1 : -1;
        });
      }

      // Attach participants
      const schedulesWithParticipants = filtered.map((schedule: any) => {
        const pLinks = this.fallbackData.schedule_participants.filter(
          (sp: any) => sp.schedule_id === schedule.id
        );
        const participantLeaders = pLinks
          .map((sp: any) => this.fallbackData.leaders.find((l: any) => l.id === sp.leader_id))
          .filter(Boolean);

        return {
          ...schedule,
          schedule_participants: participantLeaders.map((l: any) => ({
            leaders: l
          }))
        };
      });

      return schedulesWithParticipants;
    }
  }

  async createSchedule(data: {
    date: string;
    time: string;
    content: string;
    program_document?: string;
    preparation?: string;
    location: string;
    host?: string;
  }) {
    if (!this.isFallback && this.pool) {
      const [result]: any = await this.pool.query(
        'INSERT INTO schedules (date, time, content, program_document, preparation, location, host) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          data.date,
          data.time,
          data.content,
          data.program_document || null,
          data.preparation || null,
          data.location,
          data.host || null
        ]
      );
      const [inserted]: any = await this.pool.query('SELECT * FROM schedules WHERE id = ?', [result.insertId]);
      return inserted[0];
    } else {
      const id = this.fallbackData.schedules.length > 0
        ? Math.max(...this.fallbackData.schedules.map((s: any) => s.id)) + 1
        : 1;
      const newSchedule = {
        id,
        date: data.date,
        time: data.time,
        content: data.content,
        program_document: data.program_document || '',
        preparation: data.preparation || '',
        location: data.location,
        host: data.host || '',
        created_at: new Date().toISOString()
      };
      this.fallbackData.schedules.push(newSchedule);
      this.saveFallbackData();
      return newSchedule;
    }
  }

  async updateSchedule(
    id: number,
    data: {
      date: string;
      time: string;
      content: string;
      program_document?: string;
      preparation?: string;
      location: string;
      host?: string;
    }
  ) {
    if (!this.isFallback && this.pool) {
      await this.pool.query(
        'UPDATE schedules SET date = ?, time = ?, content = ?, program_document = ?, preparation = ?, location = ?, host = ? WHERE id = ?',
        [
          data.date,
          data.time,
          data.content,
          data.program_document || null,
          data.preparation || null,
          data.location,
          data.host || null,
          id
        ]
      );
      const [updated]: any = await this.pool.query('SELECT * FROM schedules WHERE id = ?', [id]);
      return updated[0];
    } else {
      const idx = this.fallbackData.schedules.findIndex((s: any) => s.id === id);
      if (idx !== -1) {
        this.fallbackData.schedules[idx] = {
          ...this.fallbackData.schedules[idx],
          date: data.date,
          time: data.time,
          content: data.content,
          program_document: data.program_document || '',
          preparation: data.preparation || '',
          location: data.location,
          host: data.host || ''
        };
        this.saveFallbackData();
        return this.fallbackData.schedules[idx];
      }
      return null;
    }
  }

  async deleteSchedule(id: number) {
    if (!this.isFallback && this.pool) {
      await this.pool.query('DELETE FROM schedules WHERE id = ?', [id]);
      return true;
    } else {
      this.fallbackData.schedules = this.fallbackData.schedules.filter((s: any) => s.id !== id);
      this.fallbackData.schedule_participants = this.fallbackData.schedule_participants.filter(
        (sp: any) => sp.schedule_id !== id
      );
      this.saveFallbackData();
      return true;
    }
  }

  // PARTICIPANTS API
  async deleteScheduleParticipants(scheduleId: number) {
    if (!this.isFallback && this.pool) {
      await this.pool.query('DELETE FROM schedule_participants WHERE schedule_id = ?', [scheduleId]);
      return true;
    } else {
      this.fallbackData.schedule_participants = this.fallbackData.schedule_participants.filter(
        (sp: any) => sp.schedule_id !== scheduleId
      );
      this.saveFallbackData();
      return true;
    }
  }

  async insertScheduleParticipants(payloads: { schedule_id: number; leader_id: number }[]) {
    if (payloads.length === 0) return true;
    if (!this.isFallback && this.pool) {
      const values = payloads.map(p => [p.schedule_id, p.leader_id]);
      await this.pool.query(
        'INSERT INTO schedule_participants (schedule_id, leader_id) VALUES ?',
        [values]
      );
      return true;
    } else {
      payloads.forEach(p => {
        this.fallbackData.schedule_participants.push({
          schedule_id: p.schedule_id,
          leader_id: p.leader_id
        });
      });
      this.saveFallbackData();
      return true;
    }
  }

  // USERS/PROFILES API
  async getProfiles() {
    if (!this.isFallback && this.pool) {
      const [rows] = await this.pool.query('SELECT id, username, role FROM profiles ORDER BY username');
      return rows;
    } else {
      return this.fallbackData.profiles.map((p: any) => ({
        id: p.id,
        username: p.username,
        role: p.role
      })).sort((a: any, b: any) => a.username.localeCompare(b.username));
    }
  }

  async getProfileByUsername(username: string) {
    if (!this.isFallback && this.pool) {
      const [rows]: any = await this.pool.query('SELECT * FROM profiles WHERE username = ?', [username]);
      return rows[0] || null;
    } else {
      return this.fallbackData.profiles.find((p: any) => p.username === username) || null;
    }
  }

  async createProfile(data: { username: string; passwordHash: string; role: 'admin' | 'editor' }) {
    const id = crypto.randomUUID();
    if (!this.isFallback && this.pool) {
      await this.pool.query(
        'INSERT INTO profiles (id, username, password, role) VALUES (?, ?, ?, ?)',
        [id, data.username, data.passwordHash, data.role]
      );
      return { id, username: data.username, role: data.role };
    } else {
      const newProfile = {
        id,
        username: data.username,
        password: data.passwordHash,
        role: data.role
      };
      this.fallbackData.profiles.push(newProfile);
      this.saveFallbackData();
      return { id, username: data.username, role: data.role };
    }
  }

  async updateProfileRole(id: string, role: 'admin' | 'editor') {
    if (!this.isFallback && this.pool) {
      await this.pool.query('UPDATE profiles SET role = ? WHERE id = ?', [role, id]);
      return true;
    } else {
      const idx = this.fallbackData.profiles.findIndex((p: any) => p.id === id);
      if (idx !== -1) {
        this.fallbackData.profiles[idx].role = role;
        this.saveFallbackData();
        return true;
      }
      return false;
    }
  }

  async deleteProfile(id: string) {
    if (!this.isFallback && this.pool) {
      await this.pool.query('DELETE FROM profiles WHERE id = ?', [id]);
      return true;
    } else {
      this.fallbackData.profiles = this.fallbackData.profiles.filter((p: any) => p.id !== id);
      this.saveFallbackData();
      return true;
    }
  }
}

export const db = new DatabaseEngine();
