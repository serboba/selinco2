/**
 * Simple OLS Regression
 * Returns: { intercept, slope, rSquared, standardError, tStat, pValue }
 */
export const simpleOLS = (y, x) => {
  const n = Math.min(y.length, x.length);
  const validPairs = [];
  
  for (let i = 0; i < n; i++) {
    if (y[i] !== null && !isNaN(y[i]) && x[i] !== null && !isNaN(x[i])) {
      validPairs.push({ y: y[i], x: x[i] });
    }
  }
  
  if (validPairs.length < 2) {
    return null;
  }
  
  const nValid = validPairs.length;
  const sumX = validPairs.reduce((sum, p) => sum + p.x, 0);
  const sumY = validPairs.reduce((sum, p) => sum + p.y, 0);
  const sumXY = validPairs.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumXX = validPairs.reduce((sum, p) => sum + p.x * p.x, 0);
  const sumYY = validPairs.reduce((sum, p) => sum + p.y * p.y, 0);
  
  const meanX = sumX / nValid;
  const meanY = sumY / nValid;
  
  const slope = (sumXY - nValid * meanX * meanY) / (sumXX - nValid * meanX * meanX);
  const intercept = meanY - slope * meanX;
  
  // Calculate R-squared
  const yPred = validPairs.map(p => intercept + slope * p.x);
  const ssRes = validPairs.reduce((sum, p, i) => sum + Math.pow(p.y - yPred[i], 2), 0);
  const ssTot = validPairs.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  
  // Standard error of regression
  const standardError = Math.sqrt(ssRes / (nValid - 2));
  
  // Standard error of slope
  const seSlope = standardError / Math.sqrt(validPairs.reduce((sum, p) => sum + Math.pow(p.x - meanX, 2), 0));
  
  // t-statistic
  const tStat = seSlope > 0 ? slope / seSlope : 0;
  
  // Approximate p-value (two-tailed, using t-distribution approximation)
  const pValue = approximatePValue(tStat, nValid - 2);
  
  return {
    intercept,
    slope,
    rSquared,
    standardError,
    seSlope,
    tStat,
    pValue,
    n: nValid
  };
};

/**
 * Multiple OLS Regression
 * y = dependent variable array
 * x = array of arrays (each inner array is an independent variable)
 * Returns: { coefficients, rSquared, standardErrors, tStats, pValues }
 */
export const multipleOLS = (y, x) => {
  const n = y.length;
  const k = x.length; // number of independent variables
  
  if (n < k + 1) return null; // Need at least k+1 observations
  
  // Build valid data points
  const validIndices = [];
  for (let i = 0; i < n; i++) {
    if (y[i] !== null && !isNaN(y[i])) {
      let valid = true;
      for (let j = 0; j < k; j++) {
        if (x[j][i] === null || isNaN(x[j][i])) {
          valid = false;
          break;
        }
      }
      if (valid) validIndices.push(i);
    }
  }
  
  if (validIndices.length < k + 1) return null;
  
  // Create matrices
  const Y = validIndices.map(i => y[i]);
  const X = validIndices.map(i => {
    const row = [1]; // intercept term
    for (let j = 0; j < k; j++) {
      row.push(x[j][i]);
    }
    return row;
  });
  
  // Matrix operations (simplified - using normal equations)
  const Xt = transpose(X);
  const XtX = matrixMultiply(Xt, X);
  const XtY = matrixVectorMultiply(Xt, Y);
  
  // Solve (XtX) * beta = XtY using Gaussian elimination (simplified)
  const coefficients = solveLinearSystem(XtX, XtY);
  
  if (!coefficients) return null;
  
  // Calculate R-squared
  const yPred = X.map(row => {
    let sum = coefficients[0]; // intercept
    for (let j = 0; j < k; j++) {
      sum += coefficients[j + 1] * row[j + 1];
    }
    return sum;
  });
  
  const meanY = Y.reduce((a, b) => a + b, 0) / Y.length;
  const ssRes = Y.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
  const ssTot = Y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  
  // Standard errors (simplified calculation)
  const mse = ssRes / (validIndices.length - k - 1);
  const standardErrors = calculateStandardErrors(XtX, mse);
  
  // t-statistics and p-values
  const tStats = coefficients.map((coef, i) => 
    standardErrors[i] > 0 ? coef / standardErrors[i] : 0
  );
  const pValues = tStats.map((t, i) => approximatePValue(t, validIndices.length - k - 1));
  
  return {
    coefficients,
    rSquared,
    standardErrors,
    tStats,
    pValues,
    n: validIndices.length
  };
};

