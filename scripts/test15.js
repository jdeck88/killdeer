// square_invoice_report.js
const path = require('path');
const env = process.env.NODE_ENV || 'production';
const envPath = path.resolve(__dirname, `../.env.${env}`);
require('dotenv').config({ path: envPath });
console.log(`✅ Loaded environment: ${env} from ${envPath}`);

const axios = require('axios');
const utilities = require('../src/utils/utilities.pricing');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE_LOCATIONS_URL = 'https://connect.squareup.com/v2/locations';
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';
const BASE_CATALOG_URL = 'https://connect.squareup.com/v2/catalog/list';
const BASE_OBJECT_URL = 'https://connect.squareup.com/v2/catalog/object';
const BASE_PAYMENTS_URL = 'https://connect.squareup.com/v2/payments';

const variationToItem = {};
const itemToCategory = {};
const categoryIdToName = {};

function formatDate(dateStr, isEnd = false) {
  const date = new Date(dateStr);
  if (isEnd) date.setUTCHours(23, 59, 59, 999);
  else date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function getPreviousWeekendRange() {
  const now = new Date();
  const day = now.getUTCDay();
  const end = new Date();
  end.setUTCDate(now.getUTCDate() - (day === 0 ? 1 : day));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

async function fetchFullCatalog() {
  let cursor = null;
  do {
    const res = await axios.get(`${BASE_CATALOG_URL}?types=ITEM,ITEM_VARIATION,CATEGORY${cursor ? `&cursor=${cursor}` : ''}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });
    const objects = res.data.objects || [];
    for (const obj of objects) {
      const { type, id } = obj;
      if (type === 'CATEGORY') {
        categoryIdToName[id] = obj.category_data?.name || 'Unnamed Category';
      }
      if (type === 'ITEM') {
        itemToCategory[id] = obj.item_data?.category_id || obj.item_data?.categories?.[0]?.id || null;
      }
      if (type === 'ITEM_VARIATION') {
        const itemId = obj.item_variation_data?.item_id;
        if (itemId) variationToItem[id] = itemId;
      }
    }
    cursor = res.data.cursor;
  } while (cursor);
}

async function fetchLocationIds() {
  const res = await axios.get(BASE_LOCATIONS_URL, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  return res.data.locations.filter(loc => loc.status === 'ACTIVE').map(loc => ({ id: loc.id, name: loc.name }));
}

async function fetchOrders(locationId, begin, end, cursor = null, collected = []) {
  const body = {
    location_ids: [locationId],
    query: {
      filter: {
        date_time_filter: { created_at: { start_at: begin, end_at: end } }
      }
    },
    limit: 100
  };
  if (cursor) body.cursor = cursor;

  const res = await axios.post(BASE_ORDERS_URL, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  collected.push(...(res.data.orders || []));
  return res.data.cursor
    ? fetchOrders(locationId, begin, end, res.data.cursor, collected)
    : collected;
}

async function fetchPaymentById(paymentId) {
  const res = await axios.get(`${BASE_PAYMENTS_URL}/${paymentId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  return res.data.payment;
}

async function resolveCategoryName(variationId) {
  if (!variationId) {
    return 'Uncategorized';
  }
  let itemId = variationToItem[variationId];
  if (!itemId) {
    try {
      const res = await axios.get(`${BASE_OBJECT_URL}/${variationId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      itemId = res.data.object.item_variation_data?.item_id;
      variationToItem[variationId] = itemId;
    } catch {
      return 'Uncategorized';
    }
  }
  let categoryId = itemToCategory[itemId];
  if (!categoryId) {
    try {
      const res = await axios.get(`${BASE_OBJECT_URL}/${itemId}`, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
      });
      const item = res.data.object.item_data;
      categoryId = item.category_id || item.categories?.[0]?.id;
      itemToCategory[itemId] = categoryId;
    } catch {
      return 'Uncategorized';
    }
  }

  return categoryIdToName[categoryId] || 'Uncategorized';
}

(async () => {
  let [startArg, endArg] = process.argv.slice(2);
  if (!startArg || !endArg) {
    ({ start: startArg, end: endArg } = getPreviousWeekendRange());
  }

  const begin = formatDate(startArg);
  const end = formatDate(endArg, true);

  await fetchFullCatalog();
  const locations = await fetchLocationIds();

  for (const loc of locations) {
    let totalDiscounts = 0;
    let totalProcessingFees = 0;
    let totalCashReceived = 0;
    let totalCardReceived = 0;
    let totalTips = 0;
    let totalRefunds = 0;
    let totalReturns = 0;
    let totalServiceCharges = 0;
    let orderCount = 0;
    let categoryItemCount = 0;
    let categorySales = {};

    const orders = await fetchOrders(loc.id, begin, end);
    for (const order of orders) {
      orderCount++;
      totalDiscounts += order.total_discount_money?.amount || 0;
      totalTips += order.total_tip_money?.amount || 0;
      totalServiceCharges += order.total_service_charge_money?.amount || 0;
      if (order.return_amounts) {
        totalReturns += order.return_amounts.total_money?.amount || 0;
      }
      if (order.line_items) {
        for (const item of order.line_items) {
          if (item.item_type !== 'ITEM') continue;
          const variationId = item.catalog_object_id;
          const amount = item.total_money?.amount || 0;
          const category = await resolveCategoryName(variationId);
          categorySales[category] = (categorySales[category] || 0) + amount;
          categoryItemCount++;
        }
      }
      if (order.tenders) {
        for (const tender of order.tenders) {
          const amt = tender.amount_money?.amount || 0;
          if (tender.type === 'CASH') totalCashReceived += amt;
          if (tender.type === 'CARD') totalCardReceived += amt;
          if (tender.payment_id) {
            try {
              const payment = await fetchPaymentById(tender.payment_id);
              const fees = payment.processing_fee || [];
              for (const fee of fees) {
                totalProcessingFees += fee.amount_money?.amount || 0;
              }
              const refunds = payment.refunds || [];
              for (const refund of refunds) {
                totalRefunds += refund.amount_money?.amount || 0;
              }
            } catch (err) {
              console.warn(`⚠️ Failed to fetch payment ${tender.payment_id}:`, err.message);
            }
          }
        }
      }
    }

    const totalSales = Object.values(categorySales).reduce((sum, val) => sum + val, 0);
    const netDeposit = totalCardReceived - totalProcessingFees - totalRefunds;

    console.log(`\n📋 INVOICE REPORT for ${loc.name}: ${startArg} to ${endArg}`);
    console.log(`  Orders: ${orderCount}`);
    console.log(`  Total Sales: $${(totalSales / 100).toFixed(2)}`);

    console.log(`\n🛒 CATEGORY SALES:`);
    for (const [cat, amt] of Object.entries(categorySales)) {
      console.log(`  • ${cat}: $${(amt / 100).toFixed(2)}`);
    }
    console.log(`  --------------------------------------------------`);
    console.log(`  Subtotal (Category Sales): $${(totalSales / 100).toFixed(2)} for ${categoryItemCount} items`);

    console.log(`\n💵 RECEIVED:`);
    console.log(`  • Cash Received:     $${(totalCashReceived / 100).toFixed(2)}`);
    console.log(`  • Card Received:     $${(totalCardReceived / 100).toFixed(2)}`);

    console.log(`\n➕ ADDITIONS:`);
    console.log(`  • Tips:              $${(totalTips / 100).toFixed(2)}`);
    console.log(`  • Service Charges:   $${(totalServiceCharges / 100).toFixed(2)}`);

    console.log(`\n➖ SUBTRACTIONS:`);
    console.log(`  • Discounts:         -$${(totalDiscounts / 100).toFixed(2)}`);
    console.log(`  • Returns:           -$${(totalReturns / 100).toFixed(2)}`);
    console.log(`  • Refunds:           -$${(totalRefunds / 100).toFixed(2)}`);
    console.log(`  • Square Fees:       -$${(totalProcessingFees / 100).toFixed(2)}`);

    console.log(`\n✅ Net Deposit to Bank: $${(netDeposit / 100).toFixed(2)}\n`);
  }

  process.exit(0);
})();

