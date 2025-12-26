import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
  ReferenceArea,
  Cell,
  LabelList
} from 'recharts';
import { parseCSV, calculateMovingAverage, calculateMetrics, calculatePeriodMetrics, CBAM_DATES } from './utils/dataParser';
import Tabs from './components/Tabs';
import ETSDashboard from './components/ETSDashboard';
import CarbonLeakageDashboard from './components/CarbonLeakageDashboard';
import Login from './components/Login';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check if user is already authenticated
    return localStorage.getItem('dashboard_authenticated') === 'true';
  });
  const [activeTab, setActiveTab] = useState('prices');
  const [scrapData, setScrapData] = useState([]);
  const [steelData, setSteelData] = useState([]);
  const [scrapMetrics, setScrapMetrics] = useState(null);
  const [steelMetrics, setSteelMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const tabs = [
    { id: 'prices', label: 'Price Analysis' },
    { id: 'ets', label: 'EU ETS Analysis' },
    { id: 'leakage', label: 'Carbon Leakage Analysis' }
  ];

  useEffect(() => {
    Promise.all([
      fetch('/data.csv').then(r => r.text()),
      fetch('/stellprices.csv').then(r => r.text())
    ])
      .then(([scrapText, steelText]) => {
        const parsedScrap = parseCSV(scrapText);
        const parsedSteel = parseCSV(steelText);
        
        const scrapWithMA = calculateMovingAverage(calculateMovingAverage(parsedScrap, 30), 90);
        const steelWithMA = calculateMovingAverage(calculateMovingAverage(parsedSteel, 30), 90);
        
        setScrapData(scrapWithMA);
        setSteelData(steelWithMA);
        setScrapMetrics(calculateMetrics(parsedScrap));
        setSteelMetrics(calculateMetrics(parsedSteel));
        setLoading(false);
      })
      .catch(error => {
        console.error('Error loading data:', error);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!scrapData.length || !scrapMetrics || !steelData.length || !steelMetrics) {
    return <div className="error">Error loading data</div>;
  }

  // Format data for charts
  const scrapChartData = scrapData.map(d => ({
    date: d.Date,
    price: d.Price,
    ma30: d.MA_30,
    ma90: d.MA_90
  }));

  const steelChartData = steelData.map(d => ({
    date: d.Date,
    price: d.Price,
    ma30: d.MA_30,
    ma90: d.MA_90
  }));

  // Calculate period changes for bar chart
  const scrapPeriodChanges = [];
  const steelPeriodChanges = [];
  
  for (let i = 0; i < CBAM_DATES.length - 1; i++) {
    const currentDate = CBAM_DATES[i].date;
    const nextDate = CBAM_DATES[i + 1].date;
    
    const scrapMetrics = calculatePeriodMetrics(scrapData, currentDate, nextDate);
    const steelMetrics = calculatePeriodMetrics(steelData, currentDate, nextDate);
    
    if (scrapMetrics) {
      scrapPeriodChanges.push({
        period: CBAM_DATES[i].short,
        change: scrapMetrics.priceChangePct,
        color: CBAM_DATES[i].color
      });
    }
    
    if (steelMetrics) {
      steelPeriodChanges.push({
        period: CBAM_DATES[i].short,
        change: steelMetrics.priceChangePct,
        color: CBAM_DATES[i].color
      });
    }
  }

  // Get visible CBAM dates (based on combined date range)
  const allDates = [...scrapData, ...steelData].map(d => d.Date);
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates));
  
  const visibleCBAMDates = CBAM_DATES.filter(cbam => {
    return cbam.date >= minDate && cbam.date <= maxDate;
  });

  // Format date for display
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{formatDate(payload[0].payload.date)}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: ${entry.value.toFixed(2)}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };


  if (activeTab === 'ets') {
    return (
      <div className="dashboard">
        <Tabs activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />
        <ETSDashboard />
      </div>
    );
  }

  if (activeTab === 'leakage') {
    return (
      <div className="dashboard">
        <Tabs activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />
        <CarbonLeakageDashboard />
      </div>
    );
  }

  return (
    <div className="dashboard">
      <Tabs activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />
      <header className="dashboard-header">
        <h1>Steel Price Dashboard</h1>
        <p className="subtitle">Steel Scrap & Steel Prices - CBAM Impact Analysis</p>
      </header>

      <div className="metrics-grid">
        <MetricCard
          title="Steel Scrap - Current"
          value={`$${scrapMetrics.currentPrice.toFixed(2)}`}
          color="#2563EB"
        />
        <MetricCard
          title="Steel Scrap - Change"
          value={`${scrapMetrics.totalChangePct >= 0 ? '+' : ''}${scrapMetrics.totalChangePct.toFixed(2)}%`}
          color={scrapMetrics.totalChangePct >= 0 ? '#10B981' : '#EF4444'}
        />
        <MetricCard
          title="Steel - Current"
          value={`$${steelMetrics.currentPrice.toFixed(2)}`}
          color="#7C3AED"
        />
        <MetricCard
          title="Steel - Change"
          value={`${steelMetrics.totalChangePct >= 0 ? '+' : ''}${steelMetrics.totalChangePct.toFixed(2)}%`}
          color={steelMetrics.totalChangePct >= 0 ? '#10B981' : '#EF4444'}
        />
      </div>

      <div className="chart-container main-chart">
        <h2>Steel Scrap Price Trend with CBAM Milestones</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={scrapChartData} margin={{ top: 60, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              tickFormatter={(date) => new Date(date).getFullYear()}
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#6B7280"
              tickFormatter={(value) => `$${value}`}
              style={{ fontSize: '12px' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            
            {/* Phase backgrounds */}
            <ReferenceArea
              x1={new Date(2023, 4, 17)}
              x2={new Date(2023, 9, 1)}
              fill="#3B82F6"
              fillOpacity={0.1}
            />
            <ReferenceArea
              x1={new Date(2023, 9, 1)}
              x2={new Date(2026, 0, 1)}
              fill="#8B5CF6"
              fillOpacity={0.1}
            />
            <ReferenceArea
              x1={new Date(2026, 0, 1)}
              x2={new Date(2034, 0, 1)}
              fill="#EC4899"
              fillOpacity={0.1}
            />

            {/* CBAM date markers with labels */}
            {visibleCBAMDates.map((cbam, index) => (
              <ReferenceLine
                key={`cbam-scrap-${index}`}
                x={cbam.date}
                stroke={cbam.color}
                strokeWidth={3}
                strokeDasharray="0"
                label={{ 
                  value: cbam.short, 
                  position: 'top',
                  fill: cbam.color,
                  fontSize: 11,
                  fontWeight: 'bold',
                  offset: 15,
                  angle: -45
                }}
              />
            ))}

            <Line
              type="monotone"
              dataKey="price"
              stroke="#2563EB"
              strokeWidth={2.5}
              dot={false}
              name="Steel Scrap Price"
            />
            <Line
              type="monotone"
              dataKey="ma30"
              stroke="#10B981"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="30-Day MA"
            />
            <Line
              type="monotone"
              dataKey="ma90"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="90-Day MA"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container main-chart">
        <h2>Steel Price Trend with CBAM Milestones</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={steelChartData} margin={{ top: 60, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              tickFormatter={(date) => new Date(date).getFullYear()}
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#6B7280"
              tickFormatter={(value) => `$${value}`}
              style={{ fontSize: '12px' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            
            {/* Phase backgrounds */}
            <ReferenceArea
              x1={new Date(2023, 4, 17)}
              x2={new Date(2023, 9, 1)}
              fill="#3B82F6"
              fillOpacity={0.1}
            />
            <ReferenceArea
              x1={new Date(2023, 9, 1)}
              x2={new Date(2026, 0, 1)}
              fill="#8B5CF6"
              fillOpacity={0.1}
            />
            <ReferenceArea
              x1={new Date(2026, 0, 1)}
              x2={new Date(2034, 0, 1)}
              fill="#EC4899"
              fillOpacity={0.1}
            />

            {/* CBAM date markers with labels */}
            {visibleCBAMDates.map((cbam, index) => (
              <ReferenceLine
                key={`cbam-steel-${index}`}
                x={cbam.date}
                stroke={cbam.color}
                strokeWidth={3}
                strokeDasharray="0"
                label={{ 
                  value: cbam.short, 
                  position: 'top',
                  fill: cbam.color,
                  fontSize: 11,
                  fontWeight: 'bold',
                  offset: 15,
                  angle: -45
                }}
              />
            ))}

            <Line
              type="monotone"
              dataKey="price"
              stroke="#7C3AED"
              strokeWidth={2.5}
              dot={false}
              name="Steel Price"
            />
            <Line
              type="monotone"
              dataKey="ma30"
              stroke="#10B981"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="30-Day MA"
            />
            <Line
              type="monotone"
              dataKey="ma90"
              stroke="#F59E0B"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="90-Day MA"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="dashboard-grid">
        <div className="chart-container">
          <h2>Steel Scrap - Price Change by CBAM Period</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={scrapPeriodChanges} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="period"
                stroke="#6B7280"
                angle={-45}
                textAnchor="end"
                height={80}
                style={{ fontSize: '11px' }}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value}%`}
                style={{ fontSize: '12px' }}
              />
              <Tooltip
                formatter={(value) => [`${value.toFixed(2)}%`, 'Change']}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar
                dataKey="change"
                radius={[8, 8, 0, 0]}
              >
                {scrapPeriodChanges.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h2>Steel - Price Change by CBAM Period</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={steelPeriodChanges} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="period"
                stroke="#6B7280"
                angle={-45}
                textAnchor="end"
                height={80}
                style={{ fontSize: '11px' }}
              />
              <YAxis
                stroke="#6B7280"
                tickFormatter={(value) => `${value}%`}
                style={{ fontSize: '12px' }}
              />
              <Tooltip
                formatter={(value) => [`${value.toFixed(2)}%`, 'Change']}
                contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '8px' }}
              />
              <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="3 3" />
              <Bar
                dataKey="change"
                radius={[8, 8, 0, 0]}
              >
                {steelPeriodChanges.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="cbam-timeline">
        <h2>CBAM Implementation Timeline</h2>
        <div className="timeline-container">
          {CBAM_DATES.map((cbam, index) => {
            // Find closest date within 30 days for both datasets
            const scrapPriceAtDate = scrapData.reduce((closest, d) => {
              const dateDiff = Math.abs(new Date(d.Date) - cbam.date);
              const closestDiff = closest ? Math.abs(new Date(closest.Date) - cbam.date) : Infinity;
              return dateDiff < closestDiff && dateDiff < 30 * 86400000 ? d : closest;
            }, null)?.Price || null;

            const steelPriceAtDate = steelData.reduce((closest, d) => {
              const dateDiff = Math.abs(new Date(d.Date) - cbam.date);
              const closestDiff = closest ? Math.abs(new Date(closest.Date) - cbam.date) : Infinity;
              return dateDiff < closestDiff && dateDiff < 30 * 86400000 ? d : closest;
            }, null)?.Price || null;

            return (
              <div key={index} className="timeline-item">
                <div className="timeline-marker" style={{ backgroundColor: cbam.color }}></div>
                <div className="timeline-content">
                  <div className="timeline-date">{formatDate(cbam.date)}</div>
                  <div className="timeline-label">{cbam.label}</div>
                  <div className="timeline-prices">
                    {scrapPriceAtDate && (
                      <div className="timeline-price">Scrap: ${scrapPriceAtDate.toFixed(2)}</div>
                    )}
                    {steelPriceAtDate && (
                      <div className="timeline-price">Steel: ${steelPriceAtDate.toFixed(2)}</div>
                    )}
                  </div>
                  <div className="timeline-phase">{cbam.phase}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="financial-analysis">
        <h2>Financial Analysis by CBAM Milestone</h2>
        <div className="analysis-grid">
          {visibleCBAMDates.map((cbam, index) => {
            // Find closest date within 30 days
            const scrapPriceAtDate = scrapData.reduce((closest, d) => {
              const dateDiff = Math.abs(new Date(d.Date) - cbam.date);
              const closestDiff = closest ? Math.abs(new Date(closest.Date) - cbam.date) : Infinity;
              return dateDiff < closestDiff && dateDiff < 30 * 86400000 ? d : closest;
            }, null)?.Price;

            const steelPriceAtDate = steelData.reduce((closest, d) => {
              const dateDiff = Math.abs(new Date(d.Date) - cbam.date);
              const closestDiff = closest ? Math.abs(new Date(closest.Date) - cbam.date) : Infinity;
              return dateDiff < closestDiff && dateDiff < 30 * 86400000 ? d : closest;
            }, null)?.Price;

            if (!scrapPriceAtDate && !steelPriceAtDate) return null;

            const periodStart = new Date(cbam.date);
            periodStart.setDate(periodStart.getDate() - 90);
            const scrapBeforeMetrics = calculatePeriodMetrics(scrapData, periodStart, cbam.date);
            const steelBeforeMetrics = calculatePeriodMetrics(steelData, periodStart, cbam.date);

            return (
              <div key={index} className="analysis-card" style={{ borderLeftColor: cbam.color }}>
                <div className="analysis-header">
                  <h3>{cbam.short}</h3>
                  <span className="analysis-date">{formatDate(cbam.date)}</span>
                </div>
                <div className="analysis-metrics">
                  {scrapPriceAtDate && (
                    <>
                      <div className="metric-row">
                        <span className="metric-label">Scrap Price:</span>
                        <span className="metric-value">${scrapPriceAtDate.toFixed(2)}</span>
                      </div>
                      {scrapBeforeMetrics && (
                        <div className="metric-row">
                          <span className="metric-label">Scrap 90d Before:</span>
                          <span className={`metric-value ${scrapBeforeMetrics.priceChangePct >= 0 ? 'positive' : 'negative'}`}>
                            {scrapBeforeMetrics.priceChangePct >= 0 ? '+' : ''}{scrapBeforeMetrics.priceChangePct.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {steelPriceAtDate && (
                    <>
                      <div className="metric-row">
                        <span className="metric-label">Steel Price:</span>
                        <span className="metric-value">${steelPriceAtDate.toFixed(2)}</span>
                      </div>
                      {steelBeforeMetrics && (
                        <div className="metric-row">
                          <span className="metric-label">Steel 90d Before:</span>
                          <span className={`metric-value ${steelBeforeMetrics.priceChangePct >= 0 ? 'positive' : 'negative'}`}>
                            {steelBeforeMetrics.priceChangePct >= 0 ? '+' : ''}{steelBeforeMetrics.priceChangePct.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MetricCard = ({ title, value, color }) => {
  return (
    <div className="metric-card" style={{ borderTopColor: color }}>
      <div className="metric-title">{title}</div>
      <div className="metric-value" style={{ color }}>{value}</div>
    </div>
  );
};

export default App;
