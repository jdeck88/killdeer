const path = require('path');
const env = process.env.NODE_ENV || 'development';
require('dotenv').config({ path: path.resolve(__dirname, `../.env.${env}`) });
const axios = require('axios');
const utilities = require('../src/utils/utilities.pricing');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE_LOCATIONS_URL = 'https://connect.squareup.com/v2/locations';
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';
const BASE_CATALOG_URL = 'https://connect.squareup.com/v2/catalog/list';
const BASE_OBJECT_URL = 'https://connect.squareup.com/v2/catalog/object';

const MAX_DEPTH = 100;
const variationToItem = {};
const itemToCategory = {};
const categoryIdToName = {};

function formatDate(dateStr, isEnd = false) {
  const date = new Date(dateStr);
  if (isEnd) {
    date.setUTCHours(23, 59, 59, 999);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

function getPreviousWeekendRange() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday

  // If it's Sunday, go back to previous Sat/Sun
  const offset = day === 0 ? 1 : 7 + day; // e.g., Monday = 8, Saturday = 13

  const endDate = new Date();
  endDate.setUTCDate(now.getUTCDate() - (day === 0 ? 1 : day));

  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - 1);

  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10)
  };
}

async function fetchFullCatalog() {
  let cursor = null;
  do {
    const response = await axios.get(`${BASE_CATALOG_URL}?types=ITEM,ITEM_VARIATION,CATEGORY${cursor ? `&cursor=${cursor}` : ''}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const objects = response.data.objects || [];
    for (const obj of objects) {
      const { type, id } = obj;

      if (type === 'CATEGORY') {
        categoryIdToName[id] = obj.category_data?.name || 'Unnamed Category';
      }

      if (type === 'ITEM') {
        itemToCategory[id] = obj.item_data?.category_id || obj.item_data?.reporting_category?.id || (obj.item_data?.categories?.[0]?.id ?? null);
      }

      if (type === 'ITEM_VARIATION') {
        const itemId = obj.item_variation_data?.item_id;
        if (itemId) variationToItem[id] = itemId;
      }
    }

    cursor = response.data.cursor;
  } while (cursor);
}

async function fetchLocationIds() {
  const response = await axios.get(BASE_LOCATIONS_URL, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  return response.data.locations
    .filter(loc => loc.status === 'ACTIVE')
    .map(loc => ({ id: loc.id, name: loc.name }));
}

async function fetchOrdersForLocation(locationId, begin_time, end_time, cursor = null, collected = [], depth = 0) {
  if (depth > MAX_DEPTH) throw new Error("Too many pages.");

  const body = {
    location_ids: [locationId],
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
    limit: 100
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
    return fetchOrdersForLocation(locationId, begin_time, end_time, response.data.cursor, collected, depth + 1);
  }

  return collected;
}

async function resolveCategoryNameWithFallback(variationId) {
  let itemId = variationToItem[variationId];

  if (!itemId) {
    try {
      const response = await axios.get(`${BASE_OBJECT_URL}/${variationId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      const obj = response.data.object;
      if (obj?.type === 'ITEM_VARIATION') {
        itemId = obj.item_variation_data?.item_id;
        variationToItem[variationId] = itemId;
      }
    } catch {
      return 'Unknown Variation';
    }
  }

  if (!itemId) return 'Unknown Variation';

  let categoryId = itemToCategory[itemId];
  if (!categoryId) {
    try {
      const itemRes = await axios.get(`${BASE_OBJECT_URL}/${itemId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      const itemData = itemRes.data.object.item_data;
      categoryId = itemData?.category_id || itemData?.reporting_category?.id || (itemData?.categories?.[0]?.id ?? null);
      itemToCategory[itemId] = categoryId;
    } catch {
      return 'Unknown Category';
    }
  }

  if (!categoryId) return 'Uncategorized';
  return categoryIdToName[categoryId] || 'Unknown Category';
}

(async () => {
  let startArg = process.argv[2];
  let endArg = process.argv[3];

  if (!startArg || !endArg) {
    const weekend = getPreviousWeekendRange();
    startArg = weekend.start;
    endArg = weekend.end;
  }

  const begin_time = formatDate(startArg);
  const end_time = formatDate(endArg, true);

  console.log("📦 Fetching full Square catalog...");
  await fetchFullCatalog();
  const locations = await fetchLocationIds();
  const categorySales = {};

  for (const loc of locations) {
    const orders = await fetchOrdersForLocation(loc.id, begin_time, end_time);

    for (const order of orders) {
      if (!order.line_items) continue;

      for (const lineItem of order.line_items) {
        if (lineItem.item_type !== 'ITEM') continue;

        const variationId = lineItem.catalog_object_id || lineItem.variation_catalog_object_id;
        const amount = lineItem.total_money?.amount || 0;

        const category = await resolveCategoryNameWithFallback(variationId);
        categorySales[category] = (categorySales[category] || 0) + amount;
      }
    }
  }

  let summaryText = `📊 Category Sales Summary for ${startArg} to ${endArg}:
\n`;
  let hasSales = false;
  let grandTotal = 0;

  for (const [category, total] of Object.entries(categorySales)) {
    if (total > 0) {
      summaryText += `${category}: $${(total / 100).toFixed(2)}\n`;
      hasSales = true;
      grandTotal += total;
    }
  }

  if (!hasSales) {
    console.log("📭 No category sales found. No email sent.");
    process.exit(0);
  }

  summaryText += `\nTotal: $${(grandTotal / 100).toFixed(2)}\n`;

  const emailOptions = {
    from: "jdeck88@gmail.com",
    to: "info@deckfamilyfarm.com",
    cc: "jdeck88@gmail.com",
    subject: `Square Category Report: ${startArg} to ${endArg}`,
    text: summaryText
  };

  await utilities.sendEmail(emailOptions);
  console.log("📧 Email sent.");
  process.exit(0);
})();

