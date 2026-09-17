const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Create an uploads folder if it doesn't exist
const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './public/uploads/');
  },
  filename: function (req, file, cb) {
    // Save file with the current timestamp to prevent naming collisions
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Allows us to receive JSON data for date-wise updates

const db = new sqlite3.Database('./tracker.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to the SQLite database.');
});

// 1. UPDATED SCHEMA: Added 'attachment' column
db.run(`CREATE TABLE IF NOT EXISTS work_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency TEXT,
  file_no TEXT,
  subject TEXT,
  due_date TEXT,
  priority TEXT,
  comments TEXT,
  status TEXT DEFAULT 'Pending',
  attachment TEXT
)`);

// 2. NEW SCHEMA: Table for date-wise task updates
db.run(`CREATE TABLE IF NOT EXISTS task_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER,
  update_text TEXT,
  update_date TEXT
)`);

// UPDATED: Handle file upload on new task creation
app.post('/add-work', upload.single('attachment'), (req, res) => {
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  const status = 'Pending';
  const attachment = req.file ? req.file.filename : null; 
  
  const query = `INSERT INTO work_records (agency, file_no, subject, due_date, priority, comments, status, attachment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [agency, file_no, subject, due_date, priority, comments, status, attachment], function(err) {
    if (err) res.send('Error saving record.');
    else {
      res.send(`<script>
        alert("Work Record Saved Successfully! Your Work ID is: ${this.lastID}");
        window.location.href = "/add-work.html";
      </script>`);
    }
  });
});

// -- EXISTING ROUTES --
app.get('/api/work', (req, res) => {
  db.all(`SELECT * FROM work_records ORDER BY id DESC`, [], (err, rows) => {
    if (err) res.status(500).send("Error"); else res.json(rows); 
  });
});

app.get('/api/search', (req, res) => {
  const searchTerm = req.query.q.trim();
  if (searchTerm.startsWith('#')) {
    db.all(`SELECT * FROM work_records WHERE id = ?`, [searchTerm.replace('#', '')], (err, rows) => {
      if (err) res.status(500).send("Error"); else res.json(rows);
    });
  } else {
    const likeTerm = `%${searchTerm}%`;
    db.all(`SELECT * FROM work_records WHERE file_no LIKE ? OR subject LIKE ? ORDER BY id DESC`, [likeTerm, likeTerm], (err, rows) => {
      if (err) res.status(500).send("Error"); else res.json(rows); 
    });
  }
});

app.delete('/api/work/:id', (req, res) => {
  db.run(`DELETE FROM work_records WHERE id = ?`, [req.params.id], function(err) {
    if (err) res.status(500).send("Error"); else res.send("Success");
  });
});

app.get('/api/work/:id', (req, res) => {
  db.get(`SELECT * FROM work_records WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) res.status(500).send("Error"); else res.json(row);
  });
});

// UPDATED: Handle file update on edit
app.post('/edit-work/:id', upload.single('attachment'), (req, res) => {
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  
  // If a new file was uploaded, update the attachment column too. Otherwise, leave it alone.
  if (req.file) {
    const query = `UPDATE work_records SET agency=?, file_no=?, subject=?, due_date=?, priority=?, comments=?, attachment=? WHERE id=?`;
    db.run(query, [agency, file_no, subject, due_date, priority, comments, req.file.filename, req.params.id], checkErr);
  } else {
    const query = `UPDATE work_records SET agency=?, file_no=?, subject=?, due_date=?, priority=?, comments=? WHERE id=?`;
    db.run(query, [agency, file_no, subject, due_date, priority, comments, req.params.id], checkErr);
  }

  function checkErr(err) {
    if (err) res.send('Error updating record.');
    else res.send(`<script>alert("Work Record Updated!"); window.location.href = "/my-work.html";</script>`);
  }
});

app.post('/api/work/:id/complete', (req, res) => {
  db.run(`UPDATE work_records SET status = 'Completed' WHERE id = ?`, [req.params.id], function(err) {
    if (err) res.status(500).send("Error"); else res.send("Success");
  });
});

// -- NEW ROUTES FOR DATE-WISE UPDATES --
app.get('/api/work/:id/updates', (req, res) => {
  db.all(`SELECT * FROM task_updates WHERE work_id = ? ORDER BY id DESC`, [req.params.id], (err, rows) => {
    if (err) res.status(500).send("Error"); else res.json(rows);
  });
});

app.post('/api/work/:id/updates', (req, res) => {
  const { update_text } = req.body;
  // Get today's date in YYYY-MM-DD format (India Standard Time context handled by browser usually, but simple date string works here)
  const update_date = new Date().toISOString().split('T')[0]; 
  
  db.run(`INSERT INTO task_updates (work_id, update_text, update_date) VALUES (?, ?, ?)`, [req.params.id, update_text, update_date], function(err) {
    if (err) res.status(500).send("Error"); else res.send("Success");
  });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});