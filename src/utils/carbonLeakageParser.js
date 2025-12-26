import * as XLSX from 'xlsx';

/**
 * Parse steel imports Excel file
 * Expected structure: time_period, reporter, partner_country, product, indicator, value
 */
export const parseSteelImports = (workbook) => {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  if (data.length === 0) {
    console.warn('Steel imports sheet is empty');
    return [];
  }
  
  // Debug: log first row to see column names
  if (data.length > 0) {
    console.log('Steel imports first row keys:', Object.keys(data[0]));
    console.log('Steel imports first row sample:', data[0]);
  }
  
  const processed = [];
  const importMap = new Map(); // Aggregate by time_period and partner_country
  
  // Try to find column names by checking all possible variations
  const findColumn = (row, possibleNames) => {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return row[name];
      }
    }
    // Also try case-insensitive match
    const rowKeys = Object.keys(row);
    for (const key of rowKeys) {
      for (const name of possibleNames) {
        if (key.toLowerCase() === name.toLowerCase()) {
          return row[key];
        }
      }
    }
    return null;
  };
  
  let validRows = 0;
  let skippedRows = 0;
  
  data.forEach((row, index) => {
    // Try multiple possible column name variations
    const timePeriod = findColumn(row, [
      'time_period', 'TIME_PERIOD', 'Time Period', 'Time_Period', 'TIME PERIOD',
      'period', 'PERIOD', 'Period', 'date', 'DATE', 'Date', 'TIME'
    ]);
    
    const partner = findColumn(row, [
      'partner_country', 'PARTNER_COUNTRY', 'Partner Country', 'Partner_Country', 'PARTNER COUNTRY',
      'partner', 'PARTNER', 'Partner', 'country', 'COUNTRY', 'Country', 'reporter', 'REPORTER'
    ]);
    
    const indicator = findColumn(row, [
      'indicator', 'INDICATOR', 'Indicator', 'INDICATOR_TYPE',
      'type', 'TYPE', 'Type', 'measure', 'MEASURE'
    ]);
    
    // Try to find value column - could be in various formats
    let value = null;
    const valueKeys = Object.keys(row).filter(k => 
      k.toLowerCase().includes('value') || 
      k.toLowerCase().includes('quantity') ||
      k.toLowerCase().includes('amount') ||
      k === 'value' || k === 'VALUE' || k === 'Value'
    );
    
    if (valueKeys.length > 0) {
      value = parseFloat(row[valueKeys[0]]) || 0;
    } else {
      // Try to find any numeric column
      for (const key of Object.keys(row)) {
        const numVal = parseFloat(row[key]);
        if (!isNaN(numVal) && numVal > 0) {
          value = numVal;
          break;
        }
      }
    }
    
    if (!timePeriod || !partner || !indicator || value === null || isNaN(value) || value === 0) {
      if (index < 5) {
        console.log(`Skipping row ${index}:`, { timePeriod, partner, indicator, value, rowKeys: Object.keys(row) });
      }
      skippedRows++;
      return;
    }
    
    validRows++;
    
    // Parse time period (could be YYYY-MM or YYYY format)
    let date;
    const timePeriodStr = String(timePeriod);
    if (timePeriodStr.includes('-')) {
      const [year, month] = timePeriodStr.split('-');
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        skippedRows++;
        return;
      }
      date = new Date(yearNum, monthNum - 1, 1);
    } else if (timePeriodStr.length === 4) {
      const yearNum = parseInt(timePeriodStr);
      if (isNaN(yearNum)) {
        skippedRows++;
        return;
      }
      date = new Date(yearNum, 0, 1);
    } else {
      // Try parsing as date object
      date = new Date(timePeriod);
      if (isNaN(date.getTime())) {
        skippedRows++;
        return;
      }
    }
    
    if (isNaN(date.getTime())) {
      skippedRows++;
      return;
    }
    
    const key = `${timePeriod}_${partner}`;
    if (!importMap.has(key)) {
      importMap.set(key, {
        date,
        timePeriod,
        partnerCountry: partner,
        quantity_kg: 0,
        value_eur: 0
      });
    }
    
    const entry = importMap.get(key);
    const indicatorLower = String(indicator).toLowerCase();
    if (indicatorLower.includes('quantity') || indicatorLower.includes('kg')) {
      entry.quantity_kg += value;
    } else if (indicatorLower.includes('value') || indicatorLower.includes('eur')) {
      entry.value_eur += value;
    }
  });
  
  console.log(`Steel imports parsing: ${validRows} valid rows, ${skippedRows} skipped, ${importMap.size} unique entries`);
  
  // Convert to array and calculate metrics
  const result = Array.from(importMap.values())
    .map(entry => ({
      ...entry,
      quantity_tons: entry.quantity_kg / 1000, // Convert kg to metric tons
      unit_value: entry.quantity_kg > 0 ? (entry.value_eur / (entry.quantity_kg / 1000)) : 0, // EUR per ton
      year: entry.date.getFullYear(),
      month: entry.date.getMonth() + 1,
      yearMonth: `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`
    }))
    .sort((a, b) => a.date - b.date);
  
  return result;
};

