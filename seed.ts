import fs from 'fs';
import csv from 'csv-parser';
import { DbStorage } from './server/storage'; // Import the class directly
import dotenv from 'dotenv';
import path from 'path';

// --- NEW LOGIC TO READ .env MANUALLY ---
const envPath = path.resolve(__dirname, '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));
const databaseUrl = envConfig.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Could not find DATABASE_URL in the .env file.");
}
// --- END OF NEW LOGIC ---

// Create a new storage instance, passing the URL directly
const storage = new DbStorage(databaseUrl); 

const csvFilePath = './employees.csv';

async function syncFromCSV() {
  const employeesFromCSV: any[] = [];
  console.log('Reading employees from CSV file...');

  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      employeesFromCSV.push({
        name: row["Agent Name"],
        role: row.Department,
        email: `${row.Extension}@company.com`,
        initials: row["Agent Name"] ? row["Agent Name"].split(' ').map((n: string) => n[0]).join('') : 'XX',
      });
    })
    .on('end', async () => {
      console.log('CSV file successfully processed. Starting database sync...');
      for (const employee of employeesFromCSV) {
        if (!employee.name) {
          console.log("Skipping empty row...");
          continue;
        }
        try {
          await storage.createEmployee(employee);
          console.log(`Synced: ${employee.name}`);
        } catch (error) {
          console.error(`Failed to sync ${employee.name}:`, error);
        }
      }
      console.log('Database sync complete!');
    });
}

syncFromCSV();