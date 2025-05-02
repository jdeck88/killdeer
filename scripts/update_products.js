const path = require('path');
const env = process.env.NODE_ENV || 'development';
const envPath = path.resolve(__dirname, `../.env.${env}`);
require('dotenv').config({ path: envPath });
console.log(`✅ Loaded environment: ${env} from ${envPath}`);

const productController = require('../src/controllers/productController');
const { getJwtToken } = require('../src/middleware/auth');

(async () => {
  let products = [];

  // 🔹 Fetch Products Block
  try {
    products = await productController.fetchProductData();
    console.log(`🔎 Retrieved ${products.length} products from database.`);
  } catch (err) {
    console.error("❌ Error fetching products:", err.message);
    process.exit(1);  // Exit if fetching fails
  }

  // 🔹 Update Product Block (only productID = 1)
  try {
    const targetProductId = 1;
    console.log(`🔧 Attempting to update package price for Product ID: ${targetProductId}`);

    await productController.updatePackagePriceById(targetProductId);

    console.log(`✅ Successfully updated package price for Product ID: ${targetProductId}`);
  } catch (err) {
    console.error(`❌ Error updating package price for Product ID 1:`, err.message);
  }

  console.log("🎉 Script execution complete.");
  process.exit(0);
})();

