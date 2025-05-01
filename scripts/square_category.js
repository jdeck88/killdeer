require('dotenv').config();
const axios = require('axios');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';
const BASE_CATALOG_URL = 'https://connect.squareup.com/v2/catalog/list';
const BASE_OBJECT_URL = 'https://connect.squareup.com/v2/catalog/object';

const months = [
  '2025-05'
];

const MAX_DEPTH = 100;

// In-memory mappings
const variationToItem = {};
const itemToCategory = {};
const categoryIdToName = {};

function getMonthRange(month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  end.setUTCSeconds(-1);
  return { begin_time: start.toISOString(), end_time: end.toISOString() };
}

async function fetchFullCatalog() {
  let cursor = null;
  do {
    const response = await axios.get(`${BASE_CATALOG_URL}?types=ITEM,ITEM_VARIATION,CATEGORY${cursor ? `&cursor=${cursor}` : ''}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    const objects = response.data.objects || [];
    for (const obj of objects) {
	  //console.log("DEBUG item_data:", obj);

      const { type, id } = obj;

      if (type === 'CATEGORY') {
        categoryIdToName[id] = obj.category_data?.name || 'Unnamed Category';
      }

      if (type === 'ITEM') {
	  itemToCategory[id] = obj.item_data?.category_id || null;

      }

      if (type === 'ITEM_VARIATION') {
        const itemId = obj.item_variation_data?.item_id;
        if (itemId) variationToItem[id] = itemId;
      }
    }

    cursor = response.data.cursor;
  } while (cursor);
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

async function resolveCategoryNameWithFallback(variationId) {
  let itemId = variationToItem[variationId];

  // 🔍 Step 1: Try to resolve item from variation if unknown
  if (!itemId) {
    try {
      const response = await axios.get(`https://connect.squareup.com/v2/catalog/object/${variationId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });

      const obj = response.data.object;
      if (obj?.type === 'ITEM_VARIATION') {
        itemId = obj.item_variation_data?.item_id;
        variationToItem[variationId] = itemId; // cache
        console.log(`✅ Resolved itemId '${itemId}' from variation '${variationId}'`);
      }
    } catch (err) {
      //console.warn(`❌ Cannot resolve variation ${variationId}: ${err.message}`);
      return 'Unknown Variation';
    }
  }

  if (!itemId) {
    //console.warn(`⚠️ Still no itemId for variation: ${variationId}`);
    return 'Unknown Variation';
  }

  // 🧠 Step 2: Resolve categoryId from item, using new + legacy formats
  let categoryId = itemToCategory[itemId];
  if (!categoryId) {
    try {
      const itemRes = await axios.get(`https://connect.squareup.com/v2/catalog/object/${itemId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });

      const itemObj = itemRes.data.object;
      const itemData = itemObj.item_data;

      // 👇 Support all possible category sources
      categoryId =
        itemData?.category_id ||  // legacy
        itemData?.reporting_category?.id || // new
        (itemData?.categories?.[0]?.id ?? null); // fallback

      itemToCategory[itemId] = categoryId; // cache it
      //console.log(`🧾 Item '${itemId}' category: ${categoryId || 'NONE'}`);
    } catch (err) {
      //console.warn(`❌ Could not fetch item ${itemId}: ${err.message}`);
      return 'Unknown Category';
    }
  }

  if (!categoryId) return 'Uncategorized';

  const categoryName = categoryIdToName[categoryId];
  if (!categoryName) {
    //console.warn(`⚠️ No category name for categoryId: ${categoryId}`);
    return 'Unknown Category';
  }

  return categoryName;
}

async function getCategorySalesForMonth(month) {
  const { begin_time, end_time } = getMonthRange(month);
  const orders = await fetchOrdersForMonth(begin_time, end_time);
  const categorySales = {};

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

  return categorySales;
}

// MAIN EXECUTION
(async () => {
  console.log("📦 Fetching full Square catalog...");
  await fetchFullCatalog();

  for (const month of months) {
    console.log(`\n📅 Category Sales for ${month}:`);
    const categorySales = await getCategorySalesForMonth(month);

    for (const [category, total] of Object.entries(categorySales)) {
      console.log(`${category}: $${(total / 100).toFixed(2)}`);
    }
  }
})();

