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
const BASE_REFUNDS_URL = 'https://connect.squareup.com/v2/refunds';

const variationToItem = {};
const itemToCategory = {};
const categoryIdToName = {};
const allCategorySales = {};
let allCategoryItemCount = 0;

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
				date_time_filter: { created_at: { start_at: begin, end_at: end } },
				    state_filter: { states: ['COMPLETED'] }

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

async function fetchRefundsForPayment(paymentId) {
	const res = await axios.get(`${BASE_REFUNDS_URL}?payment_id=${paymentId}`, {
		headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
	});
	return res.data.refunds || [];
}

async function resolveCategoryName(variationId) {
	if (!variationId) return 'Uncategorized';
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

// Main execution block continues as previously added
(async () => {
	let [startArg, endArg, locationIdArg] = process.argv.slice(2);
	if (!startArg || !endArg) {
		({ start: startArg, end: endArg } = getPreviousWeekendRange());
	}

	const begin = formatDate(startArg);
	const end = formatDate(endArg, true);

	await fetchFullCatalog();
	const allLocations = await fetchLocationIds();

	const locations = locationIdArg
		? allLocations.filter(loc => loc.id === locationIdArg)
		: allLocations;

	if (locationIdArg && locations.length === 0) {
		console.error(`❌ No matching active location for ID: ${locationIdArg}`);
		process.exit(1);
	}

	const locationSummaries = {};

	for (const loc of locations) {
		const orders = await fetchOrders(loc.id, begin, end);
		const summary = {
			locationName: loc.name,
			orderCount: 0,
			locationTotal: 0,
			discounts: 0,
			tips: 0,
			serviceCharges: 0,
			cash: 0,
			card: 0,
			fees: 0,
			card_refunds: 0,
			cash_refunds: 0,
		};

		for (const order of orders) {
			//console.log(order.total_money.amount/100+','+summary.orderCount );
			summary.orderCount++;
			summary.locationTotal += order.total_money?.amount || 0;
			summary.discounts += order.total_discount_money?.amount || 0;
			summary.tips += order.total_tip_money?.amount || 0;
			summary.serviceCharges += order.total_service_charge_money?.amount || 0;

			if (order.line_items) {
				for (const item of order.line_items) {
					if (item.item_type !== 'ITEM') continue;
					const variationId = item.catalog_object_id;
					const amount = item.total_money?.amount || 0;
					const category = await resolveCategoryName(variationId);
					allCategorySales[category] = (allCategorySales[category] || 0) + amount;
					allCategoryItemCount++;
				}
			}

			if (order.tenders) {
				for (const tender of order.tenders) {
					const amt = tender.amount_money?.amount || 0;
					// Add in processing_fee_money which is used in split transactions
					summary.fees += tender.processing_fee_money?.amount || 0;
					if (tender.type === 'CASH') summary.cash += amt;
					if (tender.type === 'CARD') summary.card += amt;
					if (tender.payment_id) {
						try {
							const payment = await fetchPaymentById(tender.payment_id);
							for (const fee of payment.processing_fee || []) {
								summary.fees += fee.amount_money?.amount || 0;
							}
							if (tender.type === 'CASH') {
								summary.cash_refunds += payment.refunded_money?.amount || 0;
							} else {
								summary.card_refunds += 0;
							}
							if (tender.type === 'CARD') {
								summary.card_refunds += payment.refunded_money?.amount || 0;
							} else {
								summary.cash_refunds += 0;
							}
						} catch (err) {
							console.warn(`⚠️ Payment fetch failed: ${tender.payment_id}`);
						}
					}
				}
			}
		}

		//const net = summary.card - summary.fees - summary.card_refunds - summary.cash_refunds;
		const net_deposit = summary.card - summary.fees - summary.card_refunds; 
		if (net_deposit > 0) locationSummaries[loc.name] = { ...summary, net_deposit };
	}

	const grand = {
		orders: 0,
		locationTotal: 0,
		discounts: 0,
		tips: 0,
		serviceCharges: 0,
		cash: 0,
		card: 0,
		fees: 0,
		card_refunds: 0,
		cash_refunds: 0,
		net_deposit: 0
	};

	for (const summary of Object.values(locationSummaries)) {
		grand.orders += summary.orderCount;
		grand.locationTotal += summary.locationTotal;
		grand.discounts += summary.discounts;
		grand.tips += summary.tips;
		grand.serviceCharges += summary.serviceCharges;
		grand.cash += summary.cash - summary.cash_refunds;
		grand.card += summary.card - summary.card_refunds;
		grand.fees += summary.fees;
		grand.cash_refunds += summary.cash_refunds;
		grand.card_refunds += summary.card_refunds;
		grand.net_deposit += summary.net_deposit; 
	}

	let summaryText = `** LOCATION REPORT: ${startArg} to ${endArg} **\n`;

	const adjustedGrandGrossSales = ((grand.locationTotal + grand.cash_refunds + grand.card_refunds + grand.discounts) / 100).toFixed(2);
	const adjustedGrandTotalSales = ((grand.locationTotal - grand.cash_refunds - grand.card_refunds) / 100).toFixed(2);

	for (const [name, s] of Object.entries(locationSummaries)) {
		const locationTotalSales = Math.abs(((s.locationTotal - s.cash_refunds - s.card_refunds) / 100).toFixed(2));
		const locationDiscounts = Math.abs(s.discounts / 100).toFixed(2);
		const locationCardRefunds = Math.abs(s.card_refunds / 100).toFixed(2);
		const locationCashRefunds = Math.abs(s.cash_refunds / 100).toFixed(2);
		summaryText += `  • ${name}: $${locationTotalSales} (${s.orderCount} orders, Discounts: -$${locationDiscounts}, Card Refunds: -$${locationCardRefunds}, Cash Refunds: -$${locationCashRefunds})\n`;
	}

	summaryText += `Location Subtotal: $${adjustedGrandTotalSales} (${grand.orders} orders)\n\n`;
	summaryText += `** INVOICE REPORT: ${startArg} to ${endArg} **\n`;

	const categoryTotal = Object.values(allCategorySales).reduce((a, b) => a + b, 0);
	const uncategorizedDiff = (adjustedGrandTotalSales * 100) - categoryTotal;

	if (Math.abs(uncategorizedDiff) > 0) {
		allCategorySales['Uncategorized'] = (allCategorySales['Uncategorized'] || 0) + uncategorizedDiff;
	}

	for (const [cat, amt] of Object.entries(allCategorySales)) {
		summaryText += `  • ${cat}: $${(amt / 100).toFixed(2)}\n`;
	}

	summaryText += `Categories Subtotal: $${(Object.values(allCategorySales).reduce((a, b) => a + b, 0) / 100).toFixed(2)}\n`;
	//summaryText += `  • Cash Refunds:     -$${(grand.cash_refunds / 100).toFixed(2)}\n`;
	summaryText += `  • Square Fees: -$${(grand.fees / 100).toFixed(2)}\n`;

	summaryText += `\n** DEPOSITS **\n`;
	summaryText += `  • Cash: $${(grand.cash / 100).toFixed(2)}\n`;
	summaryText += `  • Cards: $${(grand.card / 100).toFixed(2)}\n`;
	summaryText += `Deposits Subtotal: $${(grand.net_deposit / 100).toFixed(2)}\n`;

	if (grand.tips > 0 || grand.serviceCharges > 0) {
		summaryText += `\nPossible ADDITIONS:\n`;
		if (grand.tips > 0) {
			summaryText += `  • Tips:              $${(grand.tips / 100).toFixed(2)}\n`;
		}
		if (grand.serviceCharges > 0) {
			summaryText += `  • Service Charges:   $${(grand.serviceCharges / 100).toFixed(2)}\n`;
		}
	}


	const emailOptions = {
		from: "jdeck88@gmail.com",
		to: "info@deckfamilyfarm.com",
		cc: "jdeck88@gmail.com",
		subject: `Square Market Report: ${startArg} to ${endArg}`,
		text: summaryText
	};

	await utilities.sendEmail(emailOptions);
	console.log("📧 Email sent.");
	//console.log(summaryText)
	process.exit(0);

})();

