require("dotenv").config();
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");

// Database connection
const db = mysql.createConnection({
  host: process.env.DFF_DB_HOST,
  port: process.env.DFF_DB_PORT,
  user: process.env.DFF_DB_USER,
  password: process.env.DFF_DB_PASSWORD,
  database: process.env.DFF_DB_DATABASE,
});

db.connect(async (err) => {
  if (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
  console.log("Connected to database");

  const username = "admin"; // Change if needed
  const plainPassword = process.env.DFF_DB_UI_PASSWORD; 
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  db.query(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, hashedPassword],
    (err, result) => {
      if (err) {
        console.error("Error inserting user:", err);
      } else {
        console.log("User created successfully! You can now log in.");
      }
      db.end(); // Close connection
    }
  );
});