/**
 * Estimate elasticity using log-log regression
 */
export const estimateElasticity = (mergedData, useLags = false, maxLags = 3) => {
  const results = [];
  
  // Extract data
  const logImports = mergedData.map(d => d.logImport).filter(v => v !== null);
  const logETS = mergedData.map(d => d.logETS).filter(v => v !== null);
  const logIndustry = mergedData.map(d => d.logIndustry).filter(v => v !== null);
  
  // Current period (no lag)
  const currentData = alignData(mergedData, ['logImport', 'logETS', 'logIndustry']);
  if (currentData.y.length > 10) {
    const current = multipleOLS(currentData.y, [currentData.x1, currentData.x2]);
    if (current) {
      results.push({
        lag: 0,
        elasticity: current.coefficients[1], // ETS coefficient
        se: current.standardErrors[1],
        tStat: current.tStats[1],
        pValue: current.pValues[1],
        rSquared: current.rSquared,
        industryCoeff: current.coefficients[2],
        intercept: current.coefficients[0],
        n: current.n
      });
    }
  }
  
  // Lagged effects
  if (useLags) {
    for (let lag = 1; lag <= maxLags; lag++) {
      const laggedData = alignData(mergedData, ['logImport', 'logETS', 'logIndustry'], lag);
      if (laggedData.y.length > 10) {
        const lagged = multipleOLS(laggedData.y, [laggedData.x1, laggedData.x2]);
        if (lagged) {
          results.push({
            lag,
            elasticity: lagged.coefficients[1],
            se: lagged.standardErrors[1],
            tStat: lagged.tStats[1],
            pValue: lagged.pValues[1],
            rSquared: lagged.rSquared,
            industryCoeff: lagged.coefficients[2],
            intercept: lagged.coefficients[0],
            n: lagged.n
          });
        }
      }
    }
  }
  
  return results;
};

/**
 * Calculate summary statistics for variables
 */
