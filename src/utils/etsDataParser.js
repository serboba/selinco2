export const parseETSCSV = (csvText) => {
  // Remove BOM if present
  const text = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const lines = text.trim().split('\n');
  
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
      
      if (header === 'Year') {
        const year = parseFloat(value);
        row[header] = isNaN(year) ? null : Math.floor(year);
      } else if (header === 'Value') {
        row[header] = parseFloat(value) || 0;
      } else if (header === 'Entities') {
        row[header] = parseFloat(value) || 0;
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

export const calculateETSMetrics = (data) => {
  const emissions = data.filter(d => 
    d['ETS information']?.includes('Verified emissions') || 
    d['ETS information']?.includes('Verified Emission')
  );
  
  const allocated = data.filter(d => 
    d['ETS information']?.includes('allocated allowances')
  );
  
  const surrendered = data.filter(d => 
    d['ETS information']?.includes('Surrendered')
  );
  
  const totalEmissions = emissions.reduce((sum, d) => sum + (d.Value || 0), 0);
  const totalAllocated = allocated.reduce((sum, d) => sum + (d.Value || 0), 0);
  const totalSurrendered = surrendered.reduce((sum, d) => sum + (d.Value || 0), 0);
  
  // Calculate compliance rate
  const complianceRate = totalAllocated > 0 
    ? (totalSurrendered / totalAllocated) * 100 
    : 0;
  
  // Calculate surplus/deficit
  const surplus = totalAllocated - totalSurrendered;
  
  return {
    totalEmissions,
    totalAllocated,
    totalSurrendered,
    complianceRate,
    surplus,
    emissionsCount: emissions.length,
    allocatedCount: allocated.length,
    surrenderedCount: surrendered.length
  };
};

export const groupByYear = (data, valueKey = 'Value') => {
  const grouped = {};
  data.forEach(d => {
    const year = d.Year;
    if (!year) return;
    if (!grouped[year]) {
      grouped[year] = { year, total: 0, count: 0 };
    }
    grouped[year].total += d[valueKey] || 0;
    grouped[year].count += 1;
  });
  return Object.values(grouped).sort((a, b) => a.year - b.year);
};

export const groupByCountry = (data, valueKey = 'Value') => {
  const grouped = {};
  data.forEach(d => {
    const country = d.Country || d['Country Code'] || 'Unknown';
    if (!grouped[country]) {
      grouped[country] = { country, total: 0, count: 0 };
    }
    grouped[country].total += d[valueKey] || 0;
    grouped[country].count += 1;
  });
  return Object.values(grouped)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20); // Top 20
};

export const groupBySector = (data, valueKey = 'Value') => {
  const grouped = {};
  data.forEach(d => {
    const sector = d['Main Activity Sector Name'] || 'Unknown';
    if (!grouped[sector]) {
      grouped[sector] = { sector, total: 0, count: 0 };
    }
    grouped[sector].total += d[valueKey] || 0;
    grouped[sector].count += 1;
  });
  return Object.values(grouped).sort((a, b) => b.total - a.total);
};

export const groupByETSInfo = (data, valueKey = 'Value') => {
  const grouped = {};
  data.forEach(d => {
    const info = d['ETS information'] || 'Unknown';
    if (!grouped[info]) {
      grouped[info] = { info, total: 0, count: 0 };
    }
    grouped[info].total += d[valueKey] || 0;
    grouped[info].count += 1;
  });
  return Object.values(grouped).sort((a, b) => b.total - a.total);
};

export const calculateTrends = (yearlyData) => {
  if (yearlyData.length < 2) return null;
  
  const recent = yearlyData.slice(-5);
  const older = yearlyData.slice(0, 5);
  
  const recentAvg = recent.reduce((sum, d) => sum + d.total, 0) / recent.length;
  const olderAvg = older.length > 0 
    ? older.reduce((sum, d) => sum + d.total, 0) / older.length 
    : recentAvg;
  
  const change = recentAvg - olderAvg;
  const changePct = olderAvg > 0 ? (change / olderAvg) * 100 : 0;
  
  return {
    recentAvg,
    olderAvg,
    change,
    changePct,
    trend: change > 0 ? 'increasing' : 'decreasing'
  };
};

