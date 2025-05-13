const path = require('path');
const env = process.env.NODE_ENV || 'production';
const envPath = path.resolve(__dirname, `../.env.${env}`);
require('dotenv').config({ path: envPath });
console.log(`✅ Loaded environment: ${env} from ${envPath}`);

const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE_LOCATIONS_URL = 'https://connect.squareup.com/v2/locations';

(async () => {
  try {
    const res = await axios.get(BASE_LOCATIONS_URL, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const locations = res.data.locations || [];

    console.log('\n📍 ACTIVE SQUARE LOCATIONS:');
    for (const loc of locations) {
      if (loc.status === 'ACTIVE') {
        console.log(`  • ${loc.name.padEnd(30)}  ID: ${loc.id}`);
      }
    }
    console.log('');
  } catch (err) {
    console.error('❌ Failed to fetch locations:', err.response?.data || err.message);
    process.exit(1);
  }
})();

