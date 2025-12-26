/**
 * Data Validation and Aggregation Utilities
 * Handles time alignment, aggregation, and econometric safeguards
 */

/**
 * Detect overlapping period across all datasets
 */
export const detectOverlappingPeriod = (mergedData) => {
  if (!mergedData || mergedData.length === 0) return null;
  
  // Find periods where all required variables are present
  const validPeriods = mergedData.filter(d => 
    d.importQuantity_tons !== null && 
    d.etsPrice !== null && 
    d.industryIndex !== null &&
    d.logImport !== null &&
    d.logETS !== null &&
    d.logIndustry !== null
  );
  
  if (validPeriods.length === 0) return null;
  
  const dates = validPeriods.map(d => new Date(d.date));
  return {
    start: new Date(Math.min(...dates)),
    end: new Date(Math.max(...dates)),
    count: validPeriods.length,
    periods: validPeriods
  };
};

/**
 * Aggregate monthly data to annual frequency
 */
export const aggregateToAnnual = (mergedData) => {
  if (!mergedData || mergedData.length === 0) return [];
  
  const annualMap = new Map();
  
  mergedData.forEach(entry => {
    const date = new Date(entry.date);
    const year = date.getFullYear();
    
    if (!annualMap.has(year)) {
      annualMap.set(year, {
        year,
        date: new Date(year, 0, 1),
        importQuantity_tons: [],
        importValue_eur: [],
        etsPrice: [],
        industryIndex: [],
        cbamDummy: entry.cbamDummy !== undefined ? entry.cbamDummy : 0
      });
    }
    
    const annual = annualMap.get(year);
    
    if (entry.importQuantity_tons !== null) {
      annual.importQuantity_tons.push(entry.importQuantity_tons);
    }
    if (entry.importValue_eur !== null) {
      annual.importValue_eur.push(entry.importValue_eur);
    }
    if (entry.etsPrice !== null) {
      annual.etsPrice.push(entry.etsPrice);
    }
    if (entry.industryIndex !== null) {
      annual.industryIndex.push(entry.industryIndex);
    }
  });
  
  // Calculate annual aggregates
  const annualData = Array.from(annualMap.values()).map(annual => {
    // Annual totals for imports
    const totalImports = annual.importQuantity_tons.reduce((sum, val) => sum + val, 0);
    const totalValue = annual.importValue_eur.reduce((sum, val) => sum + val, 0);
    
    // Annual averages for prices and indices
    const avgETS = annual.etsPrice.length > 0 
      ? annual.etsPrice.reduce((sum, val) => sum + val, 0) / annual.etsPrice.length 
      : null;
    const avgIndustry = annual.industryIndex.length > 0
      ? annual.industryIndex.reduce((sum, val) => sum + val, 0) / annual.industryIndex.length
      : null;
    
    // Calculate log transforms
    const logImport = totalImports > 0 ? Math.log(totalImports) : null;
    const logETS = avgETS > 0 ? Math.log(avgETS) : null;
    const logIndustry = avgIndustry > 0 ? Math.log(avgIndustry) : null;
    
    return {
      date: annual.date,
      year: annual.year,
      yearMonth: `${annual.year}-01`, // Keep for compatibility
      importQuantity_tons: totalImports > 0 ? totalImports : null,
      importValue_eur: totalValue > 0 ? totalValue : null,
      importUnitValue: totalImports > 0 ? (totalValue / totalImports) : null,
      etsPrice: avgETS,
      industryIndex: avgIndustry,
      cbamDummy: annual.cbamDummy,
      logImport,
      logETS,
      logIndustry,
      frequency: 'annual'
    };
  }).sort((a, b) => a.date - b.date);
  
  return annualData;
};

/**
 * Determine optimal data frequency and prepare dataset
 */
export const prepareDataset = (mergedData) => {
  const overlap = detectOverlappingPeriod(mergedData);
  
  if (!overlap || overlap.count === 0) {
    return {
      data: [],
      frequency: 'none',
      overlap: null,
      message: 'No overlapping observations found across all required variables.'
    };
  }
  
  // If we have fewer than 20 monthly observations, aggregate to annual
  if (overlap.count < 20) {
    const annualData = aggregateToAnnual(overlap.periods);
    const annualOverlap = detectOverlappingPeriod(annualData);
    
    return {
      data: annualData,
      frequency: 'annual',
      overlap: annualOverlap,
      message: `Monthly data insufficient (${overlap.count} observations). Aggregated to annual frequency (${annualData.length} observations).`
    };
  }
  
  return {
    data: overlap.periods,
    frequency: 'monthly',
    overlap,
    message: `Using monthly frequency with ${overlap.count} overlapping observations.`
  };
};

