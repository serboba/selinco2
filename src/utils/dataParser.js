export const parseCSV = (csvText) => {
  // Remove BOM if present
  const text = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const lines = text.trim().split('\n');
  
  // Parse headers, handling quoted values
  const headerLine = lines[0].replace(/^"|"$/g, '');
  const headers = headerLine.split('","').map(h => h.replace(/^"|"$/g, ''));
  
  const data = [];
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
        values.push(current.replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.replace(/^"|"$/g, '')); // Add last value
    
    if (values.length !== headers.length) continue;
    
    const row = {};
    headers.forEach((header, index) => {
      let value = values[index] || '';
      
      if (header === 'Date') {
        const [month, day, year] = value.split('/');
        if (month && day && year) {
          row[header] = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
      } else if (header === 'Price') {
        row[header] = parseFloat(value) || 0;
      } else {
        row[header] = value;
      }
    });
    
    if (row.Date) {
      data.push(row);
    }
  }
  
  return data.sort((a, b) => a.Date - b.Date);
};

export const calculateMovingAverage = (data, window) => {
  return data.map((item, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = data.slice(start, index + 1);
    const sum = slice.reduce((acc, d) => acc + d.Price, 0);
    return { ...item, [`MA_${window}`]: sum / slice.length };
  });
};

export const calculateMetrics = (data) => {
  const prices = data.map(d => d.Price);
  const currentPrice = prices[prices.length - 1];
  const startPrice = prices[0];
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const volatility = calculateStdDev(prices);
  const totalChange = currentPrice - startPrice;
  const totalChangePct = ((totalChange / startPrice) * 100);
  
  return {
    currentPrice,
    startPrice,
    avgPrice,
    minPrice,
    maxPrice,
    volatility,
    totalChange,
    totalChangePct
  };
};

const calculateStdDev = (values) => {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
};

export const calculatePeriodMetrics = (data, startDate, endDate) => {
  const filtered = data.filter(d => d.Date >= startDate && d.Date <= endDate);
  if (filtered.length === 0) return null;
  
  const prices = filtered.map(d => d.Price);
  const startPrice = prices[0];
  const endPrice = prices[prices.length - 1];
  const priceChange = endPrice - startPrice;
  const priceChangePct = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const volatility = calculateStdDev(prices);
  
  return {
    startPrice,
    endPrice,
    priceChange,
    priceChangePct,
    avgPrice,
    volatility
  };
};

export const CBAM_DATES = [
  {
    date: new Date(2023, 4, 17),
    label: 'CBAM Regulation Enters Force',
    short: 'CBAM Enters Force',
    color: '#3B82F6',
    phase: 'Preparatory'
  },
  {
    date: new Date(2023, 9, 1),
    label: 'Transitional Phase Begins',
    short: 'Transitional Phase',
    color: '#8B5CF6',
    phase: 'Transitional'
  },
  {
    date: new Date(2024, 0, 31),
    label: 'First Quarterly Report Deadline',
    short: 'Q1 Report Deadline',
    color: '#F59E0B',
    phase: 'Transitional'
  },
  {
    date: new Date(2024, 6, 1),
    label: 'Actual Data Requirement Begins',
    short: 'Actual Data Required',
    color: '#EF4444',
    phase: 'Transitional'
  },
  {
    date: new Date(2026, 0, 1),
    label: 'Definitive Phase Begins (Carbon Tax)',
    short: 'Carbon Tax Starts',
    color: '#EC4899',
    phase: 'Definitive'
  },
  {
    date: new Date(2027, 1, 1),
    label: 'CBAM Certificate Sales Begin',
    short: 'Certificate Sales',
    color: '#F97316',
    phase: 'Definitive'
  },
  {
    date: new Date(2027, 8, 30),
    label: 'First Annual Declaration Deadline',
    short: 'Annual Declaration',
    color: '#14B8A6',
    phase: 'Definitive'
  },
  {
    date: new Date(2030, 0, 1),
    label: 'Extended to All ETS Sectors',
    short: 'Extended to All ETS',
    color: '#10B981',
    phase: 'Expansion'
  },
  {
    date: new Date(2034, 0, 1),
    label: 'Full Implementation (100% CBAM)',
    short: 'Full Implementation',
    color: '#F59E0B',
    phase: 'Full Implementation'
  }
];

