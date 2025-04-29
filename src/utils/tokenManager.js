const utilities = require("../utils/utilities.pricing");

let cachedToken = null;
let tokenExpiry = null;  // Timestamp in ms

async function getValidAccessToken() {
  const now = Date.now();

  if (cachedToken && tokenExpiry && now < tokenExpiry) {
    return cachedToken;  // Return cached token if still valid
  }

  // Fetch new token
  const newTokenData = await utilities.getAccessToken(process.env.LL_USERNAME, process.env.LL_PASSWORD);
  
  cachedToken = newTokenData.token || newTokenData;  // Adjust based on return format
  tokenExpiry = now + (60 * 60 * 1000);  // Example: token valid for 1 hour

  return cachedToken;
}

module.exports = { getValidAccessToken };
