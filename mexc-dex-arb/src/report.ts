// npm run report -- [hours] [mode] [--csv]   e.g. `npm run report -- 168 paper`
// With --csv: opportunities per token and Dhaka hour, as CSV (for a spreadsheet).
import 'dotenv/config';
import { Db } from './db.js';
import { formatReport } from './summary.js';
import { opportunitiesCsv } from './kpi.js';

const args = process.argv.slice(2).filter((a) => a !== '--csv');
const csv = process.argv.includes('--csv');
const hours = Number(args[0] ?? 24);
const mode = args[1] ?? process.env.MODE ?? 'paper';
const db = new Db(process.env.DB_PATH || `data/${process.env.CHAIN || 'ethereum'}.sqlite`);
console.log(csv ? opportunitiesCsv(db, Date.now() - hours * 3600_000) : formatReport(db, mode, hours, 'Report'));
db.close();
