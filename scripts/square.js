require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

const START_DATE = '2024-01-01T00:00:00Z';
const END_DATE = '2024-12-31T23:59:59Z';
const BASE_URL = 'https://connect.squareup.com/v2/payments';

async function fetchPayments(cursor = null, total = 0) {
  try {
    const params = {
      begin_time: START_DATE,
      end_time: END_DATE,
      location_id: LOCATION_ID,
      limit: 100,
    };
    if (cursor) params.cursor = cursor;

    const response = await axios.get(BASE_URL, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: 'application/json',
      },
      params,
    });

    const payments = response.data.payments || [];
    const newTotal = total + payments.reduce((sum, p) => sum + (p.amount_money?.amount || 0), 0);

    if (response.data.cursor) {
      // More results to fetch
	  console.log("fetching more results...");
      return fetchPayments(response.data.cursor, newTotal);
    }

    return newTotal;
  } catch (error) {
    console.error('❌ Error fetching payments:', error.response?.data || error.message);
    process.exit(1);
  }
}

(async () => {
  const totalCents = await fetchPayments();
  const totalDollars = (totalCents / 100).toFixed(2);
  console.log(`💰 Total sales for 2024: $${totalDollars}`);
})();

