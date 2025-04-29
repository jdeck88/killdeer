const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");

const { authenticateToken } = require("../middleware/auth");

router.get("/get-product-data", authenticateToken, productController.getProductData);
router.put("/update-inventory/:id", authenticateToken, productController.updateInventory);
router.put("/update-package-price/:id", authenticateToken, productController.updatePackagePrice);

module.exports = router;