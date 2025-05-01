require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';
const BASE_CATALOG_URL = 'https://connect.squareup.com/v2/catalog/object';

const months = [
  '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
  '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'
];

const MAX_DEPTH = 100;

// Simple in-memory caches
const catalogCache = {};
const categoryNameCache = {};

function getMonthRange(month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  end.setUTCSeconds(-1);
  return { begin_time: start.toISOString(), end_time: end.toISOString() };
}

async function fetchOrdersForMonth(begin_time, end_time, cursor = null, collected = [], depth = 0) {
  if (depth > MAX_DEPTH) throw new Error("Too many pages.");

  const body = {
    location_ids: [LOCATION_ID],
    query: {
      filter: {
        date_time_filter: {
          created_at: {
            start_at: begin_time,
            end_at: end_time
          }
        }
      }
    },
    limit: 100,
  };

  if (cursor) body.cursor = cursor;

  const response = await axios.post(BASE_ORDERS_URL, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  const orders = response.data.orders || [];
  collected.push(...orders);

  if (response.data.cursor) {
    return fetchOrdersForMonth(begin_time, end_time, response.data.cursor, collected, depth + 1);
  }

  return collected;
}

async function getCategoryNameFromItem(itemId) {
  // Check the cache first
  if (catalogCache[itemId]) return catalogCache[itemId];

  try {
    const itemResponse = await axios.get(`${BASE_CATALOG_URL}/${itemId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const categoryId = itemResponse.data.object?.item_data?.category_id;
    if (!categoryId) {
      catalogCache[itemId] = 'Uncategorized';
      return 'Uncategorized';
    }

    if (categoryNameCache[categoryId]) {
      catalogCache[itemId] = categoryNameCache[categoryId];
      return categoryNameCache[categoryId];
    }

    const categoryResponse = await axios.get(`${BASE_CATALOG_URL}/${categoryId}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const categoryName = categoryResponse.data.object?.category_data?.name || 'Unknown';
    categoryNameCache[categoryId] = categoryName;
    catalogCache[itemId] = categoryName;

    return categoryName;
  } catch (err) {
    // Handle 404 errors (deleted or missing items)
    if (err.response?.status === 404) {
      catalogCache[itemId] = 'Deleted or Missing Item';
      return 'Deleted or Missing Item';
    }
    console.warn(`⚠️ Error fetching catalog for ${itemId}:`, err.message);
    catalogCache[itemId] = 'Unknown';
    return 'Unknown';
  }
}

async function getCategorySalesForMonth(month) {
  const { begin_time, end_time } = getMonthRange(month);
  const orders = await fetchOrdersForMonth(begin_time, end_time);
  const categorySales = {};

  for (const order of orders) {
    if (!order.line_items) continue;

    for (const lineItem of order.line_items) {
      // Skip non-item line items (e.g., modifiers, custom charges)
      if (lineItem.item_type !== 'ITEM') continue;

      const itemId = lineItem.catalog_object_id;
      const amount = lineItem.total_money?.amount || 0;

      if (!itemId) {
        categorySales["Unknown"] = (categorySales["Unknown"] || 0) + amount;
        continue;
      }

      const categoryName = await getCategoryNameFromItem(itemId);

      categorySales[categoryName] = (categorySales[categoryName] || 0) + amount;
    }
  }

  return categorySales;
}

(async () => {
  for (const month of months) {
    console.log(`\n📅 Category Sales for ${month}:`);
    const categorySales = await getCategorySalesForMonth(month);

    for (const [category, total] of Object.entries(categorySales)) {
      console.log(`${category}: $${(total / 100).toFixed(2)}`);
    }
  }
})();

