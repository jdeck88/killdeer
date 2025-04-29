const axios = require('axios');
var request = require('request');
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");

// Validate and parse environment variables
const MEMBER_MARKUP = parseFloat(process.env.MEMBER_MARKUP);
const GUEST_MARKUP = parseFloat(process.env.GUEST_MARKUP);
const DISCOUNT = parseFloat(process.env.DISCOUNT);
const LL_BASEURL = "https://localline.ca/api/backoffice/v2/"
const LL_TEST_COMPANY_BASEURL = "https://deck-test.localline.ca";

const LL_TEST_PRICE_LISTS = {
  test1: { id: 5332, markup: MEMBER_MARKUP },
  test2: { id: 5333, markup: MEMBER_MARKUP },
  guest: { id: 4757, markup: GUEST_MARKUP }
};

// Validation
if (isNaN(MEMBER_MARKUP) || isNaN(GUEST_MARKUP) || isNaN(DISCOUNT)) {
  throw new Error('One or more FFCSA pricing environment variables are missing or invalid. Please check your .env file.');
}

// get access token
async function getAccessToken(p_username, p_password) {
  const { data: auth } = await axios.post(LL_BASEURL + "token", {
    username: p_username,
    password: p_password
  });
  return auth.access;
}

// sendEmail passes in emailOptions as argument
async function sendEmail(emailOptions) {
  console.log('sendEmail function')
  // Create a Nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: "Gmail", // e.g., "Gmail" or use your SMTP settings
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_ACCESS,
    },
  });

  // Send the email with the attachment
  transporter.sendMail(emailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}

// ✅ Secure Database Connection
const db = mysql.createPool({
  host: process.env.DFF_DB_HOST,
  port: process.env.DFF_DB_PORT,
  user: process.env.DFF_DB_USER,
  password: process.env.DFF_DB_PASSWORD,
  database: process.env.DFF_DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10, // Adjust as needed
  queueLimit: 0
});

// ✅ Test connection once
const isScript = require.main !== module;

if (!isScript) {
  (async () => {
    try {
      const connection = await db.getConnection();
      console.log("✅ Connected to database");
      connection.release();
    } catch (err) {
      console.error("❌ Database connection error on startup:", err);
    }
  })();
}

setInterval(async () => {
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error("❌ Connection issue:", err);
  }
}, 30000);


module.exports = {
  db,
  getAccessToken,
  sendEmail,
  GUEST_MARKUP,
  MEMBER_MARKUP,
  DISCOUNT,
  LL_BASEURL,
  LL_TEST_PRICE_LISTS
};