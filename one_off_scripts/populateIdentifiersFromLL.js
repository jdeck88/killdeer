const fs = require('fs');
const XLSX = require('xlsx');
const _ = require('lodash');
require('dotenv').config();
const mysql = require('mysql2/promise');
const utilities = require('../utilities');

async function run_analyzer(url) {
    try {
        // Fetch Access Token
        const data = await utilities.getAccessToken();
        const accessToken = JSON.parse(data).access;
        const input_file = 'data/products.xlsx';

        // Download Excel file
        await utilities.downloadBinaryData(url, input_file, accessToken);

        // Load the workbook
        const workbook = XLSX.readFile(input_file);

        // Read sheets (Case-sensitive)
        const availabilitySheet = workbook.Sheets['Availability'];
        const packagesSheet = workbook.Sheets['Packages and pricing'];

        if (!availabilitySheet || !packagesSheet) {
            throw new Error('One or both sheets are missing in the workbook.');
        }

        // Convert sheets to JSON arrays
        const availabilityData = XLSX.utils.sheet_to_json(availabilitySheet, { header: 1 });
        const packagesData = XLSX.utils.sheet_to_json(packagesSheet, { header: 1 });

        // Create a lookup for Local Line Product ID -> Internal ID
        const availabilityMap = {};
        availabilityData.slice(1).forEach(row => {
            const productID = row[0]; // Local Line Product ID
            const internalID = row[1]; // Internal ID

            if (productID) {
                availabilityMap[productID] = internalID;
            }
        });

        // Extract packages and join with availability
        const packages = packagesData.slice(1).map(row => ({
            LocalLineProductID: row[0],
            PackageID: row[6]
        }));

        // Generate final dataset with one-to-many relationship
        const mergedData = packages.map(pkg => ({
            LocalLineProductID: pkg.LocalLineProductID,
            InternalID: availabilityMap[pkg.LocalLineProductID] || 'N/A',
            PackageID: pkg.PackageID
        }));

        // Convert merged data to CSV format
        const csvHeader = "Local Line Product ID,Internal ID,Package ID\n";
        const csvData = mergedData.map(row =>
            `${row.LocalLineProductID},${row.InternalID},${row.PackageID}`
        ).join('\n');

        const output_file = 'data/products_output.csv';
        fs.writeFileSync(output_file, csvHeader + csvData);
        console.log(output_file + ' written successfully with ' + mergedData.length + ' rows');

        // Insert data into MySQL and update pricelist
        await insertIntoDatabase(mergedData);

    } catch (error) {
        console.log('Error: ' + error.message);
    }
}

async function insertIntoDatabase(data) {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DFF_DB_HOST,
            user: process.env.DFF_DB_USER,
            password: process.env.DFF_DB_PASSWORD,
            database: process.env.DFF_DB_DATABASE,
            port: process.env.DFF_DB_PORT
        });

        console.log("Connected to database.");

        // Create table if it does not exist
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS localline (
                id INT AUTO_INCREMENT PRIMARY KEY,
                local_line_product_id VARCHAR(255) NOT NULL,
                internal_id VARCHAR(255),
                package_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await connection.execute(createTableQuery);

        // Truncate table to remove old data
        await connection.execute("TRUNCATE TABLE localline;");
        console.log("Table 'localline' truncated.");

        // Insert new data
        const insertQuery = `
            INSERT INTO localline (local_line_product_id, internal_id, package_id)
            VALUES (?, ?, ?);
        `;

        const insertPromises = data.map(row =>
            connection.execute(insertQuery, [row.LocalLineProductID, row.InternalID, row.PackageID])
        );

        await Promise.all(insertPromises);
        console.log(`Inserted ${data.length} rows into 'localline'.`);

        // **UPDATE pricelist Table**
        console.log("Updating pricelist table...");
        const updateQuery = `
            UPDATE pricelist p
            JOIN localline l ON p.id = l.internal_id
            SET 
                p.localLineProductID = l.local_line_product_id,
                p.packageID = l.package_id;
        `;

        const [updateResult] = await connection.execute(updateQuery);
        console.log(`Updated ${updateResult.affectedRows} rows in 'pricelist'.`);

    } catch (error) {
        console.error("Database error:", error.message);
    } finally {
        if (connection) {
            await connection.end();
            console.log("Database connection closed.");
        }
    }
}

// Run the script
run_analyzer('https://localline.ca/api/backoffice/v2/products/export/?file_type=packlist_by_order&is_box=false');

