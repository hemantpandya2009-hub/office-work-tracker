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

// Create the work table if it doesn't already exist (UPDATED WITH COMMENTS)
db.run(`CREATE TABLE IF NOT EXISTS work_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agency TEXT,
  file_no TEXT,
  subject TEXT,
  due_date TEXT,
  priority TEXT,
  comments TEXT
)`, (err) => {
  if (err) {
    console.log('Table already exists or error creating table');
  }
});

// Catch the data from the form and save it to the database (UPDATED WITH COMMENTS)
app.post('/add-work', (req, res) => {
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  
  const query = `INSERT INTO work_records (agency, file_no, subject, due_date, priority, comments) VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [agency, file_no, subject, due_date, priority, comments], function(err) {
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
  const query = `SELECT * FROM work_records ORDER BY id DESC`; 
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send("Error retrieving records");
    } else {
      res.json(rows); 
    }
  });
});

// Search the database by exact ID, or partial File No/Subject
app.get('/api/search', (req, res) => {
  const searchTerm = req.query.q.trim();
  
  if (searchTerm.startsWith('#')) {
    const idToSearch = searchTerm.replace('#', ''); 
    const query = `SELECT * FROM work_records WHERE id = ?`;
    
    db.all(query, [idToSearch], (err, rows) => {
      if (err) {
        res.status(500).send("Error searching records");
      } else {
        res.json(rows);
      }
    });
  } 
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
// Fetch a single record to pre-fill the edit form
app.get('/api/work/:id', (req, res) => {
  const query = `SELECT * FROM work_records WHERE id = ?`;
  
  // Notice we use db.get() here instead of db.all() because we only want one row
  db.get(query, [req.params.id], (err, row) => {
    if (err) {
      res.status(500).send("Error fetching record");
    } else {
      res.json(row);
    }
  });
});

// Save the updated record back to the database
app.post('/edit-work/:id', (req, res) => {
  const { agency, file_no, subject, due_date, priority, comments } = req.body;
  const idToUpdate = req.params.id;
  
  const query = `UPDATE work_records SET agency = ?, file_no = ?, subject = ?, due_date = ?, priority = ?, comments = ? WHERE id = ?`;
  
  db.run(query, [agency, file_no, subject, due_date, priority, comments, idToUpdate], function(err) {
    if (err) {
      console.error(err.message);
      res.send('Error updating record.');
    } else {
      console.log(`Record #${idToUpdate} was successfully updated.`);
      res.send(`<script>
        alert("Work Record Updated Successfully!");
        window.location.href = "/my-work.html";
      </script>`);
    }
  });
});
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});