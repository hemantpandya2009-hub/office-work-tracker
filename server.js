const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// SESSION CONFIGURATION
app.use(session({
  secret: 'office-tracker-secure-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

// DATABASE INITIALIZATION
const db = new sqlite3.Database('./tracker.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to the SQLite database.');
});

db.run(`CREATE TABLE IF NOT EXISTS work_records (id INTEGER PRIMARY KEY AUTOINCREMENT, agency TEXT, file_no TEXT, subject TEXT, due_date TEXT, priority TEXT, comments TEXT, status TEXT DEFAULT 'Pending', attachment TEXT)`, () => {
  db.run(`ALTER TABLE work_records ADD COLUMN attachment TEXT`, (err) => {});
});
db.run(`CREATE TABLE IF NOT EXISTS task_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER, update_text TEXT, update_date TEXT)`);

// Create Users Table and auto-inject Master Admin
// Create Users Table and auto-inject Master Admin
db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT, agencies TEXT)`, () => {
  // Force update the existing admin username and password
  db.run(`UPDATE users SET username = 'HP', password = '1952' WHERE role = 'admin'`);

  db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO users (username, password, role, agencies) VALUES ('HP', '1952', 'admin', 'ALL')`);
    }
  });
});
// AUTHENTICATION ROUTES
app.get('/login.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'login.html')); });

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
    if (user) {
        req.session.loggedIn = true;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.agencies = user.agencies.split(','); 
        res.redirect('/');
    } else {
        res.send('<script>alert("Invalid username or password!"); window.location.href="/login.html";</script>');
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// THE BOUNCER
app.use((req, res, next) => {
  if (req.session.loggedIn) next();
  else res.redirect('/login.html');
});

function isAuthorized(req, targetAgency) {
  if (req.session.role === 'admin') return true;
  return req.session.agencies.includes(targetAgency);
}

// FILE UPLOADS
const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, './public/uploads/'); },
  filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });

app.use(express.static('public'));

// ADMIN PANEL API ROUTES
app.get('/api/users', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
  db.all(`SELECT id, username, role, agencies FROM users`, [], (err, rows) => { if (err) res.status(500).send("Error"); else res.json(rows); });
});

app.post('/api/users', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
  const { username, password, role, agencies } = req.body;
  const agencyString = Array.isArray(agencies) ? agencies.join(',') : agencies;
  db.run(`INSERT INTO users (username, password, role, agencies) VALUES (?, ?, ?, ?)`, [username, password, role, agencyString], function(err) {
      if (err) res.status(500).send("Error creating user."); else res.send("Success");
  });
});

app.delete('/api/users/:id', (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).send("Unauthorized");
  db.get(`SELECT username FROM users WHERE id = ?`, [req.params.id], (err, row) => {
      if (err || !row) return res.status(500).send("Error");
      
      // Protect the new admin username 'HP' from being deleted
      if (row.username === 'HP' || row.username === req.session.username) return res.status(403).send("Cannot delete this admin.");
      
      db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], (err) => { if (err) res.status(500).send("Error"); else res.send("Success"); });
  });
});
// MAIN APP API ROUTES (WITH RBAC & READ-ONLY PROTECTION)
app.post('/add-work', upload.single('attachment'), (req, res) => {
  if (req.session.role === 'viewer') return res.send('<script>alert("READ-ONLY ACCOUNT: You cannot add new records."); window.location.href="/add-work.html";</script>');
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  if (!isAuthorized(req, agency)) return res.send('<script>alert("UNAUTHORIZED"); window.location.href="/add-work.html";</script>');
  
  const attachment = req.file ? req.file.filename : null; 
  db.run(`INSERT INTO work_records (agency, file_no, subject, due_date, priority, comments, status, attachment) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`, 
    [agency, file_no, subject, due_date, priority, comments, attachment], function(err) {
    if (err) res.send('Error'); else res.send(`<script>alert("Saved!"); window.location.href = "/add-work.html";</script>`);
  });
});

app.get('/api/work', (req, res) => {
  let query = `SELECT w.*, (SELECT update_text FROM task_updates WHERE work_id = w.id ORDER BY id DESC LIMIT 1) as latest_update, (SELECT update_date FROM task_updates WHERE work_id = w.id ORDER BY id DESC LIMIT 1) as latest_update_date FROM work_records w`;
  let params = [];
  if (req.session.role !== 'admin') {
      const placeholders = req.session.agencies.map(() => '?').join(',');
      query += ` WHERE w.agency IN (${placeholders})`; params = req.session.agencies;
  }
  query += ` ORDER BY w.id DESC`;
  db.all(query, params, (err, rows) => { if (err) res.status(500).send("Error"); else res.json(rows); });
});

