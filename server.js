const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

// Serve static files (HTML, CSS) from the 'public' folder
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Connect to (or create) the SQLite database file
const db = new sqlite3.Database('./tracker.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Create the work table if it doesn't already exist
db.run(`CREATE TABLE IF NOT EXISTS work_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency TEXT,
  file_no TEXT,
  subject TEXT,
  due_date TEXT,
  priority TEXT
)`, (err) => {
  if (err) {
    console.log('Table already exists or error creating table');
  }
});
// Catch the data from the form and save it to the database
// Catch the data from the form and save it to the database
app.post('/add-work', (req, res) => {
  const { agency, file_no, subject, due_date, priority } = req.body;
  
  const query = `INSERT INTO work_records (agency, file_no, subject, due_date, priority) VALUES (?, ?, ?, ?, ?)`;
  
  db.run(query, [agency, file_no, subject, due_date, priority], function(err) {
    if (err) {
      console.error(err.message);
      res.send('Error saving record.');
    } else {
      // Success! Log it and show a pop-up alert before redirecting back to the form
      console.log(`A new record was added with ID: ${this.lastID}`);
      res.send(`<script>
        alert("Work Record Saved Successfully! Your Work ID is: ${this.lastID}");
        window.location.href = "/add-work.html";
      </script>`);
    }
  });
});
// Send all saved work records to the frontend
app.get('/api/work', (req, res) => {
  const query = `SELECT * FROM work_records ORDER BY id DESC`; // ORDER BY id DESC puts the newest files at the top
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send("Error retrieving records");
    } else {
      res.json(rows); // Sends the data back to the browser
    }
  });
});
// Search the database by ID, File No, or Subject
// Search the database by exact ID, or partial File No/Subject
app.get('/api/search', (req, res) => {
  const searchTerm = req.query.q.trim();
  
  // If the user types #1, search ONLY for that exact Work ID
  if (searchTerm.startsWith('#')) {
    const idToSearch = searchTerm.replace('#', ''); // removes the # to get just the number
    const query = `SELECT * FROM work_records WHERE id = ?`;
    
    db.all(query, [idToSearch], (err, rows) => {
      if (err) {
        res.status(500).send("Error searching records");
      } else {
        res.json(rows);
      }
    });
  } 
  // Otherwise, do a partial search on File Number and Subject
  else {
    const query = `
      SELECT * FROM work_records 
      WHERE file_no LIKE ? OR subject LIKE ? 
      ORDER BY id DESC
    `;
    const likeTerm = `%${searchTerm}%`;
    
    db.all(query, [likeTerm, likeTerm], (err, rows) => {
      if (err) {
        res.status(500).send("Error searching records");
      } else {
        res.json(rows); 
      }
    });
  }
});
// Delete a specific work record by ID
app.delete('/api/work/:id', (req, res) => {
  const idToDelete = req.params.id;
  const query = `DELETE FROM work_records WHERE id = ?`;
  
  db.run(query, [idToDelete], function(err) {
    if (err) {
      console.error(err.message);
      res.status(500).send("Error deleting record");
    } else {
      console.log(`Record #${idToDelete} was successfully deleted.`);
      res.send("Success");
    }
  });
});
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});