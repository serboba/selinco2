import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart
} from 'recharts';
import {
  parseETSCSV,
  calculateETSMetrics,
  groupByYear,
  groupByCountry,
  groupBySector,
  groupByETSInfo,
  calculateTrends
} from '../utils/etsDataParser';
import {
  parseCarbonPricingCSV,
  getEUETSPrices,
  getGlobalETSPrices,
  getTopCarbonPricingJurisdictions,
  getIndustryCoverage
} from '../utils/carbonPricingParser';
import './ETSDashboard.css';

const COLORS = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#8B5CF6'];

function ETSDashboard() {
  const [data, setData] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [carbonPricingData, setCarbonPricingData] = useState([]);
  const [euEtsPrices, setEuEtsPrices] = useState([]);
  const [globalEtsPrices, setGlobalEtsPrices] = useState([]);
  const [topJurisdictions, setTopJurisdictions] = useState([]);
  const [industryCoverage, setIndustryCoverage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}ets_steel_data.csv`).then(r => r.text()),
      fetch(`${import.meta.env.BASE_URL}carbon_pricing_data.csv`).then(r => r.text()).catch(() => null)
    ])
      .then(([etsText, carbonText]) => {
        const parsed = parseETSCSV(etsText);
        setData(parsed);
        setMetrics(calculateETSMetrics(parsed));
        
        if (carbonText) {
          const carbonData = parseCarbonPricingCSV(carbonText);
          setCarbonPricingData(carbonData);
          setEuEtsPrices(getEUETSPrices(carbonData));
          setGlobalEtsPrices(getGlobalETSPrices(carbonData));
          setTopJurisdictions(getTopCarbonPricingJurisdictions(carbonData));
          setIndustryCoverage(getIndustryCoverage(carbonData));
        }
        
        setLoading(false);
      })
      .catch(error => {
        console.error('Error loading ETS data:', error);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading ETS Dashboard...</p>
      </div>
    );
  }

  if (!data.length || !metrics) {
    return <div className="error">Error loading ETS data</div>;
  }

  // Prepare all three metrics separately
  const emissionsData = data.filter(d => 
    d['ETS information']?.includes('Verified emissions') || 
    d['ETS information']?.includes('Verified Emission')
  );
  const allocatedData = data.filter(d => d['ETS information']?.includes('allocated allowances'));
  const surrenderedData = data.filter(d => d['ETS information']?.includes('Surrendered'));

  const emissionsYearlyData = groupByYear(emissionsData);
  const allocatedYearlyData = groupByYear(allocatedData);
  const surrenderedYearlyData = groupByYear(surrenderedData);
  
  const emissionsCountryData = groupByCountry(emissionsData);
  const allocatedCountryData = groupByCountry(allocatedData);
  const surrenderedCountryData = groupByCountry(surrenderedData);
  
  const sectorData = groupBySector(data);
  const etsInfoData = groupByETSInfo(data);
  const trends = calculateTrends(emissionsYearlyData);

  // Prepare emissions vs allocated vs surrendered comparison
  const emissionsYearly = groupByYear(
    data.filter(d => d['ETS information']?.includes('Verified emissions') || 
                     d['ETS information']?.includes('Verified Emission'))
  );
  const allocatedYearly = groupByYear(
    data.filter(d => d['ETS information']?.includes('allocated allowances'))
  );
  const surrenderedYearly = groupByYear(
    data.filter(d => d['ETS information']?.includes('Surrendered'))
  );

  // Combine for comparison chart
  const comparisonData = [];
  const allYears = [...new Set([...emissionsYearly, ...allocatedYearly, ...surrenderedYearly].map(d => d.year))].sort();
  
  allYears.forEach(year => {
    const emissions = emissionsYearly.find(d => d.year === year)?.total || 0;
    const allocated = allocatedYearly.find(d => d.year === year)?.total || 0;
    const surrendered = surrenderedYearly.find(d => d.year === year)?.total || 0;
    comparisonData.push({
      year,
      'Verified Emissions': emissions / 1000000, // Convert to millions
      'Allocated Allowances': allocated / 1000000,
      'Surrendered Units': surrendered / 1000000
    });
  });

  const formatValue = (value) => {
    if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
    return value.toFixed(2);
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {formatValue(entry.value * (entry.name.includes('Emissions') || entry.name.includes('Allowances') || entry.name.includes('Units') ? 1000000 : 1))}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="ets-dashboard">
      <header className="dashboard-header">
        <h1>EU ETS Steel & Iron Industry Analysis</h1>
        <p className="subtitle">Comprehensive Emissions Trading System Dashboard</p>
      </header>

      {/* Key Metrics */}
      <div className="metrics-grid">
        <MetricCard
          title="Total Verified Emissions"
          value={formatValue(metrics.totalEmissions)}
          subtitle="CO₂ equivalent"
          color="#EF4444"
          trend={trends?.changePct}
        />
        <MetricCard
          title="Total Allocated Allowances"
          value={formatValue(metrics.totalAllocated)}
          subtitle="EUAs allocated"
          color="#2563EB"
        />
        <MetricCard
          title="Total Surrendered Units"
          value={formatValue(metrics.totalSurrendered)}
          subtitle="Compliance units"
          color="#10B981"
        />
        <MetricCard
          title="Compliance Rate"
          value={`${metrics.complianceRate.toFixed(1)}%`}
          subtitle="Surrendered / Allocated"
          color={metrics.complianceRate >= 100 ? '#10B981' : '#F59E0B'}
        />
        <MetricCard
          title="Allowance Surplus/Deficit"
          value={formatValue(metrics.surplus)}
          subtitle={metrics.surplus >= 0 ? 'Surplus' : 'Deficit'}
          color={metrics.surplus >= 0 ? '#10B981' : '#EF4444'}
        />
        <MetricCard
          title="Active Entities"
          value={data.reduce((sum, d) => sum + (d.Entities || 0), 0).toLocaleString()}
          subtitle="Total installations"
          color="#7C3AED"
        />
        {euEtsPrices.length > 0 && (
          <>
            <MetricCard
              title="Current EU ETS Price"
              value={`$${euEtsPrices[euEtsPrices.length - 1].price.toFixed(2)}`}
              subtitle="Per tonne CO₂ (2025)"
              color="#7C3AED"
            />
            <MetricCard
              title="Price Change (2020-2025)"
              value={`${euEtsPrices.length > 1 ? (((euEtsPrices[euEtsPrices.length - 1].price - euEtsPrices[0].price) / euEtsPrices[0].price) * 100).toFixed(1) : 0}%`}
              subtitle="5-year trend"
              color={euEtsPrices.length > 1 && euEtsPrices[euEtsPrices.length - 1].price > euEtsPrices[0].price ? '#EF4444' : '#10B981'}
            />
          </>
        )}
      </div>


      {/* Comparison Chart */}
      <div className="chart-container main-chart">
        <h2>Emissions vs Allowances vs Surrendered Units Over Time</h2>
        <p className="chart-description">
          Comprehensive view of EU ETS compliance metrics for steel and iron industries (2005-2025)
        </p>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={comparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="year" stroke="#6B7280" />
            <YAxis 
              stroke="#6B7280" 
              tickFormatter={(value) => `${value}M`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="Verified Emissions"
              stackId="1"
              stroke="#EF4444"
              fill="#EF4444"
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="Allocated Allowances"
              stackId="2"
              stroke="#2563EB"
              fill="#2563EB"
              fillOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="Surrendered Units"
              stackId="3"
              stroke="#10B981"
              fill="#10B981"
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="dashboard-grid">
        {/* Yearly Trends - All Three Metrics */}
        <div className="chart-container">
          <h2>All Metrics by Year</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis 
                dataKey="year" 
                stroke="#6B7280"
                type="number"
                domain={['dataMin', 'dataMax']}
              />
              <YAxis 
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
              />
              <Tooltip 
                formatter={(value) => formatValue(value)}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <Line
                type="monotone"
                data={emissionsYearlyData}
                dataKey="total"
                stroke="#EF4444"
                strokeWidth={2.5}
                dot={{ fill: '#EF4444', r: 4 }}
                name="Verified Emissions"
              />
              <Line
                type="monotone"
                data={allocatedYearlyData}
                dataKey="total"
                stroke="#2563EB"
                strokeWidth={2.5}
                dot={{ fill: '#2563EB', r: 4 }}
                name="Allocated Allowances"
              />
              <Line
                type="monotone"
                data={surrenderedYearlyData}
                dataKey="total"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={{ fill: '#10B981', r: 4 }}
                name="Surrendered Units"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Top Countries - All Three Metrics */}
        <div className="chart-container">
          <h2>Top Countries Comparison</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart 
              data={(() => {
                // Get top countries from all three metrics
                const allCountries = new Set([
                  ...emissionsCountryData.map(d => d.country),
                  ...allocatedCountryData.map(d => d.country),
                  ...surrenderedCountryData.map(d => d.country)
                ]);
                
                const emissionsMap = new Map(emissionsCountryData.map(d => [d.country, d.total]));
                const allocatedMap = new Map(allocatedCountryData.map(d => [d.country, d.total]));
                const surrenderedMap = new Map(surrenderedCountryData.map(d => [d.country, d.total]));
                
                return Array.from(allCountries)
                  .map(country => ({
                    country,
                    emissions: emissionsMap.get(country) || 0,
                    allocated: allocatedMap.get(country) || 0,
                    surrendered: surrenderedMap.get(country) || 0,
                    total: (emissionsMap.get(country) || 0) + (allocatedMap.get(country) || 0) + (surrenderedMap.get(country) || 0)
                  }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 10);
              })()}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="country"
                stroke="#6B7280"
                angle={-45}
                textAnchor="end"
                height={80}
                style={{ fontSize: '11px' }}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
              />
              <Tooltip
                formatter={(value) => formatValue(value)}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Legend />
              <Bar 
                dataKey="emissions" 
                fill="#EF4444" 
                radius={[8, 8, 0, 0]}
                name="Emissions"
              />
              <Bar 
                dataKey="allocated" 
                fill="#2563EB" 
                radius={[8, 8, 0, 0]}
                name="Allocated"
              />
              <Bar 
                dataKey="surrendered" 
                fill="#10B981" 
                radius={[8, 8, 0, 0]}
                name="Surrendered"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Sector Distribution */}
        <div className="chart-container">
          <h2>Distribution by Steel/Iron Sector</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={sectorData}
                dataKey="total"
                nameKey="sector"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ sector, percent }) => `${sector.substring(0, 30)}... ${(percent * 100).toFixed(1)}%`}
              >
                {sectorData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatValue(value)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* ETS Information Types */}
        <div className="chart-container">
          <h2>ETS Information Types Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={etsInfoData.slice(0, 8)} layout="vertical" margin={{ top: 20, right: 30, left: 200, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                type="number"
                stroke="#6B7280"
                tickFormatter={(value) => formatValue(value)}
              />
              <YAxis
                dataKey="info"
                type="category"
                stroke="#6B7280"
                width={180}
                style={{ fontSize: '10px' }}
              />
              <Tooltip
                formatter={(value) => formatValue(value)}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <Bar dataKey="total" fill="#7C3AED" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Carbon Pricing Analysis Section */}
      {euEtsPrices.length > 0 && (
        <>
          <div className="chart-container main-chart">
            <h2>EU ETS Carbon Price Evolution (2020-2025)</h2>
            <p className="chart-description">
              Historical carbon price trends in the EU Emissions Trading System
            </p>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={euEtsPrices} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="year" stroke="#6B7280" />
                <YAxis 
                  stroke="#6B7280"
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                />
                <Tooltip
                  formatter={(value) => [`$${value.toFixed(2)}`, 'Price per tonne CO₂']}
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#7C3AED"
                  strokeWidth={3}
                  dot={{ fill: '#7C3AED', r: 6 }}
                  name="EU ETS Price"
                />
                <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="5 5" label="Target" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {globalEtsPrices.length > 0 && (
            <div className="dashboard-grid">
              <div className="chart-container">
                <h2>Global ETS Price Comparison</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={globalEtsPrices} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="year" stroke="#6B7280" />
                    <YAxis 
                      stroke="#6B7280"
                      tickFormatter={(value) => `$${value.toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        const label = name === 'avg' ? 'Average' : name === 'min' ? 'Minimum' : name === 'max' ? 'Maximum' : 'Median';
                        return [`$${value.toFixed(2)}`, label];
                      }}
                      contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avg"
                      stroke="#2563EB"
                      strokeWidth={2}
                      dot={{ fill: '#2563EB', r: 4 }}
                      name="Average"
                    />
                    <Line
                      type="monotone"
                      dataKey="min"
                      stroke="#10B981"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={{ fill: '#10B981', r: 3 }}
                      name="Minimum"
                    />
                    <Line
                      type="monotone"
                      dataKey="max"
                      stroke="#EF4444"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={{ fill: '#EF4444', r: 3 }}
                      name="Maximum"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {topJurisdictions.length > 0 && (
                <div className="chart-container">
                  <h2>Top Carbon Pricing Jurisdictions (Latest Prices)</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topJurisdictions.slice(0, 10)} layout="vertical" margin={{ top: 20, right: 30, left: 150, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis
                        type="number"
                        stroke="#6B7280"
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <YAxis
                        dataKey="jurisdiction"
                        type="category"
                        stroke="#6B7280"
                        width={140}
                        style={{ fontSize: '11px' }}
                      />
                      <Tooltip
                        formatter={(value) => [`$${value.toFixed(2)}`, 'Price per tonne CO₂']}
                        contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                      />
                      <Bar dataKey="latestPrice" fill="#10B981" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Carbon Price Impact Analysis */}
          {euEtsPrices.length > 0 && emissionsYearly.length > 0 && (() => {
            // Combine emissions and price data by year
            const correlationData = [];
            const emissionsMap = new Map(emissionsYearly.map(d => [d.year, d.total / 1000000]));
            const pricesMap = new Map(euEtsPrices.map(d => [d.year, d.price]));
            
            const allYears = [...new Set([...emissionsYearly.map(d => d.year), ...euEtsPrices.map(d => d.year)])].sort();
            
            allYears.forEach(year => {
              const emissions = emissionsMap.get(year);
              const price = pricesMap.get(year);
              if (emissions !== undefined || price !== undefined) {
                correlationData.push({
                  year,
                  emissions: emissions || null,
                  price: price || null
                });
              }
            });
            
            return (
              <div className="chart-container main-chart">
                <h2>Carbon Price vs Emissions Correlation</h2>
                <p className="chart-description">
                  Relationship between EU ETS carbon prices and steel industry emissions
                </p>
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={correlationData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="year" 
                      stroke="#6B7280"
                    />
                    <YAxis 
                      yAxisId="left"
                      stroke="#EF4444"
                      tickFormatter={(value) => `${value.toFixed(0)}M`}
                      label={{ value: 'Emissions (M tonnes)', angle: -90, position: 'insideLeft' }}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      stroke="#7C3AED"
                      tickFormatter={(value) => `$${value.toFixed(0)}`}
                      label={{ value: 'Carbon Price ($)', angle: 90, position: 'insideRight' }}
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        if (name === 'emissions') return [`${value.toFixed(2)}M tonnes`, 'Emissions'];
                        if (name === 'price') return [`$${value.toFixed(2)}`, 'Carbon Price'];
                        return value;
                      }}
                      contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="emissions"
                      stroke="#EF4444"
                      strokeWidth={2.5}
                      dot={{ fill: '#EF4444', r: 4 }}
                      name="Emissions (M tonnes)"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="price"
                      stroke="#7C3AED"
                      strokeWidth={2.5}
                      dot={{ fill: '#7C3AED', r: 4 }}
                      name="Carbon Price ($)"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Industry Coverage */}
          {industryCoverage && (
            <div className="chart-container">
              <h2>Industry Coverage in Carbon Pricing Instruments</h2>
              <div className="coverage-stats">
                <div className="coverage-item">
                  <div className="coverage-value" style={{ color: '#10B981' }}>
                    {industryCoverage.yes}
                  </div>
                  <div className="coverage-label">Instruments Covering Industry</div>
                </div>
                <div className="coverage-item">
                  <div className="coverage-value" style={{ color: '#EF4444' }}>
                    {industryCoverage.no}
                  </div>
                  <div className="coverage-label">Not Covering Industry</div>
                </div>
                <div className="coverage-item">
                  <div className="coverage-value" style={{ color: '#F59E0B' }}>
                    {industryCoverage.partial}
                  </div>
                  <div className="coverage-label">Partial Coverage</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Financial Analysis Section */}
      <div className="financial-analysis">
        <h2>Financial & Compliance Analysis</h2>
        <div className="analysis-grid">
          <div className="analysis-card">
            <h3>Compliance Status</h3>
            <div className="metric-row">
              <span className="metric-label">Compliance Rate:</span>
              <span className={`metric-value ${metrics.complianceRate >= 100 ? 'positive' : 'warning'}`}>
                {metrics.complianceRate.toFixed(2)}%
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Status:</span>
              <span className={`metric-value ${metrics.complianceRate >= 100 ? 'positive' : 'warning'}`}>
                {metrics.complianceRate >= 100 ? 'Compliant' : 'Non-Compliant'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Allowance Balance:</span>
              <span className={`metric-value ${metrics.surplus >= 0 ? 'positive' : 'negative'}`}>
                {formatValue(metrics.surplus)} {metrics.surplus >= 0 ? 'Surplus' : 'Deficit'}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Coverage Ratio:</span>
              <span className="metric-value">
                {metrics.totalAllocated > 0 
                  ? ((metrics.totalSurrendered / metrics.totalAllocated) * 100).toFixed(2) + '%'
                  : 'N/A'}
              </span>
            </div>
          </div>

          <div className="analysis-card">
            <h3>Emission Trends</h3>
            {trends && (
              <>
                <div className="metric-row">
                  <span className="metric-label">5-Year Average:</span>
                  <span className="metric-value">{formatValue(trends.recentAvg)}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Trend:</span>
                  <span className={`metric-value ${trends.changePct < 0 ? 'positive' : 'negative'}`}>
                    {trends.changePct >= 0 ? '+' : ''}{trends.changePct.toFixed(2)}%
                  </span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Direction:</span>
                  <span className={`metric-value ${trends.trend === 'decreasing' ? 'positive' : 'negative'}`}>
                    {trends.trend === 'decreasing' ? 'Decreasing ✓' : 'Increasing'}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="analysis-card">
            <h3>Market Activity</h3>
            <div className="metric-row">
              <span className="metric-label">Total Entities:</span>
              <span className="metric-value">
                {data.reduce((sum, d) => sum + (d.Entities || 0), 0).toLocaleString()}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Data Points:</span>
              <span className="metric-value">{data.length.toLocaleString()}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Year Range:</span>
              <span className="metric-value">
                {Math.min(...data.map(d => d.Year).filter(y => y))} - {Math.max(...data.map(d => d.Year).filter(y => y))}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Unique Countries:</span>
              <span className="metric-value">
                {new Set(data.map(d => d.Country).filter(c => c)).size}
              </span>
            </div>
          </div>

          <div className="analysis-card">
            <h3>Emission Intensity Analysis</h3>
            <div className="metric-row">
              <span className="metric-label">Avg Emissions/Entity:</span>
              <span className="metric-value">
                {formatValue(metrics.totalEmissions / Math.max(data.reduce((sum, d) => sum + (d.Entities || 0), 0), 1))}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Avg Allowances/Entity:</span>
              <span className="metric-value">
                {formatValue(metrics.totalAllocated / Math.max(data.reduce((sum, d) => sum + (d.Entities || 0), 0), 1))}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Efficiency Ratio:</span>
              <span className="metric-value">
                {metrics.totalEmissions > 0 
                  ? ((metrics.totalAllocated / metrics.totalEmissions) * 100).toFixed(2) + '%'
                  : 'N/A'}
              </span>
            </div>
          </div>

          {euEtsPrices.length > 0 && (
            <div className="analysis-card">
              <h3>Carbon Price Impact Analysis</h3>
              <div className="metric-row">
                <span className="metric-label">Current Price (2025):</span>
                <span className="metric-value">
                  ${euEtsPrices[euEtsPrices.length - 1].price.toFixed(2)}
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Peak Price:</span>
                <span className="metric-value">
                  ${Math.max(...euEtsPrices.map(p => p.price)).toFixed(2)} ({euEtsPrices.find(p => p.price === Math.max(...euEtsPrices.map(p => p.price))).year})
                </span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Est. Compliance Cost*:</span>
                <span className="metric-value">
                  {formatValue(metrics.totalEmissions * euEtsPrices[euEtsPrices.length - 1].price)}
                </span>
              </div>
              <div className="metric-note">
                *Based on current carbon price × total emissions
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MetricCard = ({ title, value, subtitle, color, trend }) => {
  return (
    <div className="metric-card" style={{ borderTopColor: color }}>
      <div className="metric-title">{title}</div>
      <div className="metric-value" style={{ color }}>{value}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
      {trend !== undefined && (
        <div className={`metric-trend ${trend >= 0 ? 'negative' : 'positive'}`}>
          {trend >= 0 ? '+' : ''}{trend.toFixed(2)}%
        </div>
      )}
    </div>
  );
};

export default ETSDashboard;

