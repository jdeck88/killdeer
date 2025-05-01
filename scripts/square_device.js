require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE_URL = 'https://connect.squareup.com/v2/payments';

const months = [
  '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
  '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'
];

// Helper function to get the date range for a given month
function getMonthRange(month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  end.setUTCSeconds(-1);
  return { begin_time: start.toISOString(), end_time: end.toISOString() };
}

async function fetchPaymentsForMonth(begin_time, end_time, cursor = null, collected = [], depth = 0) {
  if (depth > 100) throw new Error("Too many pages.");

  const params = {
    begin_time,
    end_time,
    location_id: LOCATION_ID,
    limit: 100,
  };
  if (cursor) params.cursor = cursor;

  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: 'application/json',
      },
      params,
    });

    const payments = response.data.payments || [];
    collected.push(...payments);

    if (response.data.cursor) {
      return fetchPaymentsForMonth(begin_time, end_time, response.data.cursor, collected, depth + 1);
    }

    return collected;
  } catch (error) {
    console.error('❌ Error fetching payments:', error.response?.data || error.message);
    process.exit(1);
  }
}

async function getDeviceSalesForMonth(month) {
  const { begin_time, end_time } = getMonthRange(month);
  const payments = await fetchPaymentsForMonth(begin_time, end_time);
  const deviceSales = {};

  for (const payment of payments) {
    const amount = payment.amount_money?.amount || 0;
    const deviceName = payment.device_details?.device_name || 'Unknown Device';

    // Aggregate sales by device
    if (!deviceSales[deviceName]) {
      deviceSales[deviceName] = 0;
    }
    deviceSales[deviceName] += amount;
  }

  return deviceSales;
}

(async () => {
  for (const month of months) {
    console.log(`\n📅 Sales by Device for ${month}:`);
    const deviceSales = await getDeviceSalesForMonth(month);

    for (const [device, total] of Object.entries(deviceSales)) {
      console.log(`${device}: $${(total / 100).toFixed(2)}`);
    }
  }
})();

