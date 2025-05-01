require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE_URL = 'https://connect.squareup.com/v2/payments';

const MAX_DEPTH = 100;

const months = [
  '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
  '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'
];

function getMonthDateRange(month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  end.setUTCSeconds(-1); // last second of the last day

  return {
    begin_time: start.toISOString(),
    end_time: end.toISOString()
  };
}

async function fetchPayments(begin_time, end_time, cursor = null, total = 0, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new Error("Too many pages fetched — possible infinite loop.");
  }

  try {
    const params = {
      begin_time,
      end_time,
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
    const pageTotal = payments.reduce((sum, p) => sum + (p.amount_money?.amount || 0), 0);
    const newTotal = total + pageTotal;

    const nextCursor = response.data.cursor;

    if (nextCursor && nextCursor !== cursor) {
      return fetchPayments(begin_time, end_time, nextCursor, newTotal, depth + 1);
    }

    return newTotal;
  } catch (error) {
    console.error('❌ Error fetching payments:', error.response?.data || error.message);
    return total;
  }
}

(async () => {
  let grandTotal = 0;

  for (const month of months) {
    const { begin_time, end_time } = getMonthDateRange(month);
    console.log(`📅 Fetching: ${month} (${begin_time} to ${end_time})`);
    const monthTotal = await fetchPayments(begin_time, end_time);
    console.log(`🧾 ${month}: $${(monthTotal / 100).toFixed(2)}`);
    grandTotal += monthTotal;
  }

  console.log(`\n💰 Total sales for 2024: $${(grandTotal / 100).toFixed(2)}`);
})();

