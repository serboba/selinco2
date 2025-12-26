const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, '..');

console.log('Inspecting Excel file structures...\n');

// Inspect steel imports
try {
  const importsWB = XLSX.readFile(path.join(INPUT_DIR, 'steel_imports_hs72.xlsx'));
  console.log('=== STEEL IMPORTS ===');
  console.log('Sheets:', importsWB.SheetNames);
  const sheet = importsWB.Sheets[importsWB.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Total rows: ${data.length}`);
  if (data.length > 0) {
    console.log('\nFirst row keys:', Object.keys(data[0]));
    console.log('First 3 rows:');
    data.slice(0, 3).forEach((row, i) => {
      console.log(`\nRow ${i + 1}:`, JSON.stringify(row, null, 2));
    });
  }
} catch (e) {
  console.error('Error reading steel imports:', e.message);
}

console.log('\n=== ETS DATA ===');
try {
  const etsWB = XLSX.readFile(path.join(INPUT_DIR, 'ETS_data.xlsx'));
  console.log('Sheets:', etsWB.SheetNames);
  const sheet = etsWB.Sheets[etsWB.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Total rows: ${data.length}`);
  if (data.length > 0) {
    console.log('\nFirst row keys:', Object.keys(data[0]));
    console.log('First 3 rows:');
    data.slice(0, 3).forEach((row, i) => {
      console.log(`\nRow ${i + 1}:`, JSON.stringify(row, null, 2));
    });
  }
} catch (e) {
  console.error('Error reading ETS data:', e.message);
}

console.log('\n=== INDUSTRY DATA ===');
try {
  const industryWB = XLSX.readFile(path.join(INPUT_DIR, 'industry.xlsx'));
  console.log('Sheets:', industryWB.SheetNames);
  const sheet = industryWB.Sheets[industryWB.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log(`Total rows: ${data.length}`);
  if (data.length > 0) {
    console.log('\nFirst row keys:', Object.keys(data[0]));
    console.log('First 3 rows:');
    data.slice(0, 3).forEach((row, i) => {
      console.log(`\nRow ${i + 1}:`, JSON.stringify(row, null, 2));
    });
  }
} catch (e) {
  console.error('Error reading industry data:', e.message);
}

