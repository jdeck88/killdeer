const axios = require('axios');
const jwt = require('jsonwebtoken');

let cachedToken = null;
let tokenExpiry = null;

/**
 * Middleware to authenticate incoming JWT tokens
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];  // Expecting "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    req.user = user;
    next();
  });
}

/**
 * Get & cache JWT token for outbound API calls
 */
async function getToken() {
  const now = Date.now();

  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;   // ✅ Use cached token
  }

  try {
    const response = await axios.post(`${process.env.API_BASE_URL}/login`, {
      username: process.env.API_USER,
      password: process.env.API_PASS
    });

    cachedToken = response.data.token;

    // Decode JWT to get expiry (standard "exp" field)
    const [, payloadBase64] = cachedToken.split('.');
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
    tokenExpiry = payload.exp * 1000;  // Convert to milliseconds

    console.log("✅ New JWT token fetched");
    return cachedToken;

  } catch (err) {
    console.error("❌ Failed to retrieve JWT token:", err.message);
    throw new Error('Authentication failed');
  }
}

module.exports = {
  authenticateToken,
  getToken
};

