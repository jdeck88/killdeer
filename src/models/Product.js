const path = require('path');
const fs = require('fs');
const fastCsv = require("fast-csv");

const axios = require("axios");
const utilities = require("../utils/utilities.pricing");

class Product {
  constructor(productId) {
    this.productId = productId;
    this.data = null;
  }

  async init() {
    const [rows] = await utilities.db.query("SELECT * FROM pricelist WHERE id = ?", [this.productId]);
    if (rows.length === 0) {
      throw new Error(`Product ID ${this.productId} not found in database`);
    }

    this.data = rows[0];

    // Now that data is loaded, calculate pricing
    this.pricing = this.#calculatePrices();
  }

  static async getLLCategory(pricelistID, category) {
    /*const [rows] = await utilities.db.query(
      "SELECT categoryID FROM categories WHERE pricelistID = ? AND categoryName = ?",
      [pricelistID, category]
    );
    if (rows.length === 0) throw new Error("Category not found");
    return rows[0].categoryID;*/
    // TODO: fetch local line categoryID 
    return 0;
  }

  async addToLLPricelist(pricelistID, accessToken) {
    const payload = { pricelist_id: pricelistID, product_id: this.productId };
    await axios.post(`${utilities.LL_BASEURL}pricelists/add/`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  async updateInventory({ visible, track_inventory, stock_inventory }, accessToken) {
    try {
      const id = this.productId

      const payload = {
        visible,
        track_inventory,
        set_inventory: stock_inventory,
      };

      // ✅ Query product details
      const [results] = await utilities.db.query(
        "SELECT productName, packageName,  localLineProductID FROM pricelist WHERE id = ?",
        [this.productId]
      );

      if (results.length === 0) {
        throw new Error("Product not found");
      }

      const { productName,  packageName, localLineProductID } = results[0];

      // ✅ Perform the database update
      await utilities.db.query(
        "UPDATE pricelist SET visible=?, track_inventory=?, stock_inventory=? WHERE id=?",
        [visible, track_inventory, stock_inventory, this.productId]
      );


      // ✅ Structured response object
      let updateStatus = {
        id,
        productName,
        databaseUpdate: true,
        localLineUpdate: false
      };

      // ✅ Append change to CSV file
      const logFilePath = path.join(__dirname, "../../data/inventory_updates_log.csv");

      if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(
          logFilePath,
          "id,productName,packageName,visible,track_inventory,stock_inventory,timestamp\n",
          "utf8"
        );
      }

      const timestamp = new Date().toISOString();

      const logEntry = [
        id,
        productName,
        packageName,
        visible,
        track_inventory,
        stock_inventory,
        timestamp
      ];

      const writableStream = fs.createWriteStream(logFilePath, { flags: "a", encoding: "utf8" });

      fastCsv
        .writeToStream(writableStream, [logEntry], { headers: false, quote: true })
        .on("finish", () => {
          fs.appendFileSync(logFilePath, "\n");
          console.log("✅ Data appended to CSV successfully.");
        })
        .on("error", (err) => console.error("❌ Error writing to CSV file:", err));

      // ✅ Attempt LocalLine API update
      if (this.data.localLineProductID) {
        try {
          let payload = {
            visible: visible,
            track_inventory: track_inventory
          };

          if (track_inventory === true || stock_inventory === 0) {
            payload.set_inventory = Number(stock_inventory);
          }

          if (Object.keys(payload).length > 0) {
            await axios.patch(`${utilities.LL_BASEURL}products/${this.data.localLineProductID}/`,payload, { headers: { Authorization: `Bearer ${accessToken}` }, });
            console.log(`✅ LocalLine product ${this.data.localLineProductID} updated:`, payload);
            updateStatus.localLineUpdate = true;
          }
        } catch (error) {
          utilities.sendEmail({
            from: "jdeck88@gmail.com",
            to: "jdeck88@gmail.com",
            subject: "LocalLine API update failed",
            text: `API update failed for ${localLineProductID}`
          });
          console.error(`❌ LocalLine API update failed for ${localLineProductID}:`, error);
          updateStatus.localLineUpdate = false;
        }
      } else {
        utilities.sendEmail({
          from: "jdeck88@gmail.com",
          to: "jdeck88@gmail.com",
          subject: "LocalLine API update failed",
          text: `We do not have a record of this product in LocalLine: ${localLineProductID}`
        });

        console.error(`❌ No record found in LocalLine for ${localLineProductID}`);
        updateStatus.localLineUpdate = false;
      }
      return updateStatus;

    } catch (error) {
      console.error("❌ Error in Product Module:", error);
      throw Error;
    }
  }

  async updatePackagePrice(accessToken) {
    for (const listName in utilities.LL_PRICE_LISTS) {
      const { id, markup } = utilities.LL_PRICE_LISTS[listName];
      await updatePackagePriceInPricelist(accessToken, id);
    }
  }

  async updatePackagePriceInPricelist(accessToken, pricelistID) {
    const payload = {
      packages: [{
        id: this.data.localLineProductID,
        name: this.data.packageName,  // TODO: make this work for packages
        unit_price: this.pricing.purchasePrice,
        package_code: this.data.upc,
        price_list_entries: [{
          price_list: pricelistID,
          adjustment: true,
          adjustment_type: 2,
          adjustment_value: margin * 100,
          calculated_value: (this.pricing.purchasePrice * (1 + margin)).toFixed(2)
        }]
      }],
      description: this.data.description,
      on_sale: false,  // TODO: CHECK THIS
      category: this.data.category,
      num_item_units: this.data.num_of_items
    };

    try {
      const url = `${utilities.LL_BASEURL}products/${this.data.localLineProductID}/?expand=vendor`;
      await axios.patch(url, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      console.log(`✅ Successfully updated product ID ${this.productId} on LocalLine`);
    } catch (error) {
      console.error(`❌ Failed to update LocalLine product.`);
      console.error(`URL: ${error.config?.url}`);
      console.error(`Error:`, error.response?.data || error.message);
    }
  }

  #calculatePrices() {
    const DISCOUNT = parseFloat(process.env.DISCOUNT);
    const MEMBER_MARKUP = parseFloat(process.env.MEMBER_MARKUP);
    const GUEST_MARKUP = parseFloat(process.env.GUEST_MARKUP);

    let ffcsaPurchasePrice = 0;

    if (this.data.dff_unit_of_measure === 'lbs') {
      const avgWeight = (Number(this.data.highest_weight) + Number(this.data.lowest_weight)) / 2;
      ffcsaPurchasePrice = avgWeight * this.data.retailSalesPrice * DISCOUNT;
    } else if (this.data.dff_unit_of_measure === 'each') {
      ffcsaPurchasePrice = this.data.retailSalesPrice * DISCOUNT;
    } else {
      throw new Error(`Unknown unit of measure: ${this.data.dff_unit_of_measure}`);
    }

    return {
      purchasePrice: Number(ffcsaPurchasePrice.toFixed(2)),
      memberSalesPrice: Number((ffcsaPurchasePrice * (1 + MEMBER_MARKUP)).toFixed(2)),
      guestSalesPrice: Number((ffcsaPurchasePrice * (1 + GUEST_MARKUP)).toFixed(2)),
      productID: Number(this.data.localLineProductID)
    };
  }
}

module.exports = Product;
