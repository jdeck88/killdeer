require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const utilities = require('../src/utils/utilities.pricing');

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE_LOCATIONS_URL = 'https://connect.squareup.com/v2/locations';
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';

const MAX_DEPTH = 100;

function formatDate(dateStr, isEnd = false) {
	const date = new Date(dateStr);
	if (isEnd) {
		date.setUTCHours(23, 59, 59, 999);
	} else {
		date.setUTCHours(0, 0, 0, 0);
	}
	return date.toISOString();
}

function getPriorDayString() {
	const date = new Date();
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
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

(async () => {
	const startArg = process.argv[2] || getPriorDayString();
	const endArg = process.argv[3] || startArg;
	const begin_time = formatDate(startArg);
	const end_time = formatDate(endArg, true);

	console.log(`📆 Fetching orders from ${startArg} to ${endArg} (${begin_time} to ${end_time})`);

	const locations = await fetchLocationIds();
	const salesByLocation = {};
	const ordersByLocation = {};

	for (const loc of locations) {
		const orders = await fetchOrdersForLocation(loc.id, begin_time, end_time);
		if (!ordersByLocation[loc.id]) {
			ordersByLocation[loc.id] = [];
			salesByLocation[loc.id] = { name: loc.name, total: 0, orders: [] };
		}

		for (const order of orders) {
			const amount = order.total_money?.amount || 0;
			salesByLocation[loc.id].total += amount;
			salesByLocation[loc.id].orders.push(order);
		}
	}

	let summaryText = `📊 Square Sales Summary for ${startArg} to ${endArg}:
\n`;
	let totalMarketsWithSales = 0;
	let grandTotal = 0;

	for (const { name, total, orders } of Object.values(salesByLocation)) {
		if (total > 0) {
			summaryText += `🧾 ${name}\n`;
			summaryText += `  Total Sales: $${(total / 100).toFixed(2)} from ${orders.length} orders\n\n`;
			totalMarketsWithSales++;
			grandTotal += total;
		}
	}

	if (totalMarketsWithSales === 0) {
		console.log("📭 No sales for any location. No email sent.");
		process.exit(0);
	}

	summaryText += `💰 Grand Total: $${(grandTotal / 100).toFixed(2)}\n`;

	const emailOptions = {
		from: "jdeck88@gmail.com",
		to: "info@deckfamilyfarm.com",
		cc: "jdeck88@gmail.com",
		subject: `Square Market Report: ${startArg} to ${endArg}`,
		text: summaryText
	};

	await utilities.sendEmail(emailOptions);
	console.log("📧 Email sent.");
	process.exit(0);
})();

