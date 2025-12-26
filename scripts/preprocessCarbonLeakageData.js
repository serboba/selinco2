const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Simple CSV parser
 */
function parseCSV(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV line handling quoted values
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, '')); // Add last value
    
    if (values.length !== headers.length) continue;
    
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    records.push(record);
  }
  
  return records;
}

// Configuration
const INPUT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'carbon_leakage');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('Starting data preprocessing...\n');

/**
 * Find the first row that looks like actual data (has numeric values)
 */
function findDataStart(sheet, maxRows = 50) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let row = 0; row < Math.min(maxRows, range.e.r); row++) {
    const rowData = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[cellAddress];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
        rowData.push(cell.v);
      }
    }
    // Check if this row has multiple non-empty cells (likely a data row)
    if (rowData.length >= 3) {
      // Check if it has at least one numeric value
      const hasNumeric = rowData.some(v => {
        const num = parseFloat(v);
        return !isNaN(num) && num > 0;
      });
      if (hasNumeric) {
        return row;
      }
    }
  }
  return 0;
}

/**
 * Parse ETS data - extract monthly average prices
 * Filter for steel/iron sectors and aggregate
 */
function parseETSData(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  console.log(`  ETS data: ${data.length} total rows`);
  
  // Filter for steel/iron sectors (code 24) and price-related ETS information
  const steelRows = data.filter(row => {
    const sectorCode = row['Main Activity Code'];
    const sectorName = row['Main Activity Sector Name'] || '';
    const etsInfo = row['ETS information'] || '';
    
    // Check if it's steel/iron sector
    const isSteel = (sectorCode === 24 || sectorCode === '24' || 
                     sectorName.toLowerCase().includes('steel') || 
                     sectorName.toLowerCase().includes('iron'));
    
    // Check if it's price-related (we want actual price data, not allocations)
    // For now, we'll try to find price data - if not available, we'll need to use external source
    return isSteel;
  });
  
  console.log(`  ETS data: ${steelRows.length} steel/iron sector rows`);
  
  // If we have eu_ets_prices.json, use that instead
  const etsPricesPath = path.join(INPUT_DIR, 'public', 'eu_ets_prices.json');
  if (fs.existsSync(etsPricesPath)) {
    console.log('  Using existing eu_ets_prices.json file');
    const etsPrices = JSON.parse(fs.readFileSync(etsPricesPath, 'utf8'));
    
    // Convert annual prices to monthly (assuming constant within year, or interpolate)
    const monthlyData = [];
    etsPrices.forEach(entry => {
      for (let month = 1; month <= 12; month++) {
        monthlyData.push({
          date: new Date(entry.year, month - 1, 1).toISOString(),
          price: entry.price,
          year: entry.year,
          month: month,
          yearMonth: `${entry.year}-${String(month).padStart(2, '0')}`
        });
      }
    });
    
    return monthlyData.sort((a, b) => new Date(a.date) - new Date(b.date));
  }
  
  // Otherwise, try to extract from the data
  // Group by year and calculate average
  const byYear = new Map();
  steelRows.forEach(row => {
    const year = row['Year'];
    const value = parseFloat(row['Value']) || 0;
    if (year && value > 0) {
      if (!byYear.has(year)) {
        byYear.set(year, []);
      }
      byYear.get(year).push(value);
    }
  });
  
  const result = [];
  byYear.forEach((values, year) => {
    const avgPrice = values.reduce((a, b) => a + b, 0) / values.length;
    for (let month = 1; month <= 12; month++) {
      result.push({
        date: new Date(year, month - 1, 1).toISOString(),
        price: avgPrice,
        year: year,
        month: month,
        yearMonth: `${year}-${String(month).padStart(2, '0')}`
      });
    }
  });
  
  return result.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Simple CSV parser for industry data
 */
function parseCSV(csvContent) {
  const lines = csvContent.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Parse header - handle quoted values
  const headerLine = lines[0];
  const headers = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim().replace(/^"|"$/g, '')); // Add last header
  
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV line handling quoted values
    const values = [];
    current = '';
    inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, '')); // Add last value
    
    if (values.length !== headers.length) continue;
    
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || '';
    });
    records.push(record);
  }
  
  return records;
}

