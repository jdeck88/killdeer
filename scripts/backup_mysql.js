const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const mysqldump = require('mysqldump');

const env = process.env.NODE_ENV || 'production';
const envPath = path.resolve(__dirname, `../.env.${env}`);
require('dotenv').config({ path: envPath });

console.log(`✅ Loaded environment: ${env} from ${envPath}`);

const {
	DFF_DB_HOST,
	DFF_DB_PORT,
	DFF_DB_USER,
	DFF_DB_PASSWORD,
	DFF_DB_DATABASE
} = process.env;

if (!DFF_DB_HOST || !DFF_DB_USER || !DFF_DB_DATABASE) {
	console.error("❌ Missing required DB environment variables.");
	process.exit(1);
}

// Get current date info
const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const iso = now.toISOString().replace(/[:.]/g, '-');

const week = Math.ceil((now.getDate() + now.getDay()) / 7); // crude week number
const baseDir = path.resolve(__dirname, '../backups');

const backupSets = [
	{ name: 'daily', filename: `${DFF_DB_DATABASE}_${yyyy}-${mm}-${dd}.sql.gz` },
	{ name: 'weekly', filename: `${DFF_DB_DATABASE}_${yyyy}-W${week}.sql.gz` },
	{ name: 'monthly', filename: `${DFF_DB_DATABASE}_${yyyy}-${mm}.sql.gz` },
];

// Ensures backup directories exist
for (const set of backupSets) {
	fs.mkdirSync(path.join(baseDir, set.name), { recursive: true });
}

async function performBackup(destPath) {
	const tempSQL = path.join(baseDir, `tmp_${iso}.sql`);
	const tempGZ = `${tempSQL}.gz`;

	// 1. Dump SQL
	await mysqldump({
		connection: {
			host: DFF_DB_HOST,
			port: DFF_DB_PORT,
			user: DFF_DB_USER,
			password: DFF_DB_PASSWORD,
			database: DFF_DB_DATABASE,
		},
		dumpToFile: tempSQL,
	});

	// 2. Compress SQL
	await new Promise((resolve, reject) => {
		const gzip = zlib.createGzip();
		const source = fs.createReadStream(tempSQL);
		const dest = fs.createWriteStream(tempGZ);
		source.pipe(gzip).pipe(dest).on('finish', resolve).on('error', reject);
	});

	// 3. Move to each backup set
	for (const set of backupSets) {
		const finalPath = path.join(baseDir, set.name, set.filename);
		fs.copyFileSync(tempGZ, finalPath);
		console.log(`✅ Saved to ${finalPath}`);
		rotateOldBackups(path.join(baseDir, set.name));
	}

	// 4. Clean temp
	fs.unlinkSync(tempSQL);
	fs.unlinkSync(tempGZ);
}

function rotateOldBackups(folder) {
	const files = fs.readdirSync(folder)
		.filter(f => f.endsWith('.sql.gz'))
		.map(f => ({ file: f, time: fs.statSync(path.join(folder, f)).mtime.getTime() }))
		.sort((a, b) => b.time - a.time);

	const excess = files.slice(5); // keep 5 most recent
	for (const f of excess) {
		const fullPath = path.join(folder, f.file);
		fs.unlinkSync(fullPath);
		console.log(`🗑️ Deleted old backup: ${f.file}`);
	}
}

(async () => {
	try {
		await performBackup();
		process.exit(0);
	} catch (err) {
		console.error("❌ Backup failed:", err.message);
		process.exit(1);
	}
})();