/**
 * Determine feasible lag length based on sample size
 */
export const determineFeasibleLagLength = (n, frequency, minParams = 3) => {
  const minN = 20; // Minimum for OLS
  const minNForLags = 10 + minParams; // Minimum for lagged models
  
  if (n < minN) {
    return { feasible: false, maxLag: 0, reason: 'Insufficient observations for regression analysis' };
  }
  
  if (frequency === 'annual') {
    // For annual data, only allow K=1
    const maxLag = n >= (minNForLags + 1) ? 1 : 0;
    return {
      feasible: maxLag > 0,
      maxLag,
      reason: maxLag === 0 
        ? 'Insufficient annual observations for lagged models'
        : 'Annual data: maximum lag length K=1'
    };
  }
  
  // For monthly data
  if (n < minNForLags + 3) {
    return { feasible: false, maxLag: 0, reason: 'Insufficient observations for lagged models' };
  }
  
  // Calculate maximum feasible lag
  // Need at least (10 + number of parameters) observations
  let maxLag = 0;
  for (let k = 1; k <= 12; k++) {
    const requiredN = 10 + (k + 1) + 1; // k lags + current + activity + intercept
    if (n >= requiredN) {
      maxLag = k;
    } else {
      break;
    }
  }
  
  // Cap at reasonable limits
  if (n < 50) maxLag = Math.min(maxLag, 3);
  else if (n < 100) maxLag = Math.min(maxLag, 6);
  
  return {
    feasible: maxLag > 0,
    maxLag,
    reason: maxLag === 0 
      ? 'Insufficient observations for lagged models'
      : `Monthly data: maximum feasible lag length K=${maxLag}`
  };
};

/**
 * Check if CBAM interaction model is feasible
 */
export const checkCBAMFeasibility = (data) => {
  if (!data || data.length === 0) {
    return {
      feasible: false,
      reason: 'No data available',
      preCBAM: 0,
      postCBAM: 0
    };
  }
  
  const preCBAM = data.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year < 2023;
  }).length;
  
  const postCBAM = data.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year >= 2023 && year <= 2025;
  }).length;
  
  // Need at least 10 observations in each period for meaningful interaction
  const feasible = preCBAM >= 10 && postCBAM >= 5;
  
  return {
    feasible,
    preCBAM,
    postCBAM,
    reason: feasible 
      ? `Sufficient observations: ${preCBAM} pre-CBAM, ${postCBAM} post-CBAM`
      : `Insufficient post-CBAM observations (${postCBAM} < 5 required). Pre-CBAM: ${preCBAM}`
  };
};

/**
 * Calculate before/after CBAM descriptive statistics
 */
export const calculateCBAMDescriptive = (data) => {
  if (!data || data.length === 0) return null;
  
  const preCBAM = data.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year < 2023 && d.importQuantity_tons !== null && d.etsPrice !== null;
  });
  
  const postCBAM = data.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year >= 2023 && year <= 2025 && d.importQuantity_tons !== null && d.etsPrice !== null;
  });
  
  if (preCBAM.length === 0 || postCBAM.length === 0) return null;
  
  const calcStats = (period) => {
    const imports = period.map(d => d.importQuantity_tons).filter(v => v !== null);
    const prices = period.map(d => d.etsPrice).filter(v => v !== null);
    
    return {
      n: period.length,
      avgImports: imports.reduce((a, b) => a + b, 0) / imports.length,
      avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
      medianImports: imports.sort((a, b) => a - b)[Math.floor(imports.length / 2)],
      medianPrice: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
    };
  };
  
  const preStats = calcStats(preCBAM);
  const postStats = calcStats(postCBAM);
  
  return {
    preCBAM: preStats,
    postCBAM: postStats,
    importChange: ((postStats.avgImports - preStats.avgImports) / preStats.avgImports) * 100,
    priceChange: ((postStats.avgPrice - preStats.avgPrice) / preStats.avgPrice) * 100
  };
};

