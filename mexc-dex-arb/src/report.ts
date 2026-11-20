// npm run report -- [hours] [mode]   e.g. `npm run report -- 24 live`
import 'dotenv/config';
import { Db } from './db.js';
import { formatReport } from './summary.js';

const hours = Number(process.argv[2] ?? 24);
const mode = process.argv[3] ?? process.env.MODE ?? 'live';
const db = new Db(process.env.DB_PATH || 'data/bot.sqlite');
console.log(formatReport(db, mode, hours, 'Report'));
db.close();