export const calculateSummaryStats = (data, variableName) => {
  const values = data
    .map(d => {
      if (variableName === 'importQuantity_tons') return d.importQuantity_tons;
      if (variableName === 'logImport') return d.logImport;
      if (variableName === 'etsPrice') return d.etsPrice;
      if (variableName === 'industryIndex') return d.industryIndex;
      if (variableName === 'logIndustry') return d.logIndustry;
      if (variableName === 'cbamDummy') return d.cbamDummy;
      return null;
    })
    .filter(v => v !== null && !isNaN(v));
  
  if (values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  return {
    variable: variableName,
    mean,
    median,
    stdDev,
    min,
    max,
    n: values.length
  };
};

/**
 * Baseline model: LN_IMPORTS = alpha + beta1*CARBON_PRICE + beta2*LN_ACTIVITY + beta3*CBAM_DUMMY + error
 */
export const estimateBaselineModel = (mergedData, frequency = 'monthly') => {
  // Align data: y = logImport, x1 = etsPrice (levels), x2 = logIndustry, x3 = cbamDummy
  const aligned = alignDataWithCBAM(mergedData, false);
  
  // Minimum sample size check
  if (aligned.y.length < 20) {
    return {
      feasible: false,
      reason: `Insufficient observations (N=${aligned.y.length} < 20 required for OLS)`,
      n: aligned.y.length
    };
  }
  
  const result = multipleOLS(aligned.y, [aligned.x1, aligned.x2, aligned.x3]);
  if (!result) {
    return {
      feasible: false,
      reason: 'Regression estimation failed',
      n: aligned.y.length
    };
  }
  
  return {
    feasible: true,
    model: 'Baseline',
    frequency,
    intercept: result.coefficients[0],
    carbonPriceCoeff: result.coefficients[1],
    carbonPriceSE: result.standardErrors[1],
    carbonPriceTStat: result.tStats[1],
    carbonPricePValue: result.pValues[1],
    activityCoeff: result.coefficients[2],
    activitySE: result.standardErrors[2],
    activityTStat: result.tStats[2],
    activityPValue: result.pValues[2],
    cbamCoeff: result.coefficients[3],
    cbamSE: result.standardErrors[3],
    cbamTStat: result.tStats[3],
    cbamPValue: result.pValues[3],
    rSquared: result.rSquared,
    n: result.n
  };
};

/**
 * Lagged effects model: LN_IMPORTS = alpha + sum(beta_k * CARBON_PRICE_{t-k}) + gamma * LN_ACTIVITY + error
 * Automatically adjusts maxLags based on available data
 */
export const estimateLaggedModel = (mergedData, requestedMaxLags = 6, frequency = 'monthly') => {
  // Determine feasible lag length
  const n = mergedData.filter(d => 
    d.logImport !== null && 
    d.etsPrice !== null && 
    d.logIndustry !== null
  ).length;
  
  // For annual data, cap at 1
  const effectiveMaxLags = frequency === 'annual' ? Math.min(requestedMaxLags, 1) : requestedMaxLags;
  
  // Calculate required observations: intercept + lags + activity = 1 + (maxLags+1) + 1
  const minRequired = 10 + effectiveMaxLags + 2;
  
  if (n < minRequired) {
    return {
      feasible: false,
      reason: `Insufficient observations (N=${n} < ${minRequired} required for K=${effectiveMaxLags} lagged model)`,
      n,
      requestedMaxLags: effectiveMaxLags
    };
  }
  
  const aligned = alignDataWithLags(mergedData, effectiveMaxLags);
  
  if (aligned.y.length < minRequired) {
    return {
      feasible: false,
      reason: `Insufficient aligned observations (N=${aligned.y.length} < ${minRequired})`,
      n: aligned.y.length,
      requestedMaxLags: effectiveMaxLags
    };
  }
  
  // Build X matrix: [intercept, carbonPrice_t, carbonPrice_t-1, ..., carbonPrice_t-K, logIndustry]
  const X = [];
  for (let i = 0; i < aligned.y.length; i++) {
    const row = [1]; // intercept
    // Add all lagged carbon prices
    for (let k = 0; k <= effectiveMaxLags; k++) {
      row.push(aligned.carbonPrices[k][i]);
    }
    // Add activity
    row.push(aligned.activity[i]);
    X.push(row);
  }
  
  const Y = aligned.y;
  const Xt = transpose(X);
  const XtX = matrixMultiply(Xt, X);
  const XtY = matrixVectorMultiply(Xt, Y);
  
  const coefficients = solveLinearSystem(XtX, XtY);
  if (!coefficients) return null;
  
  // Calculate R-squared
  const yPred = X.map(row => {
    let sum = coefficients[0];
    for (let j = 1; j < coefficients.length; j++) {
      sum += coefficients[j] * row[j];
    }
    return sum;
  });
  
  const meanY = Y.reduce((a, b) => a + b, 0) / Y.length;
  const ssRes = Y.reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
  const ssTot = Y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  
  // Standard errors
  const mse = ssRes / (Y.length - coefficients.length);
  const standardErrors = calculateStandardErrors(XtX, mse);
  const tStats = coefficients.map((coef, i) => 
    standardErrors[i] > 0 ? coef / standardErrors[i] : 0
  );
  const pValues = tStats.map((t, i) => approximatePValue(t, Y.length - coefficients.length));
  
  // Extract lag coefficients
  const lagCoeffs = [];
  for (let k = 0; k <= effectiveMaxLags; k++) {
    lagCoeffs.push({
      lag: k,
      coefficient: coefficients[k + 1],
      se: standardErrors[k + 1],
      tStat: tStats[k + 1],
      pValue: pValues[k + 1]
    });
  }
  
  return {
    feasible: true,
    model: `Lagged (K=${effectiveMaxLags})`,
    frequency,
    maxLags: effectiveMaxLags,
    intercept: coefficients[0],
    lagCoefficients: lagCoeffs,
    activityCoeff: coefficients[effectiveMaxLags + 2],
    activitySE: standardErrors[effectiveMaxLags + 2],
    activityTStat: tStats[effectiveMaxLags + 2],
    activityPValue: pValues[effectiveMaxLags + 2],
    rSquared,
    n: Y.length
  };
};

/**
 * CBAM Interaction model: LN_IMPORTS = alpha + beta1*CARBON_PRICE + beta2*(CARBON_PRICE*CBAM_DUMMY) + beta3*LN_ACTIVITY + error
 * Only estimates if sufficient pre- and post-CBAM observations available
 */
export const estimateCBAMInteractionModel = (mergedData, frequency = 'monthly') => {
  // Check CBAM feasibility
  const preCBAM = mergedData.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year < 2023;
  }).length;
  
  const postCBAM = mergedData.filter(d => {
    const year = new Date(d.date).getFullYear();
    return year >= 2023 && year <= 2025;
  }).length;
  
  // Need at least 10 pre-CBAM and 5 post-CBAM observations
  if (preCBAM < 10 || postCBAM < 5) {
    return {
      feasible: false,
      reason: `Insufficient CBAM period coverage: ${preCBAM} pre-CBAM observations (≥10 required), ${postCBAM} post-CBAM observations (≥5 required)`,
      preCBAM,
      postCBAM
    };
  }
  
  const aligned = alignDataWithCBAM(mergedData, true);
  
  if (aligned.y.length < 20) {
    return {
      feasible: false,
      reason: `Insufficient observations (N=${aligned.y.length} < 20 required for OLS)`,
      n: aligned.y.length,
      preCBAM,
      postCBAM
    };
  }
  
  const result = multipleOLS(aligned.y, [aligned.x1, aligned.x2, aligned.x3]);
  if (!result) {
    return {
      feasible: false,
      reason: 'Regression estimation failed',
      n: aligned.y.length,
      preCBAM,
      postCBAM
    };
  }
  
  return {
    feasible: true,
    model: 'CBAM Interaction',
    frequency,
    intercept: result.coefficients[0],
    carbonPriceCoeff: result.coefficients[1],
    carbonPriceSE: result.standardErrors[1],
    carbonPriceTStat: result.tStats[1],
    carbonPricePValue: result.pValues[1],
    cbamInteractionCoeff: result.coefficients[2],
    cbamInteractionSE: result.standardErrors[2],
    cbamInteractionTStat: result.tStats[2],
    cbamInteractionPValue: result.pValues[2],
    activityCoeff: result.coefficients[3],
    activitySE: result.standardErrors[3],
    activityTStat: result.tStats[3],
    activityPValue: result.pValues[3],
    rSquared: result.rSquared,
    n: result.n,
    preCBAM,
    postCBAM
  };
};

