export const parseCarbonPricingCSV = (csvText) => {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    
    const row = {};
    headers.forEach((header, index) => {
      let value = values[index] || '';
      value = value.replace(/^"|"$/g, '').trim();
      
      if (header.startsWith('Price_')) {
        const year = parseInt(header.replace('Price_', ''));
        row[header] = parseFloat(value) || null;
        if (!row.prices) row.prices = {};
        row.prices[year] = parseFloat(value) || null;
      } else if (header === 'Change') {
        row[header] = parseFloat(value) || null;
      } else {
        row[header] = value;
      }
    });
    data.push(row);
  }
  
  return data;
};

const parseCSVLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
};

export const getEUETSPrices = (data) => {
  const euEts = data.find(d => 
    d['Instrument name']?.includes('EU ETS') && 
    !d['Instrument name']?.includes('EU ETS2')
  );
  
  if (!euEts || !euEts.prices) return [];
  
  const prices = [];
  for (let year = 2020; year <= 2025; year++) {
    const price = euEts.prices[year];
    if (price !== null && price !== undefined) {
      prices.push({ year, price });
    }
  }
  
  return prices.sort((a, b) => a.year - b.year);
};

export const getGlobalETSPrices = (data) => {
  const etsInstruments = data.filter(d => d.Type === 'ETS' && d.Status === 'Implemented');
  
  const globalPrices = [];
  for (let year = 2020; year <= 2025; year++) {
    const yearPrices = etsInstruments
      .map(d => d.prices?.[year])
      .filter(p => p !== null && p !== undefined);
    
    if (yearPrices.length > 0) {
      globalPrices.push({
        year,
        min: Math.min(...yearPrices),
        max: Math.max(...yearPrices),
        avg: yearPrices.reduce((a, b) => a + b, 0) / yearPrices.length,
        median: yearPrices.sort((a, b) => a - b)[Math.floor(yearPrices.length / 2)]
      });
    }
  }
  
  return globalPrices.sort((a, b) => a.year - b.year);
};

export const getTopCarbonPricingJurisdictions = (data) => {
  const implemented = data.filter(d => d.Status === 'Implemented');
  
  const byJurisdiction = {};
  implemented.forEach(d => {
    const jurisdiction = d['Jurisdiction covered'] || 'Unknown';
    if (!byJurisdiction[jurisdiction]) {
      byJurisdiction[jurisdiction] = {
        jurisdiction,
        instruments: [],
        latestPrice: null,
        type: d.Type
      };
    }
    byJurisdiction[jurisdiction].instruments.push(d['Instrument name']);
    
    // Get latest price
    if (d.prices) {
      const years = Object.keys(d.prices).map(Number).sort((a, b) => b - a);
      for (const year of years) {
        if (d.prices[year] !== null) {
          byJurisdiction[jurisdiction].latestPrice = d.prices[year];
          break;
        }
      }
    }
  });
  
  return Object.values(byJurisdiction)
    .filter(j => j.latestPrice !== null)
    .sort((a, b) => b.latestPrice - a.latestPrice)
    .slice(0, 15);
};

export const getIndustryCoverage = (data) => {
  const withIndustry = data.filter(d => d.Industry && d.Industry !== 'NaN' && d.Industry !== '');
  
  const coverage = {
    yes: 0,
    no: 0,
    partial: 0
  };
  
  withIndustry.forEach(d => {
    const industry = String(d.Industry).toLowerCase();
    if (industry === 'yes' || industry === 'y') {
      coverage.yes++;
    } else if (industry === 'no' || industry === 'n') {
      coverage.no++;
    } else {
      coverage.partial++;
    }
  });
  
  return coverage;
};

