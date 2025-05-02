// Import necessary libraries
require('dotenv').config({ override: true });  // Forces override of system-level variables
const mysql = require('mysql2/promise');  // MySQL for database queries
const xlsx = require('xlsx');  // Library to create Excel files
const fs = require('fs');  // File system to save Excel file

async function queryDatabase() {
    // Database connection configuration from .env file
    const connectionConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 25060,  // Default to 3306 if not specified
        ssl: {
            ca: fs.readFileSync(process.env.DB_CA_PATH),  // Load the CA certificate
            rejectUnauthorized: true  // Verify the certificate
        }
    };

    try {
        // Create a connection to the database
        const connection = await mysql.createConnection(connectionConfig);

        console.log('Connected to the database successfully.');

        // SQL query to join master_price_list and inventory and fetch specific fields
        const query = `
            SELECT 
                mpl.localLineProductID,
                mpl.packageID,
                mpl.productName,
                mpl.packageName,
                mpl.current_dff_to_ffcsa_sales_price AS 'Unit Price',
                CASE WHEN inv.track_inventory THEN 'True' ELSE 'False' END AS track_inventory,
                inv.inventory,
                CASE WHEN inv.visible THEN 'True' ELSE 'False' END AS visible
            FROM master_price_list mpl
            LEFT JOIN inventory inv ON mpl.id = inv.id;
        `;

        // Execute the query
        const [rows] = await connection.execute(query);

        // Close the connection
        await connection.end();
        console.log('Connection closed.');

        // Convert the query result to a worksheet
        const worksheet = xlsx.utils.json_to_sheet(rows);

        // Create a new workbook and append the worksheet
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Inventory Report');

        // Define the output Excel file path
        const filePath = './inventory_report.xlsx';

        // Write the Excel file
        xlsx.writeFile(workbook, filePath);
        console.log(`Excel file written to ${filePath}`);

    } catch (error) {
        console.error('Error querying the database or writing the Excel file:', error);
    }
}

// Run the function
queryDatabase();