/**
 * Helper: Align data with CBAM dummy
 */
function alignDataWithCBAM(data, includeInteraction) {
  const y = [];
  const x1 = []; // carbonPrice (levels)
  const x2 = []; // logIndustry or interaction term
  const x3 = []; // cbamDummy or activity
  
  for (let i = 0; i < data.length; i++) {
    const logImport = data[i].logImport;
    const etsPrice = data[i].etsPrice;
    const logIndustry = data[i].logIndustry;
    const cbamDummy = data[i].cbamDummy !== undefined ? data[i].cbamDummy : 0;
    
    if (logImport !== null && !isNaN(logImport) &&
        etsPrice !== null && !isNaN(etsPrice) && etsPrice > 0 &&
        logIndustry !== null && !isNaN(logIndustry)) {
      y.push(logImport);
      x1.push(etsPrice);
      
      if (includeInteraction) {
        // x2 = carbonPrice * CBAM_DUMMY
        x2.push(etsPrice * cbamDummy);
        // x3 = logIndustry
        x3.push(logIndustry);
      } else {
        // x2 = logIndustry
        x2.push(logIndustry);
        // x3 = cbamDummy
        x3.push(cbamDummy);
      }
    }
  }
  
  return { y, x1, x2, x3 };
}

/**
 * Helper: Align data with multiple lags
 */