/**
 * Parse ETS price Excel file
 * Expected structure: date, ETS_price_EUR_tCO2
 */
export const parseETSData = (workbook) => {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  if (data.length === 0) {
    console.warn('ETS data sheet is empty');
    return [];
  }
  
  // Debug: log first row
  if (data.length > 0) {
    console.log('ETS data first row keys:', Object.keys(data[0]));
    console.log('ETS data first row sample:', data[0]);
  }
  
  // Helper to find column
  const findColumn = (row, possibleNames) => {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return row[name];
      }
    }
    const rowKeys = Object.keys(row);
    for (const key of rowKeys) {
      for (const name of possibleNames) {
        if (key.toLowerCase() === name.toLowerCase()) {
          return row[key];
        }
      }
    }
    return null;
  };
  
  let validRows = 0;
  let skippedRows = 0;
  
  const result = data
    .map((row, index) => {
      const dateStr = findColumn(row, [
        'date', 'DATE', 'Date', 'time_period', 'TIME_PERIOD', 'Time Period',
        'period', 'PERIOD', 'Period', 'time', 'TIME'
      ]);
      
      const price = findColumn(row, [
        'ETS_price_EUR_tCO2', 'ETS_PRICE_EUR_TCO2', 'ETS Price', 'ETS_Price',
        'price', 'Price', 'PRICE', 'ets_price', 'ETS_PRICE',
        'value', 'Value', 'VALUE'
      ]);
      
      const priceNum = price !== null ? parseFloat(price) : null;
      
      if (!dateStr || priceNum === null || isNaN(priceNum) || priceNum <= 0) {
        if (index < 5) {
          console.log(`Skipping ETS row ${index}:`, { dateStr, price, priceNum, rowKeys: Object.keys(row) });
        }
        skippedRows++;
        return null;
      }
      
      validRows++;
      
      let date;
      if (dateStr instanceof Date) {
        date = dateStr;
      } else if (typeof dateStr === 'number') {
        // Excel serial date - convert to JavaScript date
        const excelEpoch = new Date(1899, 11, 30);
        date = new Date(excelEpoch.getTime() + dateStr * 86400000);
      } else if (typeof dateStr === 'string') {
        // Try parsing string date
        date = new Date(dateStr);
        // If that fails, try common formats
        if (isNaN(date.getTime())) {
          // Try YYYY-MM-DD or YYYY-MM format
          if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            if (parts.length >= 2) {
              date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parts[2] ? parseInt(parts[2]) : 1);
            }
          }
        }
      } else {
        return null;
      }
      
      if (!date || isNaN(date.getTime())) {
        skippedRows++;
        return null;
      }
      
      return {
        date,
        price: priceNum,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      };
    })
    .filter(d => d !== null)
    .sort((a, b) => a.date - b.date);
  
  console.log(`ETS data parsing: ${validRows} valid rows, ${skippedRows} skipped`);
  return result;
};

/**
 * Parse industry production index Excel file
 * Expected structure: date, EU_industry_index
 */