app.get('/api/search', (req, res) => {
  const searchTerm = req.query.q.trim();
  let query = `SELECT * FROM work_records WHERE `;
  let params = [];
  if (searchTerm.startsWith('#')) {
      query += `id = ?`; params.push(searchTerm.replace('#', ''));
  } else {
      const likeTerm = `%${searchTerm}%`; query += `(file_no LIKE ? OR subject LIKE ?)`; params.push(likeTerm, likeTerm);
  }
  if (req.session.role !== 'admin') {
      const placeholders = req.session.agencies.map(() => '?').join(',');
      query += ` AND agency IN (${placeholders})`; params.push(...req.session.agencies);
  }
  query += ` ORDER BY id DESC`;
  db.all(query, params, (err, rows) => { if (err) res.status(500).send("Error"); else res.json(rows); });
});

app.delete('/api/work/:id', (req, res) => {
  if (req.session.role === 'viewer') return res.status(403).send("READ-ONLY ACCOUNT: Cannot delete.");
  db.get(`SELECT agency FROM work_records WHERE id = ?`, [req.params.id], (err, row) => {
      if (err || !row || !isAuthorized(req, row.agency)) return res.status(403).send("Unauthorized");
      db.run(`DELETE FROM work_records WHERE id = ?`, [req.params.id], (err) => { if (err) res.status(500).send("Error"); else res.send("Success"); });
  });
});

app.get('/api/work/:id', (req, res) => {
  db.get(`SELECT * FROM work_records WHERE id = ?`, [req.params.id], (err, row) => {
    if (err || !row || !isAuthorized(req, row.agency)) return res.status(403).send("Unauthorized");
    res.json(row);
  });
});

app.post('/edit-work/:id', upload.single('attachment'), (req, res) => {
  if (req.session.role === 'viewer') return res.send('<script>alert("READ-ONLY ACCOUNT: You cannot edit records."); window.location.href="/my-work.html";</script>');
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  if (!isAuthorized(req, agency)) return res.send('<script>alert("UNAUTHORIZED"); window.location.href="/my-work.html";</script>');
  db.get(`SELECT agency FROM work_records WHERE id = ?`, [req.params.id], (err, row) => {
      if (err || !row || !isAuthorized(req, row.agency)) return res.send('<script>alert("UNAUTHORIZED"); window.location.href="/my-work.html";</script>');
      if (req.file) {
        db.run(`UPDATE work_records SET agency=?, file_no=?, subject=?, due_date=?, priority=?, comments=?, attachment=? WHERE id=?`, [agency, file_no, subject, due_date, priority, comments, req.file.filename, req.params.id], checkErr);
      } else {
        db.run(`UPDATE work_records SET agency=?, file_no=?, subject=?, due_date=?, priority=?, comments=? WHERE id=?`, [agency, file_no, subject, due_date, priority, comments, req.params.id], checkErr);
      }
  });
  function checkErr(err) { if (err) res.send('Error'); else res.send(`<script>alert("Updated!"); window.location.href = "/my-work.html";</script>`); }
});

app.post('/api/work/:id/complete', (req, res) => {
  if (req.session.role === 'viewer') return res.status(403).send("READ-ONLY ACCOUNT: Cannot complete tasks.");
  db.get(`SELECT agency FROM work_records WHERE id = ?`, [req.params.id], (err, row) => {
      if (err || !row || !isAuthorized(req, row.agency)) return res.status(403).send("Unauthorized");
      db.run(`UPDATE work_records SET status = 'Completed' WHERE id = ?`, [req.params.id], (err) => { if (err) res.status(500).send("Error"); else res.send("Success"); });
  });
});

app.get('/api/work/:id/updates', (req, res) => {
  db.all(`SELECT * FROM task_updates WHERE work_id = ? ORDER BY id DESC`, [req.params.id], (err, rows) => { if (err) res.status(500).send("Error"); else res.json(rows); });
});

app.post('/api/work/:id/updates', (req, res) => {
  if (req.session.role === 'viewer') return res.status(403).send("READ-ONLY ACCOUNT: Cannot add updates.");
  const { update_text } = req.body;
  const update_date = new Date().toISOString().split('T')[0]; 
  db.run(`INSERT INTO task_updates (work_id, update_text, update_date) VALUES (?, ?, ?)`, [req.params.id, update_text, update_date], (err) => {
    if (err) res.status(500).send("Error"); else res.send("Success");
  });
});
// PASSWORD RESET ROUTES
app.get('/reset-password.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.post('/reset-password', (req, res) => {
  const { username, new_password, admin_key } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) {
      return res.send('<script>alert("User not found!"); window.location.href="/reset-password.html";</script>');
    }

    // Require emergency recovery key if resetting the Master Admin 'HP'
    if (user.role === 'admin') {
      if (admin_key !== '1952-recover') {
        return res.send('<script>alert("Unauthorized: Invalid Master Recovery Key for Admin account."); window.location.href="/reset-password.html";</script>');
      }
    }

    db.run(`UPDATE users SET password = ? WHERE username = ?`, [new_password, username], (updateErr) => {
      if (updateErr) {
        res.send('<script>alert("Error updating password."); window.location.href="/reset-password.html";</script>');
      } else {
        res.send('<script>alert("Password successfully reset! Please log in."); window.location.href="/login.html";</script>');
      }
    });
  });
});
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});