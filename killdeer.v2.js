const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require('path');
const env = process.env.NODE_ENV || 'production';
const envPath = path.resolve(__dirname, `.env.${env}`);
require('dotenv').config({ path: envPath });
console.log(`✅ Loaded environment: ${env} from ${envPath}`);

const productRoutes = require("./src/routes/productRoutes");
const authRoutes = require("./src/routes/authRoutes");

const app = express();
app.set('trust proxy', 1); // ✅ Trust first proxy (e.g., nginx or Heroku)

app.use(express.json());
app.use(helmet());
app.use(cors());
app.use(rateLimit({ windowMs: 5 * 60 * 1000, max: 100 }));

app.use("/killdeer/v2", productRoutes);
app.use("/killdeer/v2", authRoutes);        

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const swaggerDocument = YAML.load('./swagger.yaml');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const PORT = 3402;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
