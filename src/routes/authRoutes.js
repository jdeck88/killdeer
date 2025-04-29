const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const utilities = require("../utils/utilities.pricing");

// POST /login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [results] = await utilities.db.query("SELECT * FROM users WHERE username = ?", [username]);

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const validPassword = await bcrypt.compare(password, results[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = jwt.sign({ userId: results[0].id }, process.env.JWT_SECRET, { expiresIn: "90d" });
    res.json({ message: "Login successful", token });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
