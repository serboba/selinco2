import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ReferenceLine,
  ComposedChart,
  Area,
  AreaChart,
  Cell,
  PieChart,
  Pie
} from 'recharts';
// Data is now preprocessed - no need to import parsers
import {
  estimateElasticity,
  rollingCorrelation,
  simpleOLS,
  calculateSummaryStats,
  estimateBaselineModel,
  estimateLaggedModel,
  estimateCBAMInteractionModel
} from '../utils/econometricAnalysis';
import {
  prepareDataset,
  determineFeasibleLagLength,
  checkCBAMFeasibility,
  calculateCBAMDescriptive
} from '../utils/dataValidation';
import './CarbonLeakageDashboard.css';

const COLORS = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#8B5CF6'];

function CarbonLeakageDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rawImports, setRawImports] = useState([]);
  const [etsData, setEtsData] = useState([]);
  const [industryData, setIndustryData] = useState([]);
  const [mergedData, setMergedData] = useState([]);
  const [topCountries, setTopCountries] = useState([]);
  const [regressionResults, setRegressionResults] = useState([]);
  const [baselineModel, setBaselineModel] = useState(null);
  const [laggedModel6, setLaggedModel6] = useState(null);
  const [laggedModel12, setLaggedModel12] = useState(null);
  const [cbamInteractionModel, setCbamInteractionModel] = useState(null);
  const [summaryStats, setSummaryStats] = useState(null);
  const [preparedData, setPreparedData] = useState(null);
  const [dataFrequency, setDataFrequency] = useState('monthly');
  const [cbamDescriptive, setCbamDescriptive] = useState(null);
  const [methodologicalNotes, setMethodologicalNotes] = useState([]);
  
  // Filters
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [selectedCountry, setSelectedCountry] = useState('All');
  const [analysisType, setAnalysisType] = useState('volume'); // 'volume' or 'value'
  
  useEffect(() => {
    loadData();
  }, []);
  
  useEffect(() => {
    if (mergedData.length > 0) {
      // Prepare dataset (aggregate to annual if needed)
      const prepared = prepareDataset(mergedData);
      setPreparedData(prepared);
      setDataFrequency(prepared.frequency);
      
      const analysisData = prepared.data;
      const notes = [prepared.message];
      
      if (prepared.frequency === 'annual') {
        notes.push('Models estimated using annual data. Coefficients should be interpreted as annual effects.');
      }
      
      // Legacy elasticity estimates (for backward compatibility)
      const results = estimateElasticity(analysisData, true, 3);
      setRegressionResults(results);
      
      // New econometric models with validation
      const baseline = estimateBaselineModel(analysisData, prepared.frequency);
      setBaselineModel(baseline);
      if (!baseline.feasible) {
        notes.push(`Baseline model: ${baseline.reason}`);
      }
      
      // Determine feasible lag lengths
      const lagInfo = determineFeasibleLagLength(analysisData.length, prepared.frequency);
      notes.push(`Lagged models: ${lagInfo.reason}`);
      
      // Estimate lagged models only if feasible
      if (lagInfo.feasible && lagInfo.maxLag >= 1) {
        const maxLag6 = Math.min(6, lagInfo.maxLag);
        const lagged6 = estimateLaggedModel(analysisData, maxLag6, prepared.frequency);
        setLaggedModel6(lagged6);
        if (!lagged6.feasible) {
          notes.push(`Lagged model (K=${maxLag6}): ${lagged6.reason}`);
        }
        
        if (lagInfo.maxLag >= 12 && prepared.frequency === 'monthly') {
          const lagged12 = estimateLaggedModel(analysisData, 12, prepared.frequency);
          setLaggedModel12(lagged12);
          if (!lagged12.feasible) {
            notes.push(`Lagged model (K=12): ${lagged12.reason}`);
          }
        } else {
          setLaggedModel12({ feasible: false, reason: `Long lag structures (K≥6) are statistically infeasible with ${analysisData.length} ${prepared.frequency} observations. Maximum feasible lag: K=${lagInfo.maxLag}` });
        }
      } else {
        setLaggedModel6({ feasible: false, reason: lagInfo.reason });
        setLaggedModel12({ feasible: false, reason: lagInfo.reason });
      }
      
      // Check CBAM interaction feasibility
      const cbamCheck = checkCBAMFeasibility(analysisData);
      if (cbamCheck.feasible) {
        const interaction = estimateCBAMInteractionModel(analysisData, prepared.frequency);
        setCbamInteractionModel(interaction);
        if (!interaction.feasible) {
          notes.push(`CBAM interaction model: ${interaction.reason}`);
        }
      } else {
        setCbamInteractionModel({ feasible: false, reason: cbamCheck.reason, preCBAM: cbamCheck.preCBAM, postCBAM: cbamCheck.postCBAM });
        notes.push(`CBAM interaction model: ${cbamCheck.reason}`);
        
        // Calculate descriptive statistics instead
        const descriptive = calculateCBAMDescriptive(analysisData);
        setCbamDescriptive(descriptive);
      }
      
      // Summary statistics
      const stats = {
        imports: calculateSummaryStats(analysisData, 'importQuantity_tons'),
        logImports: calculateSummaryStats(analysisData, 'logImport'),
        carbonPrice: calculateSummaryStats(analysisData, 'etsPrice'),
        activity: calculateSummaryStats(analysisData, 'industryIndex'),
        logActivity: calculateSummaryStats(analysisData, 'logIndustry')
      };
      setSummaryStats(stats);
      
      setMethodologicalNotes(notes);
    }
  }, [mergedData]);
  
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load preprocessed JSON files (much faster than Excel)
      const [mergedRes, importsRes, etsRes, industryRes, countriesRes] = await Promise.all([
        fetch('/carbon_leakage/merged_data.json').then(r => {
          if (!r.ok) throw new Error(`Failed to load merged_data.json: ${r.status}`);
          return r.json();
        }),
        fetch('/carbon_leakage/raw_imports.json').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/carbon_leakage/ets_data.json').then(r => {
          if (!r.ok) throw new Error(`Failed to load ets_data.json: ${r.status}`);
          return r.json();
        }),
        fetch('/carbon_leakage/industry_data.json').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/carbon_leakage/top_countries.json').then(r => r.ok ? r.json() : []).catch(() => [])
      ]);
      
      console.log('Loaded preprocessed data:', {
        merged: mergedRes.length,
        imports: importsRes.length,
        ets: etsRes.length,
        industry: industryRes.length,
        countries: countriesRes.length
      });
      
      // Convert date strings back to Date objects
      const merged = mergedRes.map(d => ({
        ...d,
        date: new Date(d.date)
      }));
      
      const imports = importsRes.map(d => ({
        ...d,
        date: new Date(d.date)
      }));
      
      const ets = etsRes.map(d => ({
        ...d,
        date: new Date(d.date)
      }));
      
      const industry = industryRes.map(d => ({
        ...d,
        date: new Date(d.date)
      }));
      
      if (merged.length === 0) {
        throw new Error('No data available. Please run "npm run preprocess" to generate the data files.');
      }
      
      setRawImports(imports);
      setEtsData(ets);
      setIndustryData(industry);
      setMergedData(merged);
      setTopCountries(countriesRes);
      
      // Set default date range
      if (merged.length > 0) {
        setDateRange({
          start: merged[0].date,
          end: merged[merged.length - 1].date
        });
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message || 'Unknown error occurred while loading data. Make sure to run "npm run preprocess" first.');
      setLoading(false);
    }
  };
  
  // Filter data based on user selections
  const filteredData = useMemo(() => {
    let filtered = [...mergedData];
    
    if (dateRange.start) {
      const startDate = new Date(dateRange.start);
      startDate.setHours(0, 0, 0, 0);
      filtered = filtered.filter(d => {
        const dDate = new Date(d.date);
        dDate.setHours(0, 0, 0, 0);
        return dDate >= startDate;
      });
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(d => {
        const dDate = new Date(d.date);
        dDate.setHours(0, 0, 0, 0);
        return dDate <= endDate;
      });
    }
    
    return filtered;
  }, [mergedData, dateRange.start, dateRange.end]);
  
  // Get country-specific data if selected
  const countryData = useMemo(() => {
    if (selectedCountry === 'All' || !rawImports.length) return null;
    
    // Filter merged data by country (if we have country breakdown in merged data)
    // For now, just filter the raw imports and create a simplified view
    const countryImports = rawImports.filter(i => i.partnerCountry === selectedCountry);
    if (countryImports.length === 0) return null;
    
    // Aggregate by period for this country
    const countryByPeriod = new Map();
    countryImports.forEach(entry => {
      const key = entry.yearMonth;
      if (!countryByPeriod.has(key)) {
        countryByPeriod.set(key, {
          date: entry.date,
          yearMonth: key,
          importQuantity_tons: 0,
          importValue_eur: 0
        });
      }
      const period = countryByPeriod.get(key);
      period.importQuantity_tons += entry.quantity_tons;
      period.importValue_eur += entry.value_eur;
    });
    
    // Merge with ETS and industry data
    const countryMerged = Array.from(countryByPeriod.values()).map(period => {
      const etsEntry = etsData.find(e => e.yearMonth === period.yearMonth);
      const industryEntry = industryData.find(i => i.yearMonth === period.yearMonth);
      
      return {
        ...period,
        etsPrice: etsEntry?.price || null,
        industryIndex: industryEntry?.index || null,
        importUnitValue: period.importQuantity_tons > 0 ? (period.importValue_eur / period.importQuantity_tons) : null
      };
    }).sort((a, b) => a.date - b.date);
    
    // Calculate indicators
    return countryMerged.map((entry, index) => {
      const prev = index > 0 ? countryMerged[index - 1] : null;
      const logImport = entry.importQuantity_tons > 0 ? Math.log(entry.importQuantity_tons) : null;
      const logETS = entry.etsPrice > 0 ? Math.log(entry.etsPrice) : null;
      const logIndustry = entry.industryIndex > 0 ? Math.log(entry.industryIndex) : null;
      
      return {
        ...entry,
        importGrowth: prev && prev.importQuantity_tons ? ((entry.importQuantity_tons - prev.importQuantity_tons) / prev.importQuantity_tons) * 100 : null,
        logImport,
        logETS,
        logIndustry
      };
    });
  }, [selectedCountry, rawImports, etsData, industryData]);
  
  // Ensure displayData is stable and always defined
  const displayData = useMemo(() => {
    if (selectedCountry !== 'All' && countryData) {
      return countryData;
    }
    return filteredData || [];
  }, [selectedCountry, countryData, filteredData]);
  
  // Calculate KPIs
  const kpis = useMemo(() => {
    if (displayData.length === 0) return null;
    
    const latest = displayData[displayData.length - 1];
    const oneYearAgo = displayData.length >= 12 ? displayData[displayData.length - 12] : displayData[0];
    
    const latestETS = latest?.etsPrice || 0;
    const importYoY = oneYearAgo && latest?.importQuantity_tons && oneYearAgo.importQuantity_tons
      ? ((latest.importQuantity_tons - oneYearAgo.importQuantity_tons) / oneYearAgo.importQuantity_tons) * 100
      : null;
    
    const topSupplier = topCountries.length > 0 ? topCountries[0] : null;
    
    const elasticity = regressionResults.length > 0 ? regressionResults[0].elasticity : null;
    
    return {
      latestETS,
      importYoY,
      topSupplier,
      elasticity
    };
  }, [displayData, topCountries, regressionResults]);
  
  // Prepare scatter plot data
  const scatterData = useMemo(() => {
    return displayData
      .filter(d => {
        const hasPrice = d.etsPrice !== null && !isNaN(d.etsPrice) && d.etsPrice > 0;
        const hasImport = d.importQuantity_tons !== null && !isNaN(d.importQuantity_tons) && d.importQuantity_tons > 0;
        return hasPrice && hasImport;
      })
      .map(d => ({
        etsPrice: d.etsPrice,
        importQuantity: d.importQuantity_tons,
        date: d.date
      }));
  }, [displayData]);
  
  // Calculate regression line for scatter plot
  const scatterRegression = useMemo(() => {
    if (scatterData.length < 10) return null;
    const x = scatterData.map(d => d.etsPrice);
    const y = scatterData.map(d => d.importQuantity);
    return simpleOLS(y, x);
  }, [scatterData]);
  
  // Rolling correlation
  const rollingCorr = useMemo(() => {
    if (displayData.length < 12) return [];
    const validData = displayData.filter(d => 
      d.etsPrice !== null && !isNaN(d.etsPrice) && 
      d.importQuantity_tons !== null && !isNaN(d.importQuantity_tons)
    );
    if (validData.length < 12) return [];
    const etsPrices = validData.map(d => d.etsPrice);
    const imports = validData.map(d => d.importQuantity_tons);
    return rollingCorrelation(etsPrices, imports, 12);
  }, [displayData]);

  // Calculate growth rates and deltas for financial analysis
  const growthData = useMemo(() => {
    return displayData.map((d, index) => {
      const prev = index > 0 ? displayData[index - 1] : null;
      const prev12 = index >= 12 ? displayData[index - 12] : null;
      
      const momVolume = prev && prev.importQuantity_tons && d.importQuantity_tons
        ? ((d.importQuantity_tons - prev.importQuantity_tons) / prev.importQuantity_tons) * 100
        : null;
      
      const yoyVolume = prev12 && prev12.importQuantity_tons && d.importQuantity_tons
        ? ((d.importQuantity_tons - prev12.importQuantity_tons) / prev12.importQuantity_tons) * 100
        : null;
      
      const momValue = prev && prev.importValue_eur && d.importValue_eur
        ? ((d.importValue_eur - prev.importValue_eur) / prev.importValue_eur) * 100
        : null;
      
      const yoyValue = prev12 && prev12.importValue_eur && d.importValue_eur
        ? ((d.importValue_eur - prev12.importValue_eur) / prev12.importValue_eur) * 100
        : null;
      
      const etsChange = prev && prev.etsPrice && d.etsPrice
        ? ((d.etsPrice - prev.etsPrice) / prev.etsPrice) * 100
        : null;
      
      const volumeDelta = prev && prev.importQuantity_tons && d.importQuantity_tons
        ? d.importQuantity_tons - prev.importQuantity_tons
        : null;
      
      const valueDelta = prev && prev.importValue_eur && d.importValue_eur
        ? d.importValue_eur - prev.importValue_eur
        : null;
      
      return {
        ...d,
        momVolume,
        yoyVolume,
        momValue,
        yoyValue,
        etsChange,
        volumeDelta,
        valueDelta
      };
    });
  }, [displayData]);

  // Cumulative imports
  const cumulativeData = useMemo(() => {
    let cumVolume = 0;
    let cumValue = 0;
    return displayData.map(d => {
      if (d.importQuantity_tons !== null && !isNaN(d.importQuantity_tons)) {
        cumVolume += d.importQuantity_tons;
      }
      if (d.importValue_eur !== null && !isNaN(d.importValue_eur)) {
        cumValue += d.importValue_eur;
      }
      return {
        ...d,
        cumulativeVolume: cumVolume,
        cumulativeValue: cumValue
      };
    });
  }, [displayData]);

  // Industry index growth rates and correlations
  const industryGrowthData = useMemo(() => {
    return displayData.map((d, index) => {
      const prev = index > 0 ? displayData[index - 1] : null;
      const prev12 = index >= 12 ? displayData[index - 12] : null;
      
      const industryGrowth = prev && prev.industryIndex && d.industryIndex
        ? ((d.industryIndex - prev.industryIndex) / prev.industryIndex) * 100
        : null;
      
      const industryGrowthYoY = prev12 && prev12.industryIndex && d.industryIndex
        ? ((d.industryIndex - prev12.industryIndex) / prev12.industryIndex) * 100
        : null;
      
      return {
        ...d,
        industryGrowth,
        industryGrowthYoY
      };
    });
  }, [displayData]);

  // Industry vs Import correlation data
  const industryImportScatter = useMemo(() => {
    return displayData
      .filter(d => d.industryIndex !== null && d.importQuantity_tons !== null && 
                   !isNaN(d.industryIndex) && !isNaN(d.importQuantity_tons) &&
                   d.industryIndex > 0 && d.importQuantity_tons > 0)
      .map(d => ({
        industryIndex: d.industryIndex,
        importQuantity: d.importQuantity_tons,
        date: d.date
      }));
  }, [displayData]);

  // Industry vs ETS correlation data
  const industryETSScatter = useMemo(() => {
    return displayData
      .filter(d => d.industryIndex !== null && d.etsPrice !== null && 
                   !isNaN(d.industryIndex) && !isNaN(d.etsPrice) &&
                   d.industryIndex > 0 && d.etsPrice > 0)
      .map(d => ({
        industryIndex: d.industryIndex,
        etsPrice: d.etsPrice,
        date: d.date
      }));
  }, [displayData]);

  // Country market share over time
  const countryShareData = useMemo(() => {
    if (!rawImports.length || selectedCountry !== 'All') return null;
    
    const top5Countries = topCountries.slice(0, 5).map(c => c.country);
    const shareByPeriod = new Map();
    
    // Aggregate by period and country
    rawImports.forEach(entry => {
      if (!top5Countries.includes(entry.partnerCountry)) return;
      
      const key = entry.yearMonth;
      if (!shareByPeriod.has(key)) {
        shareByPeriod.set(key, {
          date: entry.date,
          yearMonth: key,
          total: 0,
          countries: {}
        });
      }
      
      const period = shareByPeriod.get(key);
      if (!period.countries[entry.partnerCountry]) {
        period.countries[entry.partnerCountry] = 0;
      }
      period.countries[entry.partnerCountry] += entry.quantity_tons || 0;
      period.total += entry.quantity_tons || 0;
    });
    
    return Array.from(shareByPeriod.values())
      .map(period => {
        const result = { date: period.date, yearMonth: period.yearMonth };
        top5Countries.forEach(country => {
          const share = period.total > 0 
            ? (period.countries[country] || 0) / period.total * 100 
            : 0;
          result[country.substring(0, 20)] = share;
        });
        return result;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [rawImports, topCountries, selectedCountry]);

  // Volatility (rolling standard deviation)
  const volatilityData = useMemo(() => {
    const window = 12;
    return displayData.map((d, index) => {
      const windowData = displayData.slice(Math.max(0, index - window + 1), index + 1)
        .filter(dd => dd.importQuantity_tons !== null && !isNaN(dd.importQuantity_tons))
        .map(dd => dd.importQuantity_tons);
      
      if (windowData.length < 6) return { ...d, volatility: null };
      
      const mean = windowData.reduce((a, b) => a + b, 0) / windowData.length;
      const variance = windowData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowData.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? (stdDev / mean) * 100 : null; // Coefficient of variation
      
      return {
        ...d,
        volatility: stdDev,
        volatilityPct: cv
      };
    });
  }, [displayData]);

  // Yearly aggregation for annual analysis
  const yearlyData = useMemo(() => {
    const byYear = new Map();
    displayData.forEach(d => {
      const year = new Date(d.date).getFullYear();
      if (!byYear.has(year)) {
        byYear.set(year, {
          year,
          totalVolume: 0,
          totalValue: 0,
          avgPrice: null,
          avgETS: null,
          avgIndustry: null,
          count: 0,
          etsSum: 0,
          etsCount: 0,
          industrySum: 0,
          industryCount: 0
        });
      }
      const yearData = byYear.get(year);
      if (d.importQuantity_tons !== null && !isNaN(d.importQuantity_tons)) {
        yearData.totalVolume += d.importQuantity_tons;
        yearData.count++;
      }
      if (d.importValue_eur !== null && !isNaN(d.importValue_eur)) {
        yearData.totalValue += d.importValue_eur;
      }
      if (d.etsPrice !== null && !isNaN(d.etsPrice)) {
        yearData.etsSum += d.etsPrice;
        yearData.etsCount++;
      }
      if (d.industryIndex !== null && !isNaN(d.industryIndex)) {
        yearData.industrySum += d.industryIndex;
        yearData.industryCount++;
      }
    });
    
    return Array.from(byYear.values())
      .map(y => ({
        ...y,
        avgUnitValue: y.totalVolume > 0 ? y.totalValue / y.totalVolume : null,
        avgETS: y.etsCount > 0 ? y.etsSum / y.etsCount : null,
        avgIndustry: y.industryCount > 0 ? y.industrySum / y.industryCount : null,
        yoyVolumeChange: null,
        yoyValueChange: null,
        date: new Date(y.year, 0, 1)
      }))
      .sort((a, b) => a.year - b.year)
      .map((y, index, arr) => {
        const prev = index > 0 ? arr[index - 1] : null;
        if (prev) {
          y.yoyVolumeChange = prev.totalVolume > 0 
            ? ((y.totalVolume - prev.totalVolume) / prev.totalVolume) * 100 
            : null;
          y.yoyValueChange = prev.totalValue > 0 
            ? ((y.totalValue - prev.totalValue) / prev.totalValue) * 100 
            : null;
        }
        return y;
      });
  }, [displayData]);

  // Yearly aggregated data for main charts (starting from 2020)
  const yearlyDataFrom2020 = useMemo(() => {
    return yearlyData.filter(d => d.year >= 2020);
  }, [yearlyData]);

  // Calculate trend line using linear regression (for date-based data)
  const calculateTrendLine = useMemo(() => {
    return (data, xKey, yKey) => {
      const validData = data.filter(d => {
        const xVal = d[xKey];
        const yVal = d[yKey];
        return xVal !== null && yVal !== null && !isNaN(yVal) && yVal > 0;
      });
      if (validData.length < 2) return null;
      
      // Convert dates to numeric values (timestamp)
      const numericData = validData.map((d, i) => {
        const xVal = d[xKey];
        const dateVal = xVal instanceof Date ? xVal.getTime() : (typeof xVal === 'string' ? new Date(xVal).getTime() : xVal);
        return { x: dateVal, y: d[yKey], original: d };
      }).filter(d => !isNaN(d.x) && !isNaN(d.y));
      
      if (numericData.length < 2) return null;
      
      const n = numericData.length;
      const sumX = numericData.reduce((sum, d) => sum + d.x, 0);
      const sumY = numericData.reduce((sum, d) => sum + d.y, 0);
      const sumXY = numericData.reduce((sum, d) => sum + d.x * d.y, 0);
      const sumX2 = numericData.reduce((sum, d) => sum + d.x * d.x, 0);
      
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      
      const minX = Math.min(...numericData.map(d => d.x));
      const maxX = Math.max(...numericData.map(d => d.x));
      
      return {
        slope,
        intercept,
        minDate: new Date(minX),
        maxDate: new Date(maxX),
        minY: intercept + slope * minX,
        maxY: intercept + slope * maxX,
        isUptrend: slope > 0
      };
    };
  }, []);

  // Data filtered from 2020 for industry charts
  const industryDataFrom2020 = useMemo(() => {
    return displayData.filter(d => {
      const year = new Date(d.date).getFullYear();
      return year >= 2020 && d.industryIndex !== null;
    });
  }, [displayData]);

  const industryImportScatterFrom2020 = useMemo(() => {
    return industryImportScatter.filter(d => {
      const year = new Date(d.date).getFullYear();
      return year >= 2020;
    });
  }, [industryImportScatter]);

  const industryETSScatterFrom2020 = useMemo(() => {
    return industryETSScatter.filter(d => {
      const year = new Date(d.date).getFullYear();
      return year >= 2020;
    });
  }, [industryETSScatter]);

  // Calculate statistics for Industry Index
  const industryIndexStats = useMemo(() => {
    const data = industryDataFrom2020.filter(d => d.industryIndex !== null).map(d => d.industryIndex);
    if (data.length === 0) return null;
    
    const sorted = [...data].sort((a, b) => a - b);
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    
    return { mean, median, q1, q3, min, max, stdDev };
  }, [industryDataFrom2020]);

  // Calculate statistics for Import Volumes
  const importVolumeStats = useMemo(() => {
    const data = industryDataFrom2020.filter(d => d.importQuantity_tons !== null).map(d => d.importQuantity_tons);
    if (data.length === 0) return null;
    
    const sorted = [...data].sort((a, b) => a - b);
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    
    return { mean, median, q1, q3, min, max, stdDev };
  }, [industryDataFrom2020]);

  // Calculate statistics for ETS Prices
  const etsPriceStats = useMemo(() => {
    const data = industryDataFrom2020.filter(d => d.etsPrice !== null).map(d => d.etsPrice);
    if (data.length === 0) return null;
    
    const sorted = [...data].sort((a, b) => a - b);
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    
    return { mean, median, q1, q3, min, max, stdDev };
  }, [industryDataFrom2020]);
  
  // Detect if data is sparse (not enough monthly data points)
  // Use yearly ticks if average data points per year is less than 8
  // NOTE: Must be defined before early returns to maintain hook order
  const isDataSparse = useMemo(() => {
    if (displayData.length < 12) return true; // Less than a year of data
    
    // Count data points per year
    const yearCounts = new Map();
    displayData.forEach(d => {
      const year = new Date(d.date).getFullYear();
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    });
    
    if (yearCounts.size === 0) return true;
    
    // Calculate average data points per year
    const totalPoints = Array.from(yearCounts.values()).reduce((a, b) => a + b, 0);
    const avgPerYear = totalPoints / yearCounts.size;
    
    // If average is less than 8 points per year, consider it sparse (use yearly ticks)
    return avgPerYear < 8;
  }, [displayData]);

  // Smart date formatter - shows years when data is sparse
  const formatDate = useMemo(() => {
    return (date) => {
      if (!date) return '';
      const d = new Date(date);
      // If data is sparse, show only year; otherwise show year and month
      if (isDataSparse) {
        return d.getFullYear().toString();
      }
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    };
  }, [isDataSparse]);
  
  // Format date for X-axis with smart tick filtering (only show years when sparse)
  const formatDateAxis = useMemo(() => {
    return (date, index) => {
      if (!date) return '';
      const d = new Date(date);
      
      if (isDataSparse) {
        // Show only year, and only for January (month 0) or first data point of each year
        if (d.getMonth() === 0) {
          return d.getFullYear().toString();
        }
        // Check if this is the first occurrence of this year in the data
        const year = d.getFullYear();
        const yearFirstIndex = displayData.findIndex(dd => new Date(dd.date).getFullYear() === year);
        if (index === yearFirstIndex) {
          return d.getFullYear().toString();
        }
        return ''; // Don't show tick for other months when sparse
      }
      
      // For monthly data, show year for January, month abbreviation for others
      if (d.getMonth() === 0) {
        return d.getFullYear().toString();
      }
      return d.toLocaleDateString('en-US', { month: 'short' });
    };
  }, [isDataSparse, displayData]);
  
  // Get unique years for tick positioning when data is sparse
  const yearTicks = useMemo(() => {
    if (!isDataSparse) return undefined;
    const years = [...new Set(displayData.map(d => new Date(d.date).getFullYear()))].sort();
    // Return dates for January 1st of each year
    return years.map(year => new Date(year, 0, 1));
  }, [isDataSparse, displayData]);
  
  const formatValue = (value) => {
    if (value === null || value === undefined) return 'N/A';
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}K`;
    return value.toFixed(2);
  };
  
  // Early returns must come AFTER all hooks are defined
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading Carbon Leakage Analysis...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="error-container">
        <h2>Error Loading Data</h2>
        <p>{error}</p>
        <p>Please ensure the Excel files are available in the public folder.</p>
      </div>
    );
  }
  
  if (mergedData.length === 0) {
    return (
      <div className="error-container">
        <h2>No Data Available</h2>
        <p>Unable to load or parse the required data files.</p>
      </div>
    );
  }
  
  return (
    <div className="carbon-leakage-dashboard">
      <header className="dashboard-header">
        <h1>Carbon Leakage Analysis: EU ETS Prices & Steel Imports</h1>
        <p className="subtitle">Investigating the relationship between carbon pricing and extra-EU iron and steel imports (HS 72)</p>
      </header>
      
      {/* Filters */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Time Range:</label>
          <input
            type="date"
            value={dateRange.start ? dateRange.start.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              const newDate = e.target.value ? new Date(e.target.value + 'T00:00:00') : null;
              setDateRange(prev => ({ ...prev, start: newDate }));
            }}
          />
          <span>to</span>
          <input
            type="date"
            value={dateRange.end ? dateRange.end.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              const newDate = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
              setDateRange(prev => ({ ...prev, end: newDate }));
            }}
          />
          <button 
            onClick={() => {
              if (mergedData.length > 0) {
                setDateRange({
                  start: mergedData[0].date,
                  end: mergedData[mergedData.length - 1].date
                });
              }
            }}
            style={{ marginLeft: '10px', padding: '5px 10px', cursor: 'pointer' }}
          >
            Reset
          </button>
        </div>
        <div className="filter-group">
          <label>Partner Country:</label>
          <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)}>
            <option value="All">All Countries</option>
            {topCountries.slice(0, 10).map(c => (
              <option key={c.country} value={c.country}>{c.country}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Analysis Type:</label>
          <select value={analysisType} onChange={(e) => setAnalysisType(e.target.value)}>
            <option value="volume">Volume (Tons)</option>
            <option value="value">Value (EUR)</option>
          </select>
        </div>
      </div>
      
      {/* Market Overview - KPIs */}
      <div className="metrics-grid">
        <MetricCard
          title="Latest EU ETS Price"
          value={kpis?.latestETS ? `€${kpis.latestETS.toFixed(2)}` : 'N/A'}
          subtitle="Per tonne CO₂"
          color="#7C3AED"
        />
        <MetricCard
          title="YoY Import Change"
          value={kpis?.importYoY !== null ? `${kpis.importYoY >= 0 ? '+' : ''}${kpis.importYoY.toFixed(2)}%` : 'N/A'}
          subtitle="Year-over-year"
          color={kpis?.importYoY > 0 ? '#EF4444' : '#10B981'}
        />
        <MetricCard
          title="Top Extra-EU Supplier"
          value={kpis?.topSupplier ? kpis.topSupplier.country : 'N/A'}
          subtitle={kpis?.topSupplier ? `${formatValue(kpis.topSupplier.totalQuantity_tons)} tons` : ''}
          color="#2563EB"
        />
        <MetricCard
          title="ETS Price Elasticity"
          value={kpis?.elasticity !== null ? kpis.elasticity.toFixed(3) : 'N/A'}
          subtitle={kpis?.elasticity !== null ? (kpis.elasticity > 0 ? 'Positive (leakage risk)' : 'Negative (no leakage)') : ''}
          color={kpis?.elasticity > 0 ? '#EF4444' : '#10B981'}
        />
      </div>
      
      {/* Market Overview - Time Series */}
      <div className="chart-container main-chart">
        <h2>EU ETS Price vs Extra-EU Steel Import Volumes</h2>
        <p className="chart-description">
          Dual-axis visualization showing the relationship between carbon pricing and import volumes over time. 
          Policy periods are marked: ETS Phase III/IV and CBAM transition period (2023-2025).
        </p>
        <ResponsiveContainer width="100%" height={450}>
          <ComposedChart data={yearlyData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="year"
              stroke="#6B7280"
              tickFormatter={(year) => year.toString()}
              angle={0}
              textAnchor="middle"
              height={80}
            />
            <YAxis
              yAxisId="left"
              stroke="#7C3AED"
              tickFormatter={(value) => formatValue(value)}
              label={{ value: 'Import Volume (tons)', angle: -90, position: 'insideLeft' }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#EF4444"
              tickFormatter={(value) => `€${value.toFixed(0)}`}
              label={{ value: 'ETS Price (€/tCO₂)', angle: 90, position: 'insideRight' }}
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === 'ETS Price') return [`€${value.toFixed(2)}`, name];
                if (name === 'Import Volume') return [formatValue(value) + ' tons', name];
                return [value, name];
              }}
              labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
            />
            <Legend />
            
            {/* Policy period markers */}
            <ReferenceLine
              yAxisId="left"
              x={2023}
              stroke="#8B5CF6"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
            <ReferenceLine
              yAxisId="left"
              x={2026}
              stroke="#EC4899"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
            
            <Bar
              yAxisId="left"
              dataKey="totalVolume"
              fill="#2563EB"
              fillOpacity={0.6}
              name="Import Volume"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="avgETS"
              stroke="#EF4444"
              strokeWidth={3}
              dot={true}
              name="ETS Price"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Financial Analysis: Growth Rates & Deltas */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Year-over-Year Growth Rates</h2>
          <p className="chart-description">
            Annual percentage change in import volumes and values
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={yearlyData.filter(d => d.yoyVolumeChange !== null || d.yoyValueChange !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
                tickFormatter={(year) => year.toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'YoY Change (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [`${value !== null ? value.toFixed(2) : 'N/A'}%`, '']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="yoyVolumeChange"
                stroke="#2563EB"
                strokeWidth={2.5}
                dot={true}
                name="Volume YoY %"
              />
              <Line
                type="monotone"
                dataKey="yoyValueChange"
                stroke="#7C3AED"
                strokeWidth={2.5}
                strokeDasharray="5 5"
                dot={true}
                name="Value YoY %"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Year-over-Year Percentage Changes</h2>
          <p className="chart-description">
            Yearly changes in import volumes and ETS prices
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={yearlyData.filter(d => d.yoyVolumeChange !== null || d.yoyValueChange !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
                tickFormatter={(year) => year.toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                yAxisId="left"
                stroke="#2563EB"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'Volume YoY %', angle: -90, position: 'insideLeft' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#EF4444"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'ETS Price Change %', angle: 90, position: 'insideRight' }}
              />
              <Tooltip
                formatter={(value) => [`${value !== null ? value.toFixed(2) : 'N/A'}%`, '']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <ReferenceLine yAxisId="left" y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <ReferenceLine yAxisId="right" y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar yAxisId="left" dataKey="yoyVolumeChange" fill="#2563EB" fillOpacity={0.6} name="Volume YoY %" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgETS"
                stroke="#EF4444"
                strokeWidth={2}
                dot={true}
                name="ETS Price"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumulative Analysis */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Cumulative Import Volumes & Values</h2>
          <p className="chart-description">
            Running totals showing cumulative imports over time
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={cumulativeData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={formatDate}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                yAxisId="left"
                stroke="#2563EB"
                tickFormatter={(value) => formatValue(value)}
                label={{ value: 'Cumulative Volume (tons)', angle: -90, position: 'insideLeft' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#7C3AED"
                tickFormatter={(value) => formatValue(value)}
                label={{ value: 'Cumulative Value (EUR)', angle: 90, position: 'insideRight' }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Cumulative Volume') return [formatValue(value) + ' tons', name];
                  if (name === 'Cumulative Value') return ['€' + formatValue(value), name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="cumulativeVolume"
                fill="#2563EB"
                fillOpacity={0.4}
                stroke="#2563EB"
                strokeWidth={2}
                name="Cumulative Volume"
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="cumulativeValue"
                fill="#7C3AED"
                fillOpacity={0.4}
                stroke="#7C3AED"
                strokeWidth={2}
                name="Cumulative Value"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Unit Value Trends (EUR per Ton)</h2>
          <p className="chart-description">
            Average price per ton of imported steel over time (yearly)
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={yearlyData.filter(d => d.avgUnitValue !== null && d.avgUnitValue > 0)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
                tickFormatter={(year) => year.toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `€${value.toFixed(0)}`}
                label={{ value: 'EUR per Ton', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [`€${value.toFixed(2)}`, 'Unit Value']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="avgUnitValue"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={true}
                name="Unit Value (EUR/ton)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Delta Analysis */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Volume Deltas (Year-over-Year Changes)</h2>
          <p className="chart-description">
            Absolute changes in import volumes year-over-year
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={yearlyData.filter((d, i, arr) => i > 0 && arr[i-1].totalVolume > 0).map((d, i, arr) => {
              const prev = i > 0 ? arr[i-1] : null;
              return {
                ...d,
                volumeDelta: prev ? d.totalVolume - prev.totalVolume : null
              };
            }).filter(d => d.volumeDelta !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
                tickFormatter={(year) => year.toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
                label={{ value: 'Delta (tons)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [formatValue(value) + ' tons', 'Volume Delta']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar
                dataKey="volumeDelta"
                fill="#2563EB"
                radius={[8, 8, 0, 0]}
                name="Volume Delta"
                barSize={40}
              >
                {yearlyData.filter((d, i, arr) => i > 0 && arr[i-1].totalVolume > 0).map((d, i, arr) => {
                  const prev = i > 0 ? arr[i-1] : null;
                  return prev ? { ...d, volumeDelta: d.totalVolume - prev.totalVolume } : null;
                }).filter(d => d && d.volumeDelta !== null).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.volumeDelta >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Value Deltas (Year-over-Year Changes)</h2>
          <p className="chart-description">
            Absolute changes in import values year-over-year
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={yearlyData.filter((d, i, arr) => i > 0 && arr[i-1].totalValue > 0).map((d, i, arr) => {
              const prev = i > 0 ? arr[i-1] : null;
              return {
                ...d,
                valueDelta: prev ? d.totalValue - prev.totalValue : null
              };
            }).filter(d => d.valueDelta !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
                tickFormatter={(year) => year.toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
                label={{ value: 'Delta (EUR)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => ['€' + formatValue(value), 'Value Delta']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar
                dataKey="valueDelta"
                fill="#7C3AED"
                radius={[8, 8, 0, 0]}
                name="Value Delta"
                barSize={40}
              >
                {yearlyData.filter((d, i, arr) => i > 0 && arr[i-1].totalValue > 0).map((d, i, arr) => {
                  const prev = i > 0 ? arr[i-1] : null;
                  return prev ? { ...d, valueDelta: d.totalValue - prev.totalValue } : null;
                }).filter(d => d && d.valueDelta !== null).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.valueDelta >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Volatility & Market Share */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Import Volatility (12-Month Rolling Coefficient of Variation)</h2>
          <p className="chart-description">
            Measure of relative volatility in import volumes
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={volatilityData.filter(d => d.volatilityPct !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={formatDate}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'Coefficient of Variation (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [`${value.toFixed(2)}%`, 'Volatility']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Line
                type="monotone"
                dataKey="volatilityPct"
                stroke="#F59E0B"
                strokeWidth={2.5}
                dot={false}
                name="Volatility (%)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {topCountries && topCountries.length > 0 && (
          <div className="dashboard-grid">
            <div className="chart-container">
              <h2>EU-27 Market Share</h2>
              <p className="chart-description">
                EU-27 countries share of total imports
              </p>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={(() => {
                      const euEntry = topCountries.find(c => c.country.toUpperCase().includes('EUROPEAN UNION') || c.country.toUpperCase().includes('EU-27'));
                      const euValue = euEntry?.totalQuantity_tons || 0;
                      const extraEU = topCountries.filter(c => !c.country.toUpperCase().includes('EUROPEAN UNION') && !c.country.toUpperCase().includes('EU-27')).reduce((sum, c) => sum + c.totalQuantity_tons, 0);
                      return [
                        { name: 'EU-27', value: euValue },
                        { name: 'Extra-EU', value: extraEU }
                      ].filter(d => d.value > 0);
                    })()}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {(() => {
                      const euEntry = topCountries.find(c => c.country.toUpperCase().includes('EUROPEAN UNION') || c.country.toUpperCase().includes('EU-27'));
                      const euValue = euEntry?.totalQuantity_tons || 0;
                      const extraEU = topCountries.filter(c => !c.country.toUpperCase().includes('EUROPEAN UNION') && !c.country.toUpperCase().includes('EU-27')).reduce((sum, c) => sum + c.totalQuantity_tons, 0);
                      return [
                        { name: 'EU-27', value: euValue },
                        { name: 'Extra-EU', value: extraEU }
                      ].filter(d => d.value > 0).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#2563EB' : '#7C3AED'} />
                      ));
                    })()}
                  </Pie>
                  <Tooltip formatter={(value) => [formatValue(value) + ' tons', '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-container">
              <h2>Top Extra-EU Countries Market Share</h2>
              <p className="chart-description">
                Market share of top importing countries (excluding EU-27)
              </p>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={topCountries.filter(c => !c.country.toUpperCase().includes('EUROPEAN UNION') && !c.country.toUpperCase().includes('EU-27')).slice(0, 5).map(c => ({
                      name: c.country.length > 20 ? c.country.substring(0, 20) + '...' : c.country,
                      value: c.totalQuantity_tons
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {topCountries.filter(c => !c.country.toUpperCase().includes('EUROPEAN UNION') && !c.country.toUpperCase().includes('EU-27')).slice(0, 5).map((entry, index) => {
                      const colors = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444'];
                      return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Pie>
                  <Tooltip formatter={(value) => [formatValue(value) + ' tons', '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Annual Analysis */}
      <div className="chart-container main-chart">
        <h2>Annual Summary: Volume, Value, and Unit Prices</h2>
        <p className="chart-description">
          Yearly aggregated data showing trends in total imports, values, and average unit prices
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={yearlyData} margin={{ top: 20, right: 50, left: 60, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="year"
              stroke="#6B7280"
            />
            <YAxis
              yAxisId="left"
              stroke="#2563EB"
              tickFormatter={(value) => formatValue(value)}
              label={{ value: 'Volume (tons) / Value (EUR)', angle: -90, position: 'insideLeft' }}
              width={80}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#10B981"
              tickFormatter={(value) => `€${value.toFixed(0)}`}
              label={{ value: 'Unit Value (EUR/ton)', angle: 90, position: 'insideRight' }}
              width={80}
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === 'Total Volume') return [formatValue(value) + ' tons', name];
                if (name === 'Total Value') return ['€' + formatValue(value), name];
                if (name === 'Unit Value') return ['€' + value.toFixed(2) + '/ton', name];
                return [value, name];
              }}
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
            />
            <Legend />
            <Bar
              yAxisId="left"
              dataKey="totalVolume"
              fill="#2563EB"
              fillOpacity={0.6}
              name="Total Volume"
            />
            <Bar
              yAxisId="left"
              dataKey="totalValue"
              fill="#7C3AED"
              fillOpacity={0.6}
              name="Total Value"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="avgUnitValue"
              stroke="#10B981"
              strokeWidth={3}
              dot={{ fill: '#10B981', r: 6 }}
              name="Unit Value"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Annual Growth Rates */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Annual YoY Growth Rates</h2>
          <p className="chart-description">
            Year-over-year percentage changes in volumes and values
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={yearlyData.filter(d => d.yoyVolumeChange !== null || d.yoyValueChange !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'YoY Change (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [`${value !== null ? value.toFixed(2) : 'N/A'}%`, '']}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar dataKey="yoyVolumeChange" fill="#2563EB" radius={[8, 8, 0, 0]} name="Volume YoY %" />
              <Bar dataKey="yoyValueChange" fill="#7C3AED" radius={[8, 8, 0, 0]} name="Value YoY %" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Annual Average ETS Prices vs Unit Values</h2>
          <p className="chart-description">
            Relationship between carbon prices and steel import unit values
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={yearlyData.filter(d => d.avgETS !== null && d.avgUnitValue !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="year"
                stroke="#6B7280"
              />
              <YAxis
                yAxisId="left"
                stroke="#EF4444"
                tickFormatter={(value) => `€${value.toFixed(0)}`}
                label={{ value: 'ETS Price (€/tCO₂)', angle: -90, position: 'insideLeft' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#10B981"
                tickFormatter={(value) => `€${value.toFixed(0)}`}
                label={{ value: 'Unit Value (EUR/ton)', angle: 90, position: 'insideRight' }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'ETS Price') return [`€${value.toFixed(2)}`, name];
                  if (name === 'Unit Value') return [`€${value.toFixed(2)}/ton`, name];
                  return [value, name];
                }}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="avgETS"
                stroke="#EF4444"
                strokeWidth={3}
                dot={{ fill: '#EF4444', r: 6 }}
                name="ETS Price"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgUnitValue"
                stroke="#10B981"
                strokeWidth={3}
                dot={{ fill: '#10B981', r: 6 }}
                name="Unit Value"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="econometric-section">
        <h2>Descriptive Analysis: Summary Statistics</h2>
        <p className="section-description">
          Summary statistics for key variables used in the econometric analysis
        </p>
        {summaryStats && (
          <div className="summary-stats-grid">
            {summaryStats.imports && (
              <div className="stat-card">
                <h3>Imports (tons)</h3>
                <table className="stat-table">
                  <tbody>
                    <tr><td>Mean:</td><td>{formatValue(summaryStats.imports.mean)}</td></tr>
                    <tr><td>Median:</td><td>{formatValue(summaryStats.imports.median)}</td></tr>
                    <tr><td>Std. Dev.:</td><td>{formatValue(summaryStats.imports.stdDev)}</td></tr>
                    <tr><td>Min:</td><td>{formatValue(summaryStats.imports.min)}</td></tr>
                    <tr><td>Max:</td><td>{formatValue(summaryStats.imports.max)}</td></tr>
                    <tr><td>N:</td><td>{summaryStats.imports.n}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {summaryStats.logImports && (
              <div className="stat-card">
                <h3>LN(Imports)</h3>
                <table className="stat-table">
                  <tbody>
                    <tr><td>Mean:</td><td>{summaryStats.logImports.mean.toFixed(4)}</td></tr>
                    <tr><td>Median:</td><td>{summaryStats.logImports.median.toFixed(4)}</td></tr>
                    <tr><td>Std. Dev.:</td><td>{summaryStats.logImports.stdDev.toFixed(4)}</td></tr>
                    <tr><td>Min:</td><td>{summaryStats.logImports.min.toFixed(4)}</td></tr>
                    <tr><td>Max:</td><td>{summaryStats.logImports.max.toFixed(4)}</td></tr>
                    <tr><td>N:</td><td>{summaryStats.logImports.n}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {summaryStats.carbonPrice && (
              <div className="stat-card">
                <h3>Carbon Price (€/tCO₂)</h3>
                <table className="stat-table">
                  <tbody>
                    <tr><td>Mean:</td><td>€{summaryStats.carbonPrice.mean.toFixed(2)}</td></tr>
                    <tr><td>Median:</td><td>€{summaryStats.carbonPrice.median.toFixed(2)}</td></tr>
                    <tr><td>Std. Dev.:</td><td>€{summaryStats.carbonPrice.stdDev.toFixed(2)}</td></tr>
                    <tr><td>Min:</td><td>€{summaryStats.carbonPrice.min.toFixed(2)}</td></tr>
                    <tr><td>Max:</td><td>€{summaryStats.carbonPrice.max.toFixed(2)}</td></tr>
                    <tr><td>N:</td><td>{summaryStats.carbonPrice.n}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {summaryStats.logActivity && (
              <div className="stat-card">
                <h3>LN(Activity)</h3>
                <table className="stat-table">
                  <tbody>
                    <tr><td>Mean:</td><td>{summaryStats.logActivity.mean.toFixed(4)}</td></tr>
                    <tr><td>Median:</td><td>{summaryStats.logActivity.median.toFixed(4)}</td></tr>
                    <tr><td>Std. Dev.:</td><td>{summaryStats.logActivity.stdDev.toFixed(4)}</td></tr>
                    <tr><td>Min:</td><td>{summaryStats.logActivity.min.toFixed(4)}</td></tr>
                    <tr><td>Max:</td><td>{summaryStats.logActivity.max.toFixed(4)}</td></tr>
                    <tr><td>N:</td><td>{summaryStats.logActivity.n}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* MAIN THESIS RESULTS */}
      <div className="econometric-section main-thesis">
        <div className="section-header">
          <h2>Main Thesis Results</h2>
          <span className="section-badge">Primary Analysis</span>
        </div>
        <p className="section-description">
          Baseline econometric model estimating the relationship between EU ETS carbon prices and extra-EU steel imports, 
          controlling for industrial activity and CBAM transition period.
          {dataFrequency === 'annual' && <span className="frequency-badge"> (Annual Specification)</span>}
        </p>
        
        {baselineModel && baselineModel.feasible ? (
          <div className="regression-results">
            <div className="model-equation">
              <strong>Model:</strong> LN_IMPORTS_t = α + β₁ × CARBON_PRICE_t + β₂ × LN_ACTIVITY_t + β₃ × CBAM_DUMMY_t + ε_t
            </div>
            <div className="regression-table-container">
              <table className="regression-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Coefficient</th>
                    <th>Std. Error</th>
                    <th>t-Statistic</th>
                    <th>p-Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Intercept (α)</td>
                    <td>{baselineModel.intercept.toFixed(4)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                  </tr>
                  <tr className={baselineModel.carbonPricePValue < 0.05 ? 'significant' : ''}>
                    <td>Carbon Price (β₁)</td>
                    <td>{baselineModel.carbonPriceCoeff.toFixed(4)}</td>
                    <td>{baselineModel.carbonPriceSE.toFixed(4)}</td>
                    <td>{baselineModel.carbonPriceTStat.toFixed(3)}</td>
                    <td>{baselineModel.carbonPricePValue < 0.001 ? '<0.001' : baselineModel.carbonPricePValue.toFixed(3)}</td>
                  </tr>
                  <tr className={baselineModel.activityPValue < 0.05 ? 'significant' : ''}>
                    <td>LN(Activity) (β₂)</td>
                    <td>{baselineModel.activityCoeff.toFixed(4)}</td>
                    <td>{baselineModel.activitySE.toFixed(4)}</td>
                    <td>{baselineModel.activityTStat.toFixed(3)}</td>
                    <td>{baselineModel.activityPValue < 0.001 ? '<0.001' : baselineModel.activityPValue.toFixed(3)}</td>
                  </tr>
                  <tr className={baselineModel.cbamPValue < 0.05 ? 'significant' : ''}>
                    <td>CBAM Dummy (β₃)</td>
                    <td>{baselineModel.cbamCoeff.toFixed(4)}</td>
                    <td>{baselineModel.cbamSE.toFixed(4)}</td>
                    <td>{baselineModel.cbamTStat.toFixed(3)}</td>
                    <td>{baselineModel.cbamPValue < 0.001 ? '<0.001' : baselineModel.cbamPValue.toFixed(3)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="5">
                      <strong>R²:</strong> {baselineModel.rSquared.toFixed(3)} | 
                      <strong> Observations:</strong> {baselineModel.n}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="interpretation-box">
              <h3>Interpretation</h3>
              <p>
                <strong>Carbon Price Elasticity (β₁ = {baselineModel.carbonPriceCoeff.toFixed(4)}):</strong> 
                A €1 increase in the EU ETS carbon price is associated with a {baselineModel.carbonPriceCoeff > 0 ? 'positive' : 'negative'} 
                change of {Math.abs(baselineModel.carbonPriceCoeff * 100).toFixed(2)}% in log imports, 
                {baselineModel.carbonPricePValue < 0.05 ? 'which is statistically significant' : 'though this relationship is not statistically significant'} 
                (p = {baselineModel.carbonPricePValue < 0.001 ? '<0.001' : baselineModel.carbonPricePValue.toFixed(3)}).
                {baselineModel.carbonPriceCoeff > 0 && baselineModel.carbonPricePValue < 0.05 
                  ? ' This provides evidence of carbon leakage risk.' 
                  : baselineModel.carbonPriceCoeff <= 0 && baselineModel.carbonPricePValue < 0.05
                  ? ' This suggests no evidence of carbon leakage.'
                  : ''}
              </p>
              <p>
                <strong>Activity Coefficient (β₂ = {baselineModel.activityCoeff.toFixed(4)}):</strong> 
                A 1% increase in industrial activity is associated with a {baselineModel.activityCoeff.toFixed(2)}% 
                change in imports, {baselineModel.activityPValue < 0.05 ? 'statistically significant' : 'not statistically significant'}.
              </p>
              <p>
                <strong>CBAM Effect (β₃ = {baselineModel.cbamCoeff.toFixed(4)}):</strong> 
                During the CBAM transition period (2023-2025), imports are {baselineModel.cbamCoeff > 0 ? 'higher' : 'lower'} 
                by {Math.abs(baselineModel.cbamCoeff * 100).toFixed(2)}% on average, 
                {baselineModel.cbamPValue < 0.05 ? 'statistically significant' : 'not statistically significant'}.
              </p>
            </div>
          </div>
        ) : baselineModel && !baselineModel.feasible ? (
          <div className="methodological-warning">
            <h3>Model Estimation Not Feasible</h3>
            <p><strong>Reason:</strong> {baselineModel.reason}</p>
            <p>This model requires a minimum of 20 overlapping observations across all variables. 
            Please refer to the "Methodological Notes & Data Limitations" section for details on data availability constraints.</p>
          </div>
        ) : (
          <p>Preparing model estimation...</p>
        )}
      </div>
      
      {/* Value vs Volume Analysis */}
      <div className="chart-container main-chart">
        <h2>Import Value vs Volume Relationship</h2>
        <p className="chart-description">
          Scatter plot showing the relationship between import volumes and values, with trend line
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart data={displayData.filter(d => d.importQuantity_tons !== null && d.importValue_eur !== null && d.importQuantity_tons > 0 && d.importValue_eur > 0)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              type="number"
              dataKey="importQuantity_tons"
              name="Import Volume"
              unit=" tons"
              stroke="#6B7280"
              tickFormatter={(value) => formatValue(value)}
              label={{ value: 'Import Volume (tons)', position: 'insideBottom', offset: -5 }}
            />
            <YAxis
              yAxisId="left"
              type="number"
              dataKey="importValue_eur"
              name="Import Value"
              unit=" EUR"
              stroke="#6B7280"
              tickFormatter={(value) => formatValue(value)}
              label={{ value: 'Import Value (EUR)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(value, name) => {
                if (name === 'importQuantity_tons') return [formatValue(value) + ' tons', 'Volume'];
                if (name === 'importValue_eur') return ['€' + formatValue(value), 'Value'];
                return [value, name];
              }}
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
            />
            <Scatter yAxisId="left" name="Data Points" dataKey="importValue_eur" fill="#2563EB" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Financial & Trade Analysis */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Scatter Plot: ETS Price vs Import Volumes</h2>
          <p className="chart-description">
            Relationship between carbon prices and import volumes with regression line
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart data={scatterData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="etsPrice"
                name="ETS Price"
                unit=" €/tCO₂"
                stroke="#6B7280"
              />
              <YAxis
                yAxisId="left"
                type="number"
                dataKey="importQuantity"
                name="Import Volume"
                unit=" tons"
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value, name) => {
                  if (name === 'importQuantity') return [formatValue(value) + ' tons', 'Import Volume'];
                  if (name === 'etsPrice') return [`€${value.toFixed(2)}`, 'ETS Price'];
                  return [value, name];
                }}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Scatter yAxisId="left" name="Data Points" dataKey="importQuantity" fill="#2563EB" />
              {scatterRegression && (
                <ReferenceLine
                  yAxisId="left"
                  segment={[
                    { x: Math.min(...scatterData.map(d => d.etsPrice)), y: scatterRegression.intercept + scatterRegression.slope * Math.min(...scatterData.map(d => d.etsPrice)) },
                    { x: Math.max(...scatterData.map(d => d.etsPrice)), y: scatterRegression.intercept + scatterRegression.slope * Math.max(...scatterData.map(d => d.etsPrice)) }
                  ]}
                  stroke="#EF4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{ value: `R² = ${scatterRegression.rSquared.toFixed(3)}`, position: 'topRight' }}
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>
          {scatterRegression && (
            <div className="regression-info">
              <p><strong>Regression:</strong> Import = {scatterRegression.intercept.toFixed(2)} + {scatterRegression.slope.toFixed(4)} × ETS Price</p>
              <p><strong>R²:</strong> {scatterRegression.rSquared.toFixed(3)} | <strong>Observations:</strong> {scatterRegression.n}</p>
            </div>
          )}
        </div>
        
        <div className="chart-container">
          <h2>Rolling 12-Month Correlation</h2>
          <p className="chart-description">
            Time-varying correlation between ETS prices and import volumes
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={rollingCorr.map((c, i) => ({ 
              index: i, 
              correlation: c.correlation,
              date: displayData[c.index]?.date 
            }))} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={isDataSparse ? (date) => new Date(date).getFullYear().toString() : formatDate}
                angle={isDataSparse ? 0 : -45}
                textAnchor={isDataSparse ? "middle" : "end"}
                height={80}
                ticks={isDataSparse ? yearTicks : undefined}
                interval={isDataSparse ? 0 : "preserveStartEnd"}
              />
              <YAxis
                stroke="#6B7280"
                domain={[-1, 1]}
                tickFormatter={(value) => value.toFixed(2)}
              />
              <Tooltip
                formatter={(value) => [value.toFixed(3), 'Correlation']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="correlation"
                stroke="#7C3AED"
                strokeWidth={2.5}
                dot={false}
                name="Correlation"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Industry Production Analysis */}
      <div className="section-header" style={{ marginTop: '40px', marginBottom: '20px' }}>
        <h2>Industrial Production Analysis</h2>
        <span className="section-badge">Industry Index (2010=100)</span>
      </div>
      
      {/* Industry Index Overview - Split into 3 separate charts */}
      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div className="chart-container">
          <h2>Industrial Production Index (from 2020)</h2>
          <p className="chart-description">
            EU industrial production index over time (2010=100 baseline)
          </p>
          {industryIndexStats && (
            <div className="metrics-grid" style={{ marginBottom: '20px', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <MetricCard
                title="Mean"
                value={industryIndexStats.mean.toFixed(1)}
                subtitle={`Std Dev: ${industryIndexStats.stdDev.toFixed(1)}`}
                color="#7C3AED"
              />
              <MetricCard
                title="Median"
                value={industryIndexStats.median.toFixed(1)}
                subtitle={`IQR: ${(industryIndexStats.q3 - industryIndexStats.q1).toFixed(1)}`}
                color="#8B5CF6"
              />
              <MetricCard
                title="Range"
                value={`${industryIndexStats.min.toFixed(1)} - ${industryIndexStats.max.toFixed(1)}`}
                subtitle={`Q1: ${industryIndexStats.q1.toFixed(1)}, Q3: ${industryIndexStats.q3.toFixed(1)}`}
                color="#10B981"
              />
            </div>
          )}
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={industryIndexStats ? industryDataFrom2020.filter(d => d.industryIndex !== null).map(d => ({
              ...d,
              Mean: industryIndexStats.mean,
              Median: industryIndexStats.median
            })) : industryDataFrom2020.filter(d => d.industryIndex !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={(date) => new Date(date).getFullYear().toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                yAxisId="left"
                stroke="#10B981"
                tickFormatter={(value) => value.toFixed(0)}
                label={{ value: 'Industry Index (2010=100)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Industry Index') return [value.toFixed(2), name];
                  if (name === 'Mean') return [value.toFixed(2), name];
                  if (name === 'Median') return [value.toFixed(2), name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <ReferenceLine yAxisId="left" y={100} stroke="#6B7280" strokeDasharray="3 3" label={{ value: 'Baseline (2010=100)', position: 'right' }} />
              {industryIndexStats && (
                <>
                  <ReferenceLine yAxisId="left" y={industryIndexStats.mean} stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="2 2" />
                  <ReferenceLine yAxisId="left" y={industryIndexStats.median} stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="4 4" />
                  <ReferenceLine yAxisId="left" y={industryIndexStats.q1} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={industryIndexStats.q3} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={industryIndexStats.min} stroke="#10B981" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <ReferenceLine yAxisId="left" y={industryIndexStats.max} stroke="#EF4444" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Mean"
                    stroke="#7C3AED"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                    dot={false}
                    name="Mean"
                    connectNulls={true}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Median"
                    stroke="#8B5CF6"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Median"
                    connectNulls={true}
                  />
                </>
              )}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="industryIndex"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={false}
                name="Industry Index"
              />
              {(() => {
                const trend = calculateTrendLine(industryDataFrom2020.filter(d => d.industryIndex !== null), 'date', 'industryIndex');
                if (trend) {
                  return (
                    <ReferenceLine
                      yAxisId="left"
                      segment={[
                        { x: trend.minDate, y: trend.minY },
                        { x: trend.maxDate, y: trend.maxY }
                      ]}
                      stroke={trend.isUptrend ? '#10B981' : '#EF4444'}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      ifOverflow="extendDomain"
                    />
                  );
                }
                return null;
              })()}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Import Volumes (from 2020)</h2>
          <p className="chart-description">
            Extra-EU steel import volumes over time
          </p>
          {importVolumeStats && (
            <div className="metrics-grid" style={{ marginBottom: '20px', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <MetricCard
                title="Mean"
                value={formatValue(importVolumeStats.mean)}
                subtitle={`Std Dev: ${formatValue(importVolumeStats.stdDev)}`}
                color="#7C3AED"
              />
              <MetricCard
                title="Median"
                value={formatValue(importVolumeStats.median)}
                subtitle={`IQR: ${formatValue(importVolumeStats.q3 - importVolumeStats.q1)}`}
                color="#8B5CF6"
              />
              <MetricCard
                title="Range"
                value={`${formatValue(importVolumeStats.min)} - ${formatValue(importVolumeStats.max)}`}
                subtitle={`Q1: ${formatValue(importVolumeStats.q1)}, Q3: ${formatValue(importVolumeStats.q3)}`}
                color="#2563EB"
              />
            </div>
          )}
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={importVolumeStats ? industryDataFrom2020.filter(d => d.importQuantity_tons !== null).map(d => ({
              ...d,
              Mean: importVolumeStats.mean,
              Median: importVolumeStats.median
            })) : industryDataFrom2020.filter(d => d.importQuantity_tons !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={(date) => new Date(date).getFullYear().toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                yAxisId="left"
                stroke="#2563EB"
                tickFormatter={(value) => formatValue(value)}
                label={{ value: 'Import Volume (tons)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Import Volume') return [formatValue(value) + ' tons', name];
                  if (name === 'Mean') return [formatValue(value) + ' tons', name];
                  if (name === 'Median') return [formatValue(value) + ' tons', name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              {importVolumeStats && (
                <>
                  <ReferenceLine yAxisId="left" y={importVolumeStats.mean} stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="2 2" />
                  <ReferenceLine yAxisId="left" y={importVolumeStats.median} stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="4 4" />
                  <ReferenceLine yAxisId="left" y={importVolumeStats.q1} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={importVolumeStats.q3} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={importVolumeStats.min} stroke="#10B981" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <ReferenceLine yAxisId="left" y={importVolumeStats.max} stroke="#EF4444" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Mean"
                    stroke="#7C3AED"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                    dot={false}
                    name="Mean"
                    connectNulls={true}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Median"
                    stroke="#8B5CF6"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Median"
                    connectNulls={true}
                  />
                </>
              )}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="importQuantity_tons"
                stroke="#2563EB"
                strokeWidth={2.5}
                dot={false}
                name="Import Volume"
              />
              {(() => {
                const data = industryDataFrom2020.filter(d => d.importQuantity_tons !== null);
                const trend = calculateTrendLine(data, 'date', 'importQuantity_tons');
                if (trend) {
                  return (
                    <ReferenceLine
                      yAxisId="left"
                      segment={[
                        { x: trend.minDate, y: trend.minY },
                        { x: trend.maxDate, y: trend.maxY }
                      ]}
                      stroke={trend.isUptrend ? '#10B981' : '#EF4444'}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      ifOverflow="extendDomain"
                    />
                  );
                }
                return null;
              })()}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>ETS Prices (from 2020)</h2>
          <p className="chart-description">
            EU ETS carbon pricing over time
          </p>
          {etsPriceStats && (
            <div className="metrics-grid" style={{ marginBottom: '20px', gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <MetricCard
                title="Mean"
                value={`€${etsPriceStats.mean.toFixed(2)}`}
                subtitle={`Std Dev: €${etsPriceStats.stdDev.toFixed(2)}`}
                color="#7C3AED"
              />
              <MetricCard
                title="Median"
                value={`€${etsPriceStats.median.toFixed(2)}`}
                subtitle={`IQR: €${(etsPriceStats.q3 - etsPriceStats.q1).toFixed(2)}`}
                color="#8B5CF6"
              />
              <MetricCard
                title="Range"
                value={`€${etsPriceStats.min.toFixed(2)} - €${etsPriceStats.max.toFixed(2)}`}
                subtitle={`Q1: €${etsPriceStats.q1.toFixed(2)}, Q3: €${etsPriceStats.q3.toFixed(2)}`}
                color="#EF4444"
              />
            </div>
          )}
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={etsPriceStats ? industryDataFrom2020.filter(d => d.etsPrice !== null).map(d => ({
              ...d,
              Mean: etsPriceStats.mean,
              Median: etsPriceStats.median
            })) : industryDataFrom2020.filter(d => d.etsPrice !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={(date) => new Date(date).getFullYear().toString()}
                angle={0}
                textAnchor="middle"
                height={80}
              />
              <YAxis
                yAxisId="left"
                stroke="#EF4444"
                tickFormatter={(value) => `€${value.toFixed(0)}`}
                label={{ value: 'ETS Price (€/tCO₂)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'ETS Price') return [`€${value.toFixed(2)}`, name];
                  if (name === 'Mean') return [`€${value.toFixed(2)}`, name];
                  if (name === 'Median') return [`€${value.toFixed(2)}`, name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              {etsPriceStats && (
                <>
                  <ReferenceLine yAxisId="left" y={etsPriceStats.mean} stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="2 2" />
                  <ReferenceLine yAxisId="left" y={etsPriceStats.median} stroke="#8B5CF6" strokeWidth={1.5} strokeDasharray="4 4" />
                  <ReferenceLine yAxisId="left" y={etsPriceStats.q1} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={etsPriceStats.q3} stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
                  <ReferenceLine yAxisId="left" y={etsPriceStats.min} stroke="#10B981" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <ReferenceLine yAxisId="left" y={etsPriceStats.max} stroke="#EF4444" strokeWidth={1} strokeDasharray="1 1" opacity={0.4} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Mean"
                    stroke="#7C3AED"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                    dot={false}
                    name="Mean"
                    connectNulls={true}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="Median"
                    stroke="#8B5CF6"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Median"
                    connectNulls={true}
                  />
                </>
              )}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="etsPrice"
                stroke="#EF4444"
                strokeWidth={2.5}
                dot={false}
                name="ETS Price"
              />
              {(() => {
                const data = industryDataFrom2020.filter(d => d.etsPrice !== null);
                const trend = calculateTrendLine(data, 'date', 'etsPrice');
                if (trend) {
                  return (
                    <ReferenceLine
                      yAxisId="left"
                      segment={[
                        { x: trend.minDate, y: trend.minY },
                        { x: trend.maxDate, y: trend.maxY }
                      ]}
                      stroke={trend.isUptrend ? '#10B981' : '#EF4444'}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      ifOverflow="extendDomain"
                    />
                  );
                }
                return null;
              })()}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Industry Growth Analysis */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Industrial Production Index Trends</h2>
          <p className="chart-description">
            EU industrial production index over time (2010=100 baseline)
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={industryGrowthData.filter(d => d.industryIndex !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={isDataSparse ? (date) => new Date(date).getFullYear().toString() : formatDate}
                angle={isDataSparse ? 0 : -45}
                textAnchor={isDataSparse ? "middle" : "end"}
                height={80}
                ticks={isDataSparse ? yearTicks : undefined}
                interval={isDataSparse ? 0 : "preserveStartEnd"}
              />
              <YAxis
                stroke="#10B981"
                tickFormatter={(value) => value.toFixed(0)}
                label={{ value: 'Index (2010=100)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [value.toFixed(2), 'Industry Index']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={100} stroke="#6B7280" strokeDasharray="3 3" label={{ value: 'Baseline (2010=100)', position: 'right' }} />
              <Line
                type="monotone"
                dataKey="industryIndex"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={false}
                name="Industry Index"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Industrial Production Growth Rates</h2>
          <p className="chart-description">
            Month-over-month and year-over-year growth rates in industrial production
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={industryGrowthData.filter(d => d.industryGrowth !== null || d.industryGrowthYoY !== null)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="date"
                stroke="#6B7280"
                tickFormatter={isDataSparse ? (date) => new Date(date).getFullYear().toString() : formatDate}
                angle={isDataSparse ? 0 : -45}
                textAnchor={isDataSparse ? "middle" : "end"}
                height={80}
                ticks={isDataSparse ? yearTicks : undefined}
                interval={isDataSparse ? 0 : "preserveStartEnd"}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value.toFixed(1)}%`}
                label={{ value: 'Growth Rate (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value) => [`${value !== null ? value.toFixed(2) : 'N/A'}%`, '']}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar dataKey="industryGrowth" fill="#10B981" fillOpacity={0.6} name="MoM Growth %">
                {industryGrowthData.filter(d => d.industryGrowth !== null).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.industryGrowth >= 0 ? '#10B981' : '#EF4444'} />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="industryGrowthYoY"
                stroke="#059669"
                strokeWidth={2.5}
                strokeDasharray="5 5"
                dot={(props) => {
                  const value = props.payload?.industryGrowthYoY;
                  return <circle key={`dot-${props.index}`} cx={props.cx} cy={props.cy} r={4} fill={value >= 0 ? '#10B981' : '#EF4444'} />;
                }}
                name="YoY Growth %"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Industry Correlation Analysis */}
      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Industry Index vs Import Volumes (from 2020)</h2>
          <p className="chart-description">
            Scatter plot showing relationship between industrial production and import volumes
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart data={industryImportScatterFrom2020} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="industryIndex"
                name="Industry Index"
                unit=" (2010=100)"
                stroke="#10B981"
                tickFormatter={(value) => value.toFixed(0)}
              />
              <YAxis
                yAxisId="left"
                type="number"
                dataKey="importQuantity"
                name="Import Volume"
                unit=" tons"
                stroke="#2563EB"
                tickFormatter={(value) => formatValue(value)}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value, name) => {
                  if (name === 'Industry Index') return [value.toFixed(2), name];
                  if (name === 'Import Volume') return [formatValue(value) + ' tons', name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Scatter yAxisId="left" name="Data Points" dataKey="importQuantity" fill="#2563EB" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Industry Index vs ETS Price (from 2020)</h2>
          <p className="chart-description">
            Relationship between industrial production and carbon pricing
          </p>
          <ResponsiveContainer width="100%" height={350}>
            <ScatterChart data={industryETSScatterFrom2020} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                dataKey="industryIndex"
                name="Industry Index"
                unit=" (2010=100)"
                stroke="#10B981"
                tickFormatter={(value) => value.toFixed(0)}
              />
              <YAxis
                yAxisId="left"
                type="number"
                dataKey="etsPrice"
                name="ETS Price"
                unit=" €/tCO₂"
                stroke="#EF4444"
                tickFormatter={(value) => `€${value.toFixed(0)}`}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value, name) => {
                  if (name === 'Industry Index') return [value.toFixed(2), name];
                  if (name === 'ETS Price') return [`€${value.toFixed(2)}`, name];
                  return [value, name];
                }}
                labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Scatter yAxisId="left" name="Data Points" dataKey="etsPrice" fill="#EF4444" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Industry vs Import Unit Values */}
      <div className="chart-container main-chart">
        <h2>Industrial Production vs Import Unit Values</h2>
        <p className="chart-description">
          Relationship between industrial production index and average import prices (EUR per ton)
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={displayData.filter(d => d.industryIndex !== null && d.importUnitValue !== null && d.importUnitValue > 0)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              tickFormatter={isDataSparse ? (date) => new Date(date).getFullYear().toString() : formatDate}
              angle={isDataSparse ? 0 : -45}
              textAnchor={isDataSparse ? "middle" : "end"}
              height={80}
              ticks={isDataSparse ? yearTicks : undefined}
              interval={isDataSparse ? 0 : "preserveStartEnd"}
            />
            <YAxis
              yAxisId="left"
              stroke="#10B981"
              tickFormatter={(value) => value.toFixed(0)}
              label={{ value: 'Industry Index (2010=100)', angle: -90, position: 'insideLeft' }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#7C3AED"
              tickFormatter={(value) => `€${value.toFixed(0)}`}
              label={{ value: 'Unit Value (EUR/ton)', angle: 90, position: 'insideRight' }}
            />
            <Tooltip
              formatter={(value, name) => {
                if (name === 'Industry Index') return [value.toFixed(2), name];
                if (name === 'Unit Value') return [`€${value.toFixed(2)}`, name];
                return [value, name];
              }}
              labelFormatter={(label) => label ? (typeof label === 'number' ? label.toString() : new Date(label).getFullYear().toString()) : ''}
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
            />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="industryIndex"
              stroke="#10B981"
              strokeWidth={2.5}
              dot={false}
              name="Industry Index"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="importUnitValue"
              stroke="#7C3AED"
              strokeWidth={2.5}
              strokeDasharray="5 5"
              dot={false}
              name="Unit Value"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Country Breakdown */}
      <div className="chart-container main-chart">
        <h2>Top Extra-EU Steel Suppliers by Import Volume</h2>
        <p className="chart-description">
          Breakdown of import volumes by partner country
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={topCountries.slice(0, 10)} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="country"
              stroke="#6B7280"
              angle={-45}
              textAnchor="end"
              height={100}
              style={{ fontSize: '11px' }}
            />
            <YAxis
              stroke="#6B7280"
              tickFormatter={(value) => formatValue(value)}
            />
            <Tooltip
              formatter={(value) => [formatValue(value) + ' tons', 'Import Volume']}
              contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
            />
            <Bar dataKey="totalQuantity_tons" fill="#2563EB" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      {/* SUPPORTING / ROBUSTNESS ANALYSIS */}
      <div className="econometric-section supporting-analysis">
        <div className="section-header">
          <h2>Supporting / Robustness Analysis</h2>
          <span className="section-badge">Robustness Checks</span>
        </div>
        
        {/* Dynamic Extension: Lagged Effects */}
        <div className="model-subsection">
          <h3>Dynamic Extension: Lagged Effects (K=6 months)</h3>
          <p className="section-description">
            Model: LN_IMPORTS_t = α + Σ(β_k × CARBON_PRICE_{'{t-k}'}) + γ × LN_ACTIVITY_t + ε_t (k=0 to 6)
          </p>
          {laggedModel6 && laggedModel6.feasible ? (
            <div className="regression-results">
              <div className="regression-table-container">
                <table className="regression-table">
                  <thead>
                    <tr>
                      <th>Lag (k)</th>
                      <th>Coefficient (β_k)</th>
                      <th>Std. Error</th>
                      <th>t-Statistic</th>
                      <th>p-Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laggedModel6.lagCoefficients.map((lag, idx) => (
                      <tr key={idx} className={lag.pValue < 0.05 ? 'significant' : ''}>
                        <td>{lag.lag === 0 ? 'Current (t)' : `Lag ${lag.lag} (t-${lag.lag})`}</td>
                        <td>{lag.coefficient.toFixed(4)}</td>
                        <td>{lag.se.toFixed(4)}</td>
                        <td>{lag.tStat.toFixed(3)}</td>
                        <td>{lag.pValue < 0.001 ? '<0.001' : lag.pValue.toFixed(3)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>LN(Activity) (γ)</td>
                      <td>{laggedModel6.activityCoeff.toFixed(4)}</td>
                      <td>{laggedModel6.activitySE.toFixed(4)}</td>
                      <td>{laggedModel6.activityTStat.toFixed(3)}</td>
                      <td>{laggedModel6.activityPValue < 0.001 ? '<0.001' : laggedModel6.activityPValue.toFixed(3)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5">
                        <strong>R²:</strong> {laggedModel6.rSquared.toFixed(3)} | 
                        <strong> Observations:</strong> {laggedModel6.n}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="chart-container">
                <h4>Lagged Effects Visualization (K=6)</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={laggedModel6.lagCoefficients} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="lag"
                      stroke="#6B7280"
                      tickFormatter={(value) => value === 0 ? 't' : `t-${value}`}
                    />
                    <YAxis
                      stroke="#6B7280"
                      tickFormatter={(value) => value.toFixed(3)}
                    />
                    <Tooltip
                      formatter={(value) => [value.toFixed(4), 'Coefficient']}
                      contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                    />
                    <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
                    <Bar dataKey="coefficient" fill="#7C3AED" radius={[8, 8, 0, 0]}>
                      {laggedModel6.lagCoefficients.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.pValue < 0.05 ? '#EF4444' : '#7C3AED'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="interpretation-box">
                <h4>Interpretation</h4>
                <p>
                  The lagged effects model reveals which time periods show statistically significant carbon price impacts. 
                  Significant lags indicate delayed carbon leakage effects, suggesting that trade adjustments occur over multiple months 
                  rather than immediately.
                </p>
                <p>
                  Significant lags: {laggedModel6 && laggedModel6.lagCoefficients ? laggedModel6.lagCoefficients.filter(l => l.pValue < 0.05).map(l => l.lag === 0 ? 'Current' : `Lag ${l.lag}`).join(', ') || 'None' : 'None'}
                </p>
              </div>
            </div>
          ) : laggedModel6 && !laggedModel6.feasible ? (
            <div className="methodological-warning">
              <h4>Lagged Model (K=6) Not Feasible</h4>
              <p><strong>Reason:</strong> {laggedModel6.reason}</p>
              <p>Long lag structures require substantial sample sizes. With {preparedData?.data.length || 'limited'} {dataFrequency} observations, 
              shorter lag specifications or annual aggregation may be more appropriate. See methodological notes for details.</p>
            </div>
          ) : (
            <p>Evaluating model feasibility...</p>
          )}
        </div>
        
        {/* Dynamic Extension: Lagged Effects K=12 */}
        <div className="model-subsection">
          <h3>Dynamic Extension: Lagged Effects (K=12 months)</h3>
          <p className="section-description">
            Model: LN_IMPORTS_t = α + Σ(β_k × CARBON_PRICE_{'{t-k}'}) + γ × LN_ACTIVITY_t + ε_t (k=0 to 12)
          </p>
          {laggedModel12 && laggedModel12.feasible ? (
            <div className="regression-results">
              <div className="regression-table-container">
                <table className="regression-table">
                  <thead>
                    <tr>
                      <th>Lag (k)</th>
                      <th>Coefficient (β_k)</th>
                      <th>Std. Error</th>
                      <th>t-Statistic</th>
                      <th>p-Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laggedModel12.lagCoefficients.map((lag, idx) => (
                      <tr key={idx} className={lag.pValue < 0.05 ? 'significant' : ''}>
                        <td>{lag.lag === 0 ? 'Current (t)' : `Lag ${lag.lag} (t-${lag.lag})`}</td>
                        <td>{lag.coefficient.toFixed(4)}</td>
                        <td>{lag.se.toFixed(4)}</td>
                        <td>{lag.tStat.toFixed(3)}</td>
                        <td>{lag.pValue < 0.001 ? '<0.001' : lag.pValue.toFixed(3)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>LN(Activity) (γ)</td>
                      <td>{laggedModel12.activityCoeff.toFixed(4)}</td>
                      <td>{laggedModel12.activitySE.toFixed(4)}</td>
                      <td>{laggedModel12.activityTStat.toFixed(3)}</td>
                      <td>{laggedModel12.activityPValue < 0.001 ? '<0.001' : laggedModel12.activityPValue.toFixed(3)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5">
                        <strong>R²:</strong> {laggedModel12.rSquared.toFixed(3)} | 
                        <strong> Observations:</strong> {laggedModel12.n}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="chart-container">
                <h4>Lagged Effects Visualization (K=12)</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={laggedModel12.lagCoefficients} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="lag"
                      stroke="#6B7280"
                      tickFormatter={(value) => value === 0 ? 't' : `t-${value}`}
                    />
                    <YAxis
                      stroke="#6B7280"
                      tickFormatter={(value) => value.toFixed(3)}
                    />
                    <Tooltip
                      formatter={(value) => [value.toFixed(4), 'Coefficient']}
                      contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                    />
                    <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
                    <Bar dataKey="coefficient" fill="#7C3AED" radius={[8, 8, 0, 0]}>
                      {laggedModel12.lagCoefficients.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.pValue < 0.05 ? '#EF4444' : '#7C3AED'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="interpretation-box">
                <h4>Interpretation</h4>
                <p>
                  Extended lag structure (12 months) captures longer-term adjustment patterns. 
                  Significant lags: {laggedModel12 && laggedModel12.lagCoefficients ? laggedModel12.lagCoefficients.filter(l => l.pValue < 0.05).map(l => l.lag === 0 ? 'Current' : `Lag ${l.lag}`).join(', ') || 'None' : 'None'}
                </p>
              </div>
            </div>
          ) : laggedModel12 && !laggedModel12.feasible ? (
            <div className="methodological-warning">
              <h4>Lagged Model (K=12) Not Feasible</h4>
              <p><strong>Reason:</strong> {laggedModel12.reason}</p>
              <p>Extended lag structures (K≥6 months) are statistically infeasible with the available sample size. 
              The analysis focuses on short-run dynamics (K≤3) which are more robust given data constraints.</p>
            </div>
          ) : (
            <p>Evaluating model feasibility...</p>
          )}
        </div>
        
        {/* CBAM Interaction Model */}
        <div className="model-subsection">
          <h3>CBAM Interaction Model</h3>
          <p className="section-description">
            Model: LN_IMPORTS_t = α + β₁ × CARBON_PRICE_t + β₂ × (CARBON_PRICE_t × CBAM_DUMMY_t) + β₃ × LN_ACTIVITY_t + ε_t
          </p>
          {cbamInteractionModel && cbamInteractionModel.feasible ? (
            <div className="regression-results">
              <div className="regression-table-container">
                <table className="regression-table">
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Coefficient</th>
                      <th>Std. Error</th>
                      <th>t-Statistic</th>
                      <th>p-Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Intercept (α)</td>
                      <td>{cbamInteractionModel.intercept.toFixed(4)}</td>
                      <td>-</td>
                      <td>-</td>
                      <td>-</td>
                    </tr>
                    <tr className={cbamInteractionModel.carbonPricePValue < 0.05 ? 'significant' : ''}>
                      <td>Carbon Price (β₁)</td>
                      <td>{cbamInteractionModel.carbonPriceCoeff.toFixed(4)}</td>
                      <td>{cbamInteractionModel.carbonPriceSE.toFixed(4)}</td>
                      <td>{cbamInteractionModel.carbonPriceTStat.toFixed(3)}</td>
                      <td>{cbamInteractionModel.carbonPricePValue < 0.001 ? '<0.001' : cbamInteractionModel.carbonPricePValue.toFixed(3)}</td>
                    </tr>
                    <tr className={cbamInteractionModel.cbamInteractionPValue < 0.05 ? 'significant' : ''}>
                      <td>Carbon Price × CBAM (β₂)</td>
                      <td>{cbamInteractionModel.cbamInteractionCoeff.toFixed(4)}</td>
                      <td>{cbamInteractionModel.cbamInteractionSE.toFixed(4)}</td>
                      <td>{cbamInteractionModel.cbamInteractionTStat.toFixed(3)}</td>
                      <td>{cbamInteractionModel.cbamInteractionPValue < 0.001 ? '<0.001' : cbamInteractionModel.cbamInteractionPValue.toFixed(3)}</td>
                    </tr>
                    <tr className={cbamInteractionModel.activityPValue < 0.05 ? 'significant' : ''}>
                      <td>LN(Activity) (β₃)</td>
                      <td>{cbamInteractionModel.activityCoeff.toFixed(4)}</td>
                      <td>{cbamInteractionModel.activitySE.toFixed(4)}</td>
                      <td>{cbamInteractionModel.activityTStat.toFixed(3)}</td>
                      <td>{cbamInteractionModel.activityPValue < 0.001 ? '<0.001' : cbamInteractionModel.activityPValue.toFixed(3)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5">
                        <strong>R²:</strong> {cbamInteractionModel.rSquared.toFixed(3)} | 
                        <strong> Observations:</strong> {cbamInteractionModel.n}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="interpretation-box">
                <h4>Interpretation</h4>
                <p>
                  <strong>Pre-CBAM Carbon Price Effect (β₁ = {cbamInteractionModel.carbonPriceCoeff.toFixed(4)}):</strong> 
                  Before the CBAM transition period, a €1 increase in carbon price is associated with a 
                  {cbamInteractionModel.carbonPriceCoeff > 0 ? ' positive' : ' negative'} change of 
                  {Math.abs(cbamInteractionModel.carbonPriceCoeff * 100).toFixed(2)}% in log imports.
                </p>
                <p>
                  <strong>CBAM Interaction Effect (β₂ = {cbamInteractionModel.cbamInteractionCoeff.toFixed(4)}):</strong> 
                  During the CBAM transition period (2023-2025), the carbon price effect changes by 
                  {cbamInteractionModel.cbamInteractionCoeff > 0 ? ' an additional' : ' a reduction of'} 
                  {Math.abs(cbamInteractionModel.cbamInteractionCoeff * 100).toFixed(2)}% per €1 increase in carbon price.
                  {cbamInteractionModel.cbamInteractionPValue < 0.05 
                    ? ' This change is statistically significant, suggesting CBAM has altered the carbon leakage relationship.' 
                    : ' This change is not statistically significant.'}
                </p>
                <p>
                  <strong>Total Effect During CBAM:</strong> β₁ + β₂ = {(cbamInteractionModel.carbonPriceCoeff + cbamInteractionModel.cbamInteractionCoeff).toFixed(4)}
                </p>
              </div>
            </div>
          ) : cbamInteractionModel && !cbamInteractionModel.feasible ? (
            <div className="methodological-warning">
              <h4>CBAM Interaction Model: Exploratory Analysis</h4>
              <p><strong>Reason:</strong> {cbamInteractionModel.reason}</p>
              <p>Due to limited post-CBAM implementation observations ({cbamInteractionModel.postCBAM || 0} observations), 
              a formal interaction regression is not statistically valid. Instead, we present descriptive before/after comparisons below.</p>
              
              {cbamDescriptive && (
                <div className="cbam-descriptive">
                  <h5>Pre-CBAM vs Post-CBAM Descriptive Comparison</h5>
                  <table className="stat-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>N</th>
                        <th>Avg Imports (tons)</th>
                        <th>Avg ETS Price (€/tCO₂)</th>
                        <th>% Change (Imports)</th>
                        <th>% Change (Price)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Pre-CBAM (&lt;2023)</td>
                        <td>{cbamDescriptive.preCBAM.n}</td>
                        <td>{formatValue(cbamDescriptive.preCBAM.avgImports)}</td>
                        <td>€{cbamDescriptive.preCBAM.avgPrice.toFixed(2)}</td>
                        <td>-</td>
                        <td>-</td>
                      </tr>
                      <tr>
                        <td>Post-CBAM (2023-2025)</td>
                        <td>{cbamDescriptive.postCBAM.n}</td>
                        <td>{formatValue(cbamDescriptive.postCBAM.avgImports)}</td>
                        <td>€{cbamDescriptive.postCBAM.avgPrice.toFixed(2)}</td>
                        <td>{cbamDescriptive.importChange >= 0 ? '+' : ''}{cbamDescriptive.importChange.toFixed(2)}%</td>
                        <td>{cbamDescriptive.priceChange >= 0 ? '+' : ''}{cbamDescriptive.priceChange.toFixed(2)}%</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="methodological-note">
                    <strong>Note:</strong> These comparisons are exploratory and do not establish causal relationships. 
                    Multiple confounding factors may drive observed differences.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p>Evaluating model feasibility...</p>
          )}
        </div>
      </div>
      
      {/* Legacy Econometric Results (for backward compatibility) */}
      <div className="econometric-section">
        <h2>Legacy Econometric Analysis Results</h2>
        <p className="section-description">
          Log-log regression estimates of ETS price elasticity on extra-EU steel imports, controlling for industrial production
        </p>
        
        {regressionResults.length > 0 ? (
          <>
            <div className="regression-table-container">
              <table className="regression-table">
                <thead>
                  <tr>
                    <th>Lag</th>
                    <th>Elasticity</th>
                    <th>Std. Error</th>
                    <th>t-Statistic</th>
                    <th>p-Value</th>
                    <th>R²</th>
                    <th>Industry Coeff.</th>
                    <th>N</th>
                  </tr>
                </thead>
                <tbody>
                  {regressionResults.map((result, idx) => (
                    <tr key={idx} className={result.pValue < 0.05 ? 'significant' : ''}>
                      <td>{result.lag === 0 ? 'Current' : `Lag ${result.lag}`}</td>
                      <td>{result.elasticity.toFixed(4)}</td>
                      <td>{result.se.toFixed(4)}</td>
                      <td>{result.tStat.toFixed(3)}</td>
                      <td>{result.pValue < 0.001 ? '<0.001' : result.pValue.toFixed(3)}</td>
                      <td>{result.rSquared.toFixed(3)}</td>
                      <td>{result.industryCoeff.toFixed(4)}</td>
                      <td>{result.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="chart-container">
              <h3>Lagged ETS Price Effects</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={regressionResults} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis
                    dataKey="lag"
                    stroke="#6B7280"
                    tickFormatter={(value) => value === 0 ? 'Current' : `Lag ${value}`}
                  />
                  <YAxis
                    stroke="#6B7280"
                    tickFormatter={(value) => value.toFixed(3)}
                  />
                  <Tooltip
                    formatter={(value) => [value.toFixed(4), 'Elasticity']}
                    contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                  />
                  <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
                  <Bar dataKey="elasticity" fill="#7C3AED" radius={[8, 8, 0, 0]}>
                    {regressionResults.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pValue < 0.05 ? '#EF4444' : '#7C3AED'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="interpretation-box">
              <h3>Interpretation</h3>
              {regressionResults.length > 0 && (
                <div className="interpretation-content">
                  <p>
                    <strong>Elasticity Estimate:</strong> The coefficient of {regressionResults[0].elasticity.toFixed(4)} indicates that a 1% increase in EU ETS carbon prices is associated with a {Math.abs(regressionResults[0].elasticity * 100).toFixed(2)}% change in extra-EU steel import volumes, 
                    {regressionResults[0].elasticity > 0 ? ' suggesting potential carbon leakage risk.' : ' indicating no evidence of carbon leakage.'}
                  </p>
                  {regressionResults[0].pValue < 0.05 ? (
                    <p className="significant-result">
                      <strong>Statistical Significance:</strong> The relationship is statistically significant at the 5% level (p = {regressionResults[0].pValue < 0.001 ? '<0.001' : regressionResults[0].pValue.toFixed(3)}), 
                      providing robust evidence of a relationship between ETS prices and import volumes.
                    </p>
                  ) : (
                    <p className="insignificant-result">
                      <strong>Statistical Significance:</strong> The relationship is not statistically significant (p = {regressionResults[0].pValue.toFixed(3)}), 
                      suggesting limited evidence of a direct causal relationship in the current period.
                    </p>
                  )}
                  {regressionResults.length > 1 && (
                    <p>
                      <strong>Lagged Effects:</strong> The analysis of lagged ETS price effects reveals {regressionResults.slice(1).some(r => r.pValue < 0.05) ? 'significant delayed impacts' : 'limited delayed impacts'}, 
                      indicating that carbon price changes may take time to affect trade patterns.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <p>Insufficient data for econometric analysis. Please ensure all datasets have overlapping time periods.</p>
        )}
      </div>
      
      {/* Methodological Notes & Data Limitations */}
      <div className="econometric-section">
        <h2>Methodological Notes & Data Limitations</h2>
        <div className="methodological-content">
          <h3>Data Availability and Time Alignment</h3>
          {preparedData && (
            <div className="data-info">
              <p><strong>Data Frequency:</strong> {preparedData.frequency === 'annual' ? 'Annual (aggregated from monthly due to limited overlap)' : 'Monthly'}</p>
              {preparedData.overlap && (
                <p><strong>Overlapping Period:</strong> {new Date(preparedData.overlap.start).getFullYear()} to {new Date(preparedData.overlap.end).getFullYear()} 
                ({preparedData.overlap.count} {preparedData.frequency} observations)</p>
              )}
              <p>{preparedData.message}</p>
            </div>
          )}
          
          <h3>Model Specifications and Adjustments</h3>
          <ul className="methodological-list">
            {methodologicalNotes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
          
          <h3>Econometric Safeguards</h3>
          <ul className="methodological-list">
            <li><strong>Minimum Sample Size:</strong> OLS regression requires N ≥ 20 observations. Lagged models require N ≥ (10 + number of parameters).</li>
            <li><strong>Lag Structure Selection:</strong> Maximum feasible lag length is determined by available sample size. Long lag structures (K≥6) are disabled when statistically infeasible.</li>
            <li><strong>CBAM Interaction Model:</strong> Requires ≥10 pre-CBAM and ≥5 post-CBAM observations. When insufficient, descriptive comparisons are presented instead.</li>
            <li><strong>Frequency Adjustment:</strong> When monthly overlap is limited (&lt;20 observations), data is automatically aggregated to annual frequency to ensure statistical validity.</li>
          </ul>
          
          <h3>Interpretation Caveats</h3>
          <ul className="methodological-list">
            <li>Results reflect <strong>short-run dynamics</strong> rather than long-run causal relationships due to data limitations.</li>
            <li>CBAM-related findings are <strong>exploratory</strong> given limited post-implementation data (2023-2025).</li>
            <li>Robustness is demonstrated through <strong>alternative specifications</strong> (baseline, lagged, interaction) rather than extended lag structures.</li>
            <li>Correlation does not imply causation. Multiple confounding factors (global demand, exchange rates, supply chain disruptions) may influence observed relationships.</li>
          </ul>
        </div>
      </div>
      
      {/* Narrative Interpretation */}
      <div className="narrative-section">
        <h2>Analytical Commentary</h2>
        <div className="narrative-content">
          <h3>EU ETS Tightening and Carbon Cost Pass-Through</h3>
          <p>
            The European Union Emissions Trading System (EU ETS) has undergone significant tightening in recent years, 
            with carbon allowance prices reaching unprecedented levels. This price escalation reflects both policy-driven 
            supply constraints and market expectations of continued regulatory stringency. For energy-intensive industries 
            such as iron and steel production, these carbon costs represent a material component of production costs, 
            potentially affecting competitiveness relative to producers in jurisdictions with lower or no carbon pricing.
          </p>
          
          <h3>Trade Response Patterns in Iron and Steel</h3>
          <p>
            The analysis of extra-EU imports of iron and steel products (HS 72) reveals {kpis?.importYoY > 0 ? 'an upward trend' : 'variability'} in import volumes 
            {kpis?.importYoY > 0 ? `, with year-over-year growth of ${kpis.importYoY.toFixed(2)}%` : ''}. 
            {kpis?.topSupplier && `The primary source of extra-EU imports is ${kpis.topSupplier.country}, accounting for ${formatValue(kpis.topSupplier.totalQuantity_tons)} metric tons. `}
            The relationship between ETS price movements and import volumes exhibits {scatterRegression && scatterRegression.rSquared > 0.1 ? 'a measurable correlation' : 'limited correlation'} 
            (R² = {scatterRegression ? scatterRegression.rSquared.toFixed(3) : 'N/A'}), suggesting that carbon pricing may influence trade flows, 
            though other factors such as global demand, exchange rates, and industrial production also play significant roles.
          </p>
          
          <h3>Evidence Supporting or Rejecting Carbon Leakage</h3>
          <p>
            {baselineModel && baselineModel.feasible ? (
              baselineModel.carbonPriceCoeff > 0 ? (
                <>
                  The baseline econometric analysis provides {baselineModel.carbonPricePValue < 0.05 ? 'statistically significant' : 'preliminary'} evidence of a positive relationship 
                  (coefficient = {baselineModel.carbonPriceCoeff.toFixed(4)}) between ETS prices and import volumes, which could indicate carbon leakage risk. 
                  However, this relationship must be interpreted cautiously as reflecting <strong>short-run dynamics</strong> rather than long-run causality, 
                  given data limitations. Correlation does not necessarily imply causation, and multiple confounding factors (global demand, exchange rates, 
                  supply chain disruptions) may drive both carbon prices and trade patterns.
                </>
              ) : (
                <>
                  The baseline econometric analysis {baselineModel.carbonPricePValue < 0.05 
                    ? 'does not provide evidence of carbon leakage' 
                    : 'yields inconclusive results regarding carbon leakage'}, 
                  with an estimated coefficient of {baselineModel.carbonPriceCoeff.toFixed(4)}. 
                  This suggests that either (1) carbon leakage is not occurring at a measurable scale in the short run, 
                  (2) other factors are dominating trade patterns, or (3) the effects are too small or delayed to be detected 
                  with the available {dataFrequency} data.
                </>
              )
            ) : (
              <>
                Formal econometric analysis is not feasible with the current data availability. 
                Descriptive analysis suggests {cbamDescriptive && cbamDescriptive.importChange > 0 
                  ? 'an increase' 
                  : 'variability'} in import volumes, 
                but causal inference regarding carbon leakage requires additional observations and robust identification strategies.
              </>
            )}
          </p>
          
          <h3>Policy Relevance for EU ETS and CBAM</h3>
          <p>
            These findings have direct relevance for the design and implementation of the Carbon Border Adjustment Mechanism (CBAM). 
            {baselineModel && baselineModel.feasible && baselineModel.carbonPriceCoeff > 0 && baselineModel.carbonPricePValue < 0.05 ? (
              <>
                The positive and statistically significant relationship between ETS prices and import volumes provides <strong>exploratory evidence</strong> 
                supporting the rationale for CBAM implementation as a preventive measure. However, given data limitations and the short-run nature 
                of the analysis, these results should be interpreted as indicative rather than definitive.
              </>
            ) : (
              <>
                The analysis does not provide strong evidence of existing carbon leakage, suggesting that CBAM may serve primarily as a 
                <strong> preventive measure</strong> rather than addressing current leakage. However, this conclusion is tempered by data limitations 
                and the exploratory nature of post-CBAM observations.
              </>
            )}
            Continued monitoring of trade patterns as CBAM phases in will be essential to assess its effectiveness in preventing carbon leakage 
            while maintaining fair competition in the global steel market. Future research with extended time series and robust identification strategies 
            will be necessary to establish causal relationships.
          </p>
        </div>
      </div>
    </div>
  );
}

const MetricCard = ({ title, value, subtitle, color }) => {
  return (
    <div className="metric-card" style={{ borderTopColor: color }}>
      <div className="metric-title">{title}</div>
      <div className="metric-value" style={{ color }}>{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
    </div>
  );
};

export default CarbonLeakageDashboard;