function alignDataWithLags(data, maxLags) {
  const y = [];
  const carbonPrices = []; // Array of arrays, one for each lag (0 to maxLags)
  const activity = [];
  
  // Initialize carbon price arrays
  for (let k = 0; k <= maxLags; k++) {
    carbonPrices.push([]);
  }
  
  for (let i = maxLags; i < data.length; i++) {
    const logImport = data[i].logImport;
    const logIndustry = data[i].logIndustry;
    
    if (logImport === null || isNaN(logImport) ||
        logIndustry === null || isNaN(logIndustry)) {
      continue;
    }
    
    // Check if all required lags are available
    let allLagsAvailable = true;
    for (let k = 0; k <= maxLags; k++) {
      const etsPrice = data[i - k]?.etsPrice;
      if (etsPrice === null || isNaN(etsPrice) || etsPrice <= 0) {
        allLagsAvailable = false;
        break;
      }
    }
    
    if (!allLagsAvailable) continue;
    
    y.push(logImport);
    activity.push(logIndustry);
    
    for (let k = 0; k <= maxLags; k++) {
      carbonPrices[k].push(data[i - k].etsPrice);
    }
  }
  
  return { y, carbonPrices, activity };
}

/**
 * Calculate rolling correlation
 */
export const rollingCorrelation = (x, y, window = 12) => {
  const correlations = [];
  
  for (let i = window - 1; i < x.length; i++) {
    const xWindow = x.slice(i - window + 1, i + 1).filter(v => v !== null && !isNaN(v));
    const yWindow = y.slice(i - window + 1, i + 1).filter(v => v !== null && !isNaN(v));
    
    if (xWindow.length === window && yWindow.length === window) {
      const corr = calculateCorrelation(xWindow, yWindow);
      correlations.push({
        index: i,
        correlation: corr
      });
    }
  }
  
  return correlations;
};

/**
 * Helper functions
 */
function alignData(data, keys, lag = 0) {
  const y = [];
  const x1 = [];
  const x2 = [];
  
  for (let i = lag; i < data.length; i++) {
    const yVal = data[i][keys[0]];
    const x1Val = data[i - lag][keys[1]];
    const x2Val = data[i - lag][keys[2]];
    
    if (yVal !== null && !isNaN(yVal) && 
        x1Val !== null && !isNaN(x1Val) && 
        x2Val !== null && !isNaN(x2Val)) {
      y.push(yVal);
      x1.push(x1Val);
      x2.push(x2Val);
    }
  }
  
  return { y, x1, x2 };
}

function calculateCorrelation(x, y) {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  
  const denominator = Math.sqrt(sumSqX * sumSqY);
  return denominator > 0 ? numerator / denominator : 0;
}

function approximatePValue(tStat, df) {
  // Simplified p-value approximation using t-distribution
  // For large df, use normal approximation
  if (df > 30) {
    const z = Math.abs(tStat);
    // Normal approximation: P(|Z| > z) ≈ 2 * (1 - Φ(z))
    // Using rough approximation: 2 * (1 - 0.5 * (1 + erf(z/√2)))
    return 2 * (1 - normalCDF(z));
  }
  
  // For small df, use rough t-distribution approximation
  const absT = Math.abs(tStat);
  if (absT < 0.5) return 0.6;
  if (absT < 1.0) return 0.3;
  if (absT < 1.5) return 0.15;
  if (absT < 2.0) return 0.05;
  if (absT < 2.5) return 0.02;
  if (absT < 3.0) return 0.01;
  return 0.001;
}

function normalCDF(z) {
  // Approximation of standard normal CDF
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function erf(x) {
  // Approximation of error function
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}

function transpose(matrix) {
  return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
}

function matrixMultiply(a, b) {
  const result = [];
  for (let i = 0; i < a.length; i++) {
    result[i] = [];
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < a[0].length; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function matrixVectorMultiply(matrix, vector) {
  return matrix.map(row => 
    row.reduce((sum, val, i) => sum + val * vector[i], 0)
  );
}

function solveLinearSystem(A, b) {
  // Simplified Gaussian elimination for small systems
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);
  
  // Forward elimination
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    
    // Make all rows below this one 0
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j < n + 1; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }
  
  // Back substitution
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }
  
  return x;
}

function calculateStandardErrors(XtX, mse) {
  // Standard errors = sqrt(diag(mse * inv(XtX)))
  // Simplified: just use diagonal elements
  const n = XtX.length;
  const se = [];
  
  // For simplicity, use diagonal approximation
  for (let i = 0; i < n; i++) {
    se.push(Math.sqrt(mse * Math.abs(XtX[i][i])));
  }
  
  return se;
}

