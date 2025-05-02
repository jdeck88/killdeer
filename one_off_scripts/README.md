Scripts directory contains node scripts for working with the DFF database and LL and Square.

This directory requires installation of .env file defining variable values

`populateIdentifiersFromLL.js`  -- Populate Identifiers from LocalLine

`exportPricelistForLL.js` -- create a spreadsheet that i can use to import to LL.  This script reads the database and then creates a spreadsheet that we can bulk import to LL.  Doing this will update all inventory.  If there are any new products they will be inserted into LL.  Run the `populateIdentifiersFromLL.js` script after this script.

`populateIdentifiersFromLL.js` -- connects to Local Line and downloads the "Local Line Product ID", "Package ID" and "internal ID". Populates a table called localline in back-end database. This then uses the "internal ID" to update the localline product identifiers in the pricelist table. 