export const parseIndustryData = (workbook) => {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  if (data.length === 0) {
    console.warn('Industry data sheet is empty');
    return [];
  }
  
  // Debug: log first row
  if (data.length > 0) {
    console.log('Industry data first row keys:', Object.keys(data[0]));
    console.log('Industry data first row sample:', data[0]);
  }
  
  // Helper to find column
  const findColumn = (row, possibleNames) => {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return row[name];
      }
    }
    const rowKeys = Object.keys(row);
    for (const key of rowKeys) {
      for (const name of possibleNames) {
        if (key.toLowerCase() === name.toLowerCase()) {
          return row[key];
        }
      }
    }
    return null;
  };
  
  let validRows = 0;
  let skippedRows = 0;
  
  const result = data
    .map((row, index) => {
      const dateStr = findColumn(row, [
        'date', 'DATE', 'Date', 'time_period', 'TIME_PERIOD', 'Time Period',
        'period', 'PERIOD', 'Period', 'time', 'TIME'
      ]);
      
      const indexVal = findColumn(row, [
        'EU_industry_index', 'EU_INDUSTRY_INDEX', 'EU Industry Index', 'EU_Industry_Index',
        'index', 'Index', 'INDEX', 'value', 'Value', 'VALUE',
        'industry_index', 'Industry Index'
      ]);
      
      const indexNum = indexVal !== null ? parseFloat(indexVal) : null;
      
      if (!dateStr || indexNum === null || isNaN(indexNum) || indexNum <= 0) {
        if (index < 5) {
          console.log(`Skipping industry row ${index}:`, { dateStr, indexVal, indexNum, rowKeys: Object.keys(row) });
        }
        skippedRows++;
        return null;
      }
      
      validRows++;
      
      let date;
      if (dateStr instanceof Date) {
        date = dateStr;
      } else if (typeof dateStr === 'number') {
        // Excel serial date - convert to JavaScript date
        const excelEpoch = new Date(1899, 11, 30);
        date = new Date(excelEpoch.getTime() + dateStr * 86400000);
      } else if (typeof dateStr === 'string') {
        // Try parsing string date
        date = new Date(dateStr);
        // If that fails, try common formats
        if (isNaN(date.getTime())) {
          // Try YYYY-MM-DD or YYYY-MM format
          if (dateStr.includes('-')) {
            const parts = dateStr.split('-');
            if (parts.length >= 2) {
              date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parts[2] ? parseInt(parts[2]) : 1);
            }
          }
        }
      } else {
        return null;
      }
      
      if (!date || isNaN(date.getTime())) {
        skippedRows++;
        return null;
      }
      
      return {
        date,
        index: indexNum,
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      };
    })
    .filter(d => d !== null)
    .sort((a, b) => a.date - b.date);
  
  console.log(`Industry data parsing: ${validRows} valid rows, ${skippedRows} skipped`);
  return result;
};

/**
 * Aggregate imports by time period (total and by country)
 */
export const aggregateImports = (importsData) => {
  const totalByPeriod = new Map();
  const byCountry = new Map();
  
  importsData.forEach(entry => {
    const key = entry.yearMonth || `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`;
    
    // Total aggregation
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
    
    // By country
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
};

/**
 * Merge all datasets by time period
 */
export const mergeDatasets = (importsAggregated, etsData, industryData) => {
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
    
    // Use the date from whichever dataset has it
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
  
  return merged.sort((a, b) => a.date - b.date);
};

/**
 * Calculate growth rates and derived indicators
 */
export const calculateDerivedIndicators = (mergedData) => {
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
    
    // Rolling averages
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
    
    // Log transforms for elasticity estimation
    const logImport = entry.importQuantity_tons && entry.importQuantity_tons > 0
      ? Math.log(entry.importQuantity_tons)
      : null;
    
    const logETS = entry.etsPrice && entry.etsPrice > 0
      ? Math.log(entry.etsPrice)
      : null;
    
    const logIndustry = entry.industryIndex && entry.industryIndex > 0
      ? Math.log(entry.industryIndex)
      : null;
    
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
      logIndustry
    };
  });
};

/**
 * Get top partner countries by import volume
 */
export const getTopCountries = (importsData, limit = 10) => {
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
};

