require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const utilities = require('../src/utils/utilities.pricing');

// Square API config
const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const BASE_LOCATIONS_URL = 'https://connect.squareup.com/v2/locations';
const BASE_ORDERS_URL = 'https://connect.squareup.com/v2/orders/search';

// Max pages of results to prevent infinite loops
const MAX_DEPTH = 100;

// Utility: ISO string from YYYY-MM-DD input
function formatDate(dateStr, isEnd = false) {
	const date = new Date(dateStr);
	if (isEnd) {
		date.setUTCHours(23, 59, 59, 999);
	} else {
		date.setUTCHours(0, 0, 0, 0);
	}
	return date.toISOString();
}

// Get all active location IDs
async function fetchLocationIds() {
	const response = await axios.get(BASE_LOCATIONS_URL, {
		headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
	});
	return response.data.locations
		.filter(loc => loc.status === 'ACTIVE')
		.map(loc => ({ id: loc.id, name: loc.name }));
}

// Fetch orders for a location in the date range
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
	const dayArg = process.argv[2] || new Date().toISOString().slice(0, 10); // default: today
	const begin_time = formatDate(dayArg);
	const end_time = formatDate(dayArg, true);

	console.log(`📆 Fetching orders for ${dayArg} (${begin_time} to ${end_time})`);

	const locations = await fetchLocationIds();
	const salesByLocation = {};

	for (const loc of locations) {
		const orders = await fetchOrdersForLocation(loc.id, begin_time, end_time);
		let total = 0;

		for (const order of orders) {
			const amount = order.total_money?.amount || 0;
			total += amount;
		}

		salesByLocation[loc.name] = total;
	}
	// Build summary text, filtering for only non-zero totals
	let summaryText = `📊 Square Sales Summary for ${dayArg}:\n\n`;
	let totalMarketsWithSales = 0;

	for (const [loc, total] of Object.entries(salesByLocation)) {
		if (total > 0) {
			summaryText += `${loc}: $${(total / 100).toFixed(2)}\n`;
			totalMarketsWithSales++;
		}
	}

	// 🛑 If no markets had sales, do not send email
	if (totalMarketsWithSales === 0) {
		console.log("📭 No sales for any location. No email sent.");
		process.exit(0);
	}

	// ✅ Send email if any sales were recorded
	const emailOptions = {
		from: "jdeck88@gmail.com",
		to: "jdeck88@gmail.com",
		subject: `Square Market Report: ${dayArg}`,
		text: summaryText
	};

	await utilities.sendEmail(emailOptions);
	console.log("📧 Email sent.");
	process.exit(0);

})();

