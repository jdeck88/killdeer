const path = require('path');
const env = process.env.NODE_ENV || 'development';
const envPath = path.resolve(__dirname, `../.env.${env}`);
require('dotenv').config({ path: envPath });
console.log(`✅ Loaded environment: ${env} from ${envPath}`);
const Product = require('../src/models/Product');  // ✅ Capitalized class import
const utilities = require('../src/utils/utilities.pricing');
const { access } = require('fs');

const tokenManager = require("../src/utils/tokenManager");


(async () => {
	// 🔹 Loop All products (demonstrates loop and we can insert price update in this function)
	try {
		// TODO: obtain modification date in pricelist table and just select those that have been modified
		const [rows] = await utilities.db.query("SELECT id FROM pricelist");
		console.log(`🔎 Retrieved ${rows.length} product IDs from database.`);

		for (const row of rows) {
			const product = new Product(row.id);
			try {
				await product.init();
				console.log(`🟢 ID: ${product.productId}, LL ID: ${product.data.localLineProductID}, Name: ${product.data.productName}`);
			} catch (err) {
				console.error(`❌ Failed to initialize product ID ${row.id}:`, err.message);
			}
		}
	} catch (err) {
		console.error("❌ Error fetching product IDs from database:", err.message);
		process.exit(1);
	}

	// 🔹 Initialize and Print LL JSON for One Product
	try {
		const targetProductId = 7; // or use products[0]?.id
		const singleProduct = new Product(targetProductId);
		await singleProduct.init();
		const accessToken = await tokenManager.getValidAccessToken();
		await singleProduct.updateLLPrices(5, accessToken);
	} catch (err) {
		console.error(`❌ Error initializing or serializing product:`, err);
	}

	console.log("🎉 Script execution complete.");
	process.exit(0);
})();
