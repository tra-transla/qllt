import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { db, hashPassword, verifyPassword, createSessionToken, verifySessionToken } from './server-db';

const appRoot = (() => {
  if (typeof __dirname !== 'undefined') {
    if (path.basename(__dirname) === 'dist') {
      return path.resolve(__dirname, '..');
    }
    return __dirname;
  }
  return process.cwd();
})();

// Create a robust logger for debugging Hostinger startup/runtime issues
const logFile = path.resolve(appRoot, 'server-debug.log');
const log = (msg: string) => {
  const timestamp = new Date().toISOString();
  const formattedMsg = `[${timestamp}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, formattedMsg);
  } catch (e) {
    console.error(formattedMsg);
  }
};

// Listen for uncaught issues to prevent silent crashes
process.on('uncaughtException', (err) => {
  log(`CRITICAL UNCAUGHT EXCEPTION: ${err?.stack || err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  log(`CRITICAL UNHANDLED REJECTION: ${reason?.stack || reason}`);
});

async function startServer() {
  log('Starting server initialization...');
  const app = express();
  
  // Detect if we are running in AI Studio sandbox.
  // AI Studio sandboxes use container environments where the external proxy expects port 3000.
  const isAIStudio = process.env.APP_URL && (
    process.env.APP_URL.includes('asia-southeast1.run.app') || 
    process.env.APP_URL.includes('aistudio') ||
    process.env.APP_URL.includes('ais-dev') ||
    process.env.APP_URL.includes('ais-pre')
  );

  // In AI Studio development, we force port 3000 to satisfy the container port forwarder.
  // On Hostinger, Phusion Passenger uses process.env.PORT.
  const PORT = isAIStudio ? 3000 : (process.env.PORT || 3000);
  log(`Configured PORT: ${PORT} (isAIStudio: ${!!isAIStudio})`);

  // Initialize Database (MySQL or fallback JSON)
  try {
    log('Initializing database connection...');
    await db.init();
    log('Database initialization completed.');
  } catch (dbErr: any) {
    log(`Database initialization failed with error: ${dbErr?.stack || dbErr}`);
  }

  app.use(express.json());

  // Helper to parse manual cookies from request
  const getCookies = (req: express.Request) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};
    const cookies: { [key: string]: string } = {};
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length === 2) {
        cookies[parts[0].trim()] = parts[1].trim();
      }
    });
    return cookies;
  };

  // Helper to parse query constraints
  const parseConstraints = (req: express.Request) => {
    const eqs = req.query.eqs ? JSON.parse(req.query.eqs as string) : {};
    const gtes = req.query.gtes ? JSON.parse(req.query.gtes as string) : {};
    const ltes = req.query.ltes ? JSON.parse(req.query.ltes as string) : {};
    const orders = req.query.orders ? JSON.parse(req.query.orders as string) : [];
    return { eqs, gtes, ltes, orders };
  };

  // AUTH API
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
      }

      const user = await db.getProfileByUsername(username);
      if (!user) {
        return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
      }

      const isValid = verifyPassword(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
      }

      const token = createSessionToken(user);
      
      // Set HTTP-only session cookie (valid for 24 hours)
      res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; Max-Age=86400; SameSite=Lax`);
      
      return res.json({
        session: {
          access_token: token,
          user: {
            id: user.id,
            email: `${user.username}@system.local`
          }
        }
      });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    // Clear cookie
    res.setHeader('Set-Cookie', 'session_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    res.json({ success: true });
  });

  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
      }

      const existing = await db.getProfileByUsername(username);
      if (existing) {
        return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại trong hệ thống' });
      }

      const passwordHash = hashPassword(password);
      const user = await db.createProfile({
        username,
        passwordHash,
        role: 'editor' // default role
      });

      return res.json({
        user: {
          id: user.id,
          email: `${user.username}@system.local`
        }
      });
    } catch (err: any) {
      console.error('Signup error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auth/session', async (req, res) => {
    const cookies = getCookies(req);
    const token = cookies['session_token'];
    
    if (!token) {
      return res.json({ session: null });
    }

    const payload = verifySessionToken(token);
    if (!payload) {
      return res.json({ session: null });
    }

    return res.json({
      session: {
        access_token: token,
        user: {
          id: payload.id,
          email: `${payload.username}@system.local`
        }
      }
    });
  });

  // LEADERS API
  app.get('/api/leaders', async (req, res) => {
    try {
      const leaders = await db.getLeaders();
      res.json(leaders);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/leaders', async (req, res) => {
    try {
      // Handle insert, body can be [formData] or formData
      const body = Array.isArray(req.body) ? req.body[0] : req.body;
      const leader = await db.createLeader(body);
      res.json([leader]); // Return array because supabase returns array
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/leaders', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = parseInt(eqs.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid or missing ID' });
      }
      const updated = await db.updateLeader(id, req.body);
      res.json([updated]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/leaders', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = parseInt(eqs.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid or missing ID' });
      }
      await db.deleteLeader(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SCHEDULES API
  app.get('/api/schedules', async (req, res) => {
    try {
      const { gtes, ltes, orders } = parseConstraints(req);
      const schedules = await db.getSchedules({
        gte: gtes.date,
        lte: ltes.date,
        orders
      });
      res.json(schedules);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/schedules', async (req, res) => {
    try {
      const body = Array.isArray(req.body) ? req.body[0] : req.body;
      const schedule = await db.createSchedule(body);
      res.json([schedule]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/schedules', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = parseInt(eqs.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid or missing ID' });
      }
      const updated = await db.updateSchedule(id, req.body);
      res.json([updated]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/schedules', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = parseInt(eqs.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid or missing ID' });
      }
      await db.deleteSchedule(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PARTICIPANTS JUNCTION API
  app.post('/api/schedule_participants', async (req, res) => {
    try {
      const payloads = Array.isArray(req.body) ? req.body : [req.body];
      await db.insertScheduleParticipants(payloads);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/schedule_participants', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const scheduleId = parseInt(eqs.schedule_id, 10);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ error: 'Invalid or missing schedule_id' });
      }
      await db.deleteScheduleParticipants(scheduleId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // USERS/PROFILES API
  app.get('/api/profiles', async (req, res) => {
    try {
      const profiles = await db.getProfiles();
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/profiles', async (req, res) => {
    try {
      const body = Array.isArray(req.body) ? req.body[0] : req.body;
      const { id, username, role } = body;
      
      const existing = await db.getProfileByUsername(username);
      if (existing) {
        // Return 23505 duplicate key error to trigger fallback code in Users.tsx
        return res.status(400).json({ error: 'Username already exists', code: '23505' });
      }

      // If password isn't in body (inserted by user trigger), let's preseed with a default or empty
      const defaultPasswordHash = hashPassword('123456');
      const profile = await db.createProfile({
        username,
        passwordHash: defaultPasswordHash,
        role: role || 'editor'
      });

      res.json([profile]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/profiles', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = eqs.id;
      if (!id) {
        return res.status(400).json({ error: 'Missing profile ID' });
      }
      await db.updateProfileRole(id, req.body.role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/profiles', async (req, res) => {
    try {
      const { eqs } = parseConstraints(req);
      const id = eqs.id;
      if (!id) {
        return res.status(400).json({ error: 'Missing profile ID' });
      }
      await db.deleteProfile(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(appRoot, 'dist');
    app.use(express.static(distPath));

    // API 404 handler to prevent unmatched API requests from returning index.html
    app.all('/api/*', (req, res) => {
      res.status(404).json({ error: `API endpoint ${req.method} ${req.originalUrl} not found` });
    });

    // Handle SPA routing fallback in production
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start listening
  const isNumeric = (val: any) => !isNaN(Number(val)) && val !== '';
  if (isNumeric(PORT)) {
    const numericPort = Number(PORT);
    app.listen(numericPort, '0.0.0.0', () => {
      const msg = `Server is listening on port ${numericPort} (0.0.0.0)`;
      console.log(msg);
      log(msg);
    });
  } else {
    app.listen(PORT, () => {
      const msg = `Server is listening on Passenger pipe/socket: ${PORT}`;
      console.log(msg);
      log(msg);
    });
  }
}

startServer().catch((err) => {
  log(`CRITICAL ERROR during startServer: ${err?.stack || err}`);
});