/**
 * Parse industry production index from CSV file
 */
function parseIndustryData() {
  // Read CSV file directly
  const csvPath = path.join(INPUT_DIR, 'industry_data_new.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.log('  Industry data: CSV file not found at ' + csvPath);
    return [];
  }
  
  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parseCSV(csvContent);
    
    console.log(`  Industry data: Read ${records.length} rows from CSV`);
    
    if (records.length === 0) {
      console.log('  Industry data: No records found in CSV');
      return [];
    }
    
    // Filter for EU aggregate data
    // Look for European Union aggregates (EU-27, EU-28, or "European Union")
    const euRecords = records.filter(row => {
      const geo = (row.geo || row.GEO || '').toUpperCase();
      return geo.includes('EUROPEAN UNION') || 
             geo.includes('EU-27') || 
             geo.includes('EU-28') ||
             geo.includes('EU27') ||
             geo.includes('EU28');
    });
    
    if (euRecords.length === 0) {
      console.log('  Industry data: No EU aggregate records found');
      return [];
    }
    
    console.log(`  Industry data: Found ${euRecords.length} EU aggregate records`);
    
    // Prefer EU-27 over EU-28, and prefer "from 2020" over older definitions
    const eu27Records = euRecords.filter(r => {
      const geo = (r.geo || r.GEO || '').toUpperCase();
      return (geo.includes('EU-27') || geo.includes('EU27')) && 
             (geo.includes('FROM 2020') || geo.includes('2020'));
    });
    
    const recordsToUse = eu27Records.length > 0 ? eu27Records : euRecords;
    
    // Parse and structure the data
    const periodMap = new Map();
    let validRows = 0;
    
    recordsToUse.forEach(row => {
      const timePeriod = row.TIME_PERIOD || row.time_period || row.TIME;
      const obsValue = row.OBS_VALUE || row.obs_value || row.VALUE || row.OBS_VALUE;
      
      if (!timePeriod || !obsValue || obsValue === '' || obsValue === ':') return;
      
      // Parse date from TIME_PERIOD (format: YYYY-MM)
      const [year, month] = timePeriod.split('-');
      if (!year || !month) return;
      
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) return;
      
      const date = new Date(yearNum, monthNum - 1, 1);
      const yearMonth = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
      
      const indexVal = parseFloat(String(obsValue).replace(/[,\s]/g, ''));
      if (isNaN(indexVal) || indexVal <= 0) return;
      
      // Use the first value for each period (or average if multiple)
      if (!periodMap.has(yearMonth)) {
        periodMap.set(yearMonth, {
          date: date.toISOString(),
          yearMonth: yearMonth,
          year: yearNum,
          month: monthNum,
          index: indexVal,
          count: 1,
          sum: indexVal
        });
        validRows++;
      } else {
        const entry = periodMap.get(yearMonth);
        entry.sum += indexVal;
        entry.count++;
        entry.index = entry.sum / entry.count; // Average if multiple values
        validRows++;
      }
    });
    
    const resultArray = Array.from(periodMap.values())
      .map(entry => ({
        date: entry.date,
        index: entry.index,
        year: entry.year,
        month: entry.month,
        yearMonth: entry.yearMonth
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    console.log(`  Industry data: Parsed ${resultArray.length} unique time periods from ${validRows} records`);
    return resultArray;
    
  } catch (error) {
    console.error('  Industry data: Error parsing CSV:', error.message);
    console.error('  Industry data: Stack:', error.stack);
    return [];
  }
}

/**
 * Parse a single sheet for steel imports data
 */
function parseSteelImportsSheet(sheet, sheetName) {
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  if (rawData.length === 0) return null;
  
  // Look for the TIME row
  let timeRowIndex = -1;
  let countryStartRow = -1;
  let indicatorType = null;
  
  for (let i = 0; i < Math.min(15, rawData.length); i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    const firstCell = String(row[0] || '').trim().toUpperCase();
    if (firstCell === 'TIME' || firstCell.includes('TIME')) {
      timeRowIndex = i;
      // Find where countries start (usually 2-3 rows after TIME)
      for (let j = i + 2; j < Math.min(i + 5, rawData.length); j++) {
        const testRow = rawData[j];
        if (testRow && testRow[0] && String(testRow[0]).trim().length > 0 && 
            !String(testRow[0]).toUpperCase().includes('REPORTER') &&
            !String(testRow[0]).toUpperCase().includes('FREQ')) {
          countryStartRow = j;
          break;
        }
      }
      break;
    }
  }
  
  // Check for indicator type - look for row with INDICATORS header
  for (let i = 0; i < Math.min(10, rawData.length); i++) {
    const row = rawData[i];
    if (row && row.length > 0) {
      const firstCell = String(row[0] || '').trim().toUpperCase();
      if (firstCell.includes('INDICATOR') || firstCell.includes('INDICATORS')) {
        // Indicator value is usually in the second column (index 1)
        if (row.length > 1 && row[1]) {
          indicatorType = String(row[1] || '').trim();
        }
        // Also check if it's in the row itself (sometimes the value is in the same row)
        for (let j = 1; j < row.length; j++) {
          const cell = String(row[j] || '').trim();
          if (cell && cell.length > 0 && !cell.includes(':')) {
            indicatorType = cell;
            break;
          }
        }
        if (indicatorType) break;
      }
    }
  }
  
  if (timeRowIndex === -1 || countryStartRow === -1) {
    return null;
  }
  
  // Extract years from TIME row
  const timeRow = rawData[timeRowIndex];
  const years = [];
  for (let i = 1; i < timeRow.length; i++) {
    const cell = timeRow[i];
    if (cell !== null && cell !== undefined && cell !== '') {
      const year = parseInt(String(cell));
      if (!isNaN(year) && year >= 2000 && year <= 2030) {
        years.push({ index: i, year: year });
      }
    }
  }
  
  if (years.length === 0) {
    return null;
  }
  
  const importMap = new Map();
  let validRows = 0;
  
  // Parse country rows
  for (let i = countryStartRow; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;
    
    const countryName = String(row[0] || '').trim();
    if (!countryName || countryName === ':' || countryName.length < 2) continue;
    
    // Skip header rows
    if (countryName.toUpperCase().includes('REPORTER') || 
        countryName.toUpperCase().includes('FREQ') ||
        countryName.toUpperCase().includes('TIME')) {
      continue;
    }
    
    // Extract values for each year
    years.forEach(({ index, year }) => {
      const cellValue = row[index];
      if (cellValue === null || cellValue === undefined || cellValue === '' || cellValue === ':') {
        return;
      }
      
      let value = parseFloat(String(cellValue).replace(/[,\s]/g, ''));
      if (isNaN(value) || value <= 0) return;
      
      // Create monthly entries (distribute annual data across months)
      for (let month = 1; month <= 12; month++) {
        const date = new Date(year, month - 1, 1);
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const key = `${yearMonth}_${countryName}`;
        
        if (!importMap.has(key)) {
          importMap.set(key, {
            date: date.toISOString(),
            timePeriod: yearMonth,
            partnerCountry: countryName,
            quantity_kg: 0,
            value_eur: 0,
            year: year,
            month: month,
            yearMonth: yearMonth
          });
        }
        
        const entry = importMap.get(key);
        const indicatorUpper = (indicatorType || '').toUpperCase();
        
        // Process based on indicator type, with fallback if unknown
        if (indicatorUpper.includes('QUANTITY') || indicatorUpper === '' || !indicatorType) {
          // Default to QUANTITY if unknown (most common case)
          let quantity_kg = value;
          if (indicatorUpper.includes('100KG') || (!indicatorType && value < 1000000)) {
            // If value seems small, assume it's in 100kg units
            quantity_kg = value * 100; // Convert 100kg to kg
          }
          entry.quantity_kg += quantity_kg / 12; // Distribute annual quantity across months
        } else if (indicatorUpper.includes('VALUE') || indicatorUpper.includes('EUR')) {
          entry.value_eur += value / 12; // Distribute annual value across months
        } else {
          // Fallback: if we can't determine, assume it's quantity
          let quantity_kg = value;
          if (value < 1000000) {
            quantity_kg = value * 100; // Assume 100kg units
          }
          entry.quantity_kg += quantity_kg / 12;
        }
      }
      
      validRows++;
    });
  }
  
  if (importMap.size === 0) {
    return null;
  }
  
  return {
    indicatorType: indicatorType,
    data: Array.from(importMap.values()),
    validRows: validRows
  };
}

/**
 * Parse steel imports - handle pivot table format (countries as rows, years as columns)
 * Process all sheets and combine QUANTITY and VALUE data
 */
function parseSteelImports(workbook) {
  console.log(`  Steel imports: ${workbook.SheetNames.length} sheets available`);
  
  const allImports = new Map(); // Key: yearMonth_country, Value: { quantity_kg, value_eur, ... }
  let totalValidRows = 0;
  let sheetsProcessed = 0;
  
  // Process all sheets
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Summary') continue;
    
    const sheet = workbook.Sheets[sheetName];
    const result = parseSteelImportsSheet(sheet, sheetName);
    
    if (result) {
      sheetsProcessed++;
      console.log(`  Processed sheet: ${sheetName} (${result.indicatorType || 'unknown indicator'}, ${result.validRows} data points)`);
      totalValidRows += result.validRows;
      
      // Merge data into allImports map
      result.data.forEach(entry => {
        const key = `${entry.yearMonth}_${entry.partnerCountry}`;
        
        if (!allImports.has(key)) {
          allImports.set(key, {
            date: entry.date,
            timePeriod: entry.timePeriod,
            partnerCountry: entry.partnerCountry,
            quantity_kg: 0,
            value_eur: 0,
            year: entry.year,
            month: entry.month,
            yearMonth: entry.yearMonth
          });
        }
        
        const existing = allImports.get(key);
        existing.quantity_kg += entry.quantity_kg;
        existing.value_eur += entry.value_eur;
      });
    }
  }
  
  if (allImports.size === 0) {
    console.log('  No suitable sheets found for steel imports');
    return [];
  }
  
  console.log(`  Steel imports: Processed ${sheetsProcessed} sheets, ${totalValidRows} total data points, ${allImports.size} unique entries`);
  
  return Array.from(allImports.values())
    .map(entry => ({
      ...entry,
      quantity_tons: entry.quantity_kg / 1000,
      unit_value: entry.quantity_kg > 0 ? (entry.value_eur / (entry.quantity_kg / 1000)) : 0
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Aggregate imports by time period
 */
function aggregateImports(importsData) {
  const totalByPeriod = new Map();
  const byCountry = new Map();
  
  importsData.forEach(entry => {
    const date = new Date(entry.date);
    const key = entry.yearMonth || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!totalByPeriod.has(key)) {
      totalByPeriod.set(key, {
        date: entry.date,
        yearMonth: key,
        totalQuantity_tons: 0,
        totalValue_eur: 0,
        countries: new Set()
      });
    }
    const total = totalByPeriod.get(key);
    total.totalQuantity_tons += entry.quantity_tons;
    total.totalValue_eur += entry.value_eur;
    total.countries.add(entry.partnerCountry);
    
    const countryKey = `${key}_${entry.partnerCountry}`;
    if (!byCountry.has(countryKey)) {
      byCountry.set(countryKey, {
        date: entry.date,
        yearMonth: key,
        partnerCountry: entry.partnerCountry,
        quantity_tons: 0,
        value_eur: 0
      });
    }
    const country = byCountry.get(countryKey);
    country.quantity_tons += entry.quantity_tons;
    country.value_eur += entry.value_eur;
  });
  
  return {
    total: Array.from(totalByPeriod.values()).map(t => ({
      ...t,
      countries: Array.from(t.countries),
      unit_value: t.totalQuantity_tons > 0 ? (t.totalValue_eur / t.totalQuantity_tons) : 0
    })),
    byCountry: Array.from(byCountry.values())
  };
}

/**
 * Merge all datasets
 */
function mergeDatasets(importsAggregated, etsData, industryData) {
  const merged = [];
  const allPeriods = new Set();
  
  importsAggregated.total.forEach(i => allPeriods.add(i.yearMonth));
  etsData.forEach(e => allPeriods.add(e.yearMonth));
  industryData.forEach(i => allPeriods.add(i.yearMonth));
  
  Array.from(allPeriods).sort().forEach(period => {
    const importEntry = importsAggregated.total.find(i => i.yearMonth === period);
    const etsEntry = etsData.find(e => e.yearMonth === period);
    const industryEntry = industryData.find(i => i.yearMonth === period);
    
    if (!importEntry && !etsEntry && !industryEntry) return;
    
    const date = importEntry?.date || etsEntry?.date || industryEntry?.date;
    
    merged.push({
      date,
      yearMonth: period,
      importQuantity_tons: importEntry?.totalQuantity_tons || null,
      importValue_eur: importEntry?.totalValue_eur || null,
      importUnitValue: importEntry?.unit_value || null,
      etsPrice: etsEntry?.price || null,
      industryIndex: industryEntry?.index || null
    });
  });
  
  return merged.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Calculate derived indicators
 */
function calculateDerivedIndicators(mergedData) {
  return mergedData.map((entry, index) => {
    const prev = index > 0 ? mergedData[index - 1] : null;
    const prev12 = index >= 12 ? mergedData[index - 12] : null;
    
    const importGrowth = prev && prev.importQuantity_tons && entry.importQuantity_tons
      ? ((entry.importQuantity_tons - prev.importQuantity_tons) / prev.importQuantity_tons) * 100
      : null;
    
    const importGrowthYoY = prev12 && prev12.importQuantity_tons && entry.importQuantity_tons
      ? ((entry.importQuantity_tons - prev12.importQuantity_tons) / prev12.importQuantity_tons) * 100
      : null;
    
    const valueGrowth = prev && prev.importValue_eur && entry.importValue_eur
      ? ((entry.importValue_eur - prev.importValue_eur) / prev.importValue_eur) * 100
      : null;
    
    const etsGrowth = prev && prev.etsPrice && entry.etsPrice
      ? ((entry.etsPrice - prev.etsPrice) / prev.etsPrice) * 100
      : null;
    
    const window3 = mergedData.slice(Math.max(0, index - 2), index + 1);
    const window12 = mergedData.slice(Math.max(0, index - 11), index + 1);
    
    const etsMA3 = window3.filter(d => d.etsPrice !== null).length > 0
      ? window3.filter(d => d.etsPrice !== null).reduce((sum, d) => sum + d.etsPrice, 0) / window3.filter(d => d.etsPrice !== null).length
      : null;
    
    const etsMA12 = window12.filter(d => d.etsPrice !== null).length > 0
      ? window12.filter(d => d.etsPrice !== null).reduce((sum, d) => sum + d.etsPrice, 0) / window12.filter(d => d.etsPrice !== null).length
      : null;
    
    const importMA3 = window3.filter(d => d.importQuantity_tons !== null).length > 0
      ? window3.filter(d => d.importQuantity_tons !== null).reduce((sum, d) => sum + d.importQuantity_tons, 0) / window3.filter(d => d.importQuantity_tons !== null).length
      : null;
    
    const importMA12 = window12.filter(d => d.importQuantity_tons !== null).length > 0
      ? window12.filter(d => d.importQuantity_tons !== null).reduce((sum, d) => sum + d.importQuantity_tons, 0) / window12.filter(d => d.importQuantity_tons !== null).length
      : null;
    
    const logImport = entry.importQuantity_tons && entry.importQuantity_tons > 0
      ? Math.log(entry.importQuantity_tons)
      : null;
    
    const logETS = entry.etsPrice && entry.etsPrice > 0
      ? Math.log(entry.etsPrice)
      : null;
    
    const logIndustry = entry.industryIndex && entry.industryIndex > 0
      ? Math.log(entry.industryIndex)
      : null;
    
    // CBAM dummy: 1 for 2023-2025, 0 otherwise
    const date = new Date(entry.date);
    const year = date.getFullYear();
    const cbamDummy = (year >= 2023 && year <= 2025) ? 1 : 0;
    
    return {
      ...entry,
      importGrowth,
      importGrowthYoY,
      valueGrowth,
      etsGrowth,
      etsMA3,
      etsMA12,
      importMA3,
      importMA12,
      logImport,
      logETS,
      logIndustry,
      cbamDummy
    };
  });
}

/**
 * Get top countries
 */
function getTopCountries(importsData, limit = 15) {
  const countryTotals = new Map();
  
  importsData.forEach(entry => {
    if (!countryTotals.has(entry.partnerCountry)) {
      countryTotals.set(entry.partnerCountry, {
        country: entry.partnerCountry,
        totalQuantity_tons: 0,
        totalValue_eur: 0
      });
    }
    const country = countryTotals.get(entry.partnerCountry);
    country.totalQuantity_tons += entry.quantity_tons;
    country.totalValue_eur += entry.value_eur;
  });
  
  return Array.from(countryTotals.values())
    .sort((a, b) => b.totalQuantity_tons - a.totalQuantity_tons)
    .slice(0, limit)
    .map(c => ({
      ...c,
      avgUnitValue: c.totalQuantity_tons > 0 ? (c.totalValue_eur / c.totalQuantity_tons) : 0
    }));
}

// Main processing
try {
  console.log('Loading Excel files...');
  
  const importsWB = XLSX.readFile(path.join(INPUT_DIR, 'steel_imports_hs72.xlsx'));
  const etsWB = XLSX.readFile(path.join(INPUT_DIR, 'ETS_data.xlsx'));
  
  console.log('\nParsing data...');
  const imports = parseSteelImports(importsWB);
  const ets = parseETSData(etsWB);
  const industry = parseIndustryData(); // Reads from CSV file directly
  
  console.log('\nAggregating and processing...');
  const aggregated = aggregateImports(imports);
  const merged = mergeDatasets(aggregated, ets, industry);
  const withIndicators = calculateDerivedIndicators(merged);
  const topCountries = getTopCountries(imports, 15);
  
  console.log('\nSaving processed data...');
  
  // Save as optimized JSON files
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'merged_data.json'),
    JSON.stringify(withIndicators, null, 0)
  );
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'raw_imports.json'),
    JSON.stringify(imports, null, 0)
  );
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'ets_data.json'),
    JSON.stringify(ets, null, 0)
  );
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'industry_data.json'),
    JSON.stringify(industry, null, 0)
  );
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'top_countries.json'),
    JSON.stringify(topCountries, null, 0)
  );
  
  // Calculate file sizes
  const mergedSize = fs.statSync(path.join(OUTPUT_DIR, 'merged_data.json')).size;
  const importsSize = fs.statSync(path.join(OUTPUT_DIR, 'raw_imports.json')).size;
  const etsSize = fs.statSync(path.join(OUTPUT_DIR, 'ets_data.json')).size;
  const industrySize = fs.statSync(path.join(OUTPUT_DIR, 'industry_data.json')).size;
  
  console.log('\n✓ Data preprocessing complete!');
  console.log(`\nOutput files (${OUTPUT_DIR}):`);
  console.log(`  - merged_data.json: ${(mergedSize / 1024).toFixed(2)} KB (${withIndicators.length} records)`);
  console.log(`  - raw_imports.json: ${(importsSize / 1024).toFixed(2)} KB (${imports.length} records)`);
  console.log(`  - ets_data.json: ${(etsSize / 1024).toFixed(2)} KB (${ets.length} records)`);
  console.log(`  - industry_data.json: ${(industrySize / 1024).toFixed(2)} KB (${industry.length} records)`);
  console.log(`  - top_countries.json: ${topCountries.length} countries`);
  
} catch (error) {
  console.error('\n✗ Error during preprocessing:', error);
  console.error(error.stack);
  process.exit(1);
}
