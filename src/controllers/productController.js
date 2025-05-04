const Product = require("../models/Product");
const utilities = require("../utils/utilities.pricing");
const tokenManager = require("../utils/tokenManager");

//
// ---------- CORE LOGIC FUNCTIONS (Reusable in scripts) ----------
//

/**
 * Fetch product data directly from DB
 */
async function fetchProductData() {
  const sqlQuery = `
        SELECT id, category, productName, packageName, description, localLineProductID, visible, track_inventory, stock_inventory
        FROM pricelist WHERE available_on_ll is true ORDER BY category, productName`;
  const [results] = await utilities.db.query(sqlQuery);
  return results;
}

/**
 * Update inventory for a given product ID with provided inventory data
 */
async function updateInventoryById(productId, inventoryData) {
  const accessToken = await tokenManager.getValidAccessToken();
  const product = new Product(productId);
  await product.init();

  const updateStatus = await product.updateInventory(inventoryData, accessToken); 

  return updateStatus;
}

/**
 * Update package price for a given product ID
 */
async function updatePackagePriceById(productId) {
  const accessToken = await tokenManager.getValidAccessToken();
  const product = new Product(productId);
  await product.init();
  await product.updatePackagePrice(accessToken);
  return { message: "Package updated successfully" };
}

//
// ---------- EXPRESS CONTROLLERS ----------
//

exports.getProductData = async (req, res) => {
  try {
    const results = await fetchProductData();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};

exports.updateInventory = async (req, res) => {
  try {
    const result = await updateInventoryById(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.updatePackagePrice = async (req, res) => {
  try {
    const result = await updatePackagePriceById(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


//
// ---------- EXPORT CORE LOGIC FOR SCRIPTS ----------
//

exports.fetchProductData = fetchProductData;
exports.updateInventoryById = updateInventoryById;
exports.updatePackagePriceById = updatePackagePriceById;
