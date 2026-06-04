// Vercel Serverless Function: /api/prism/curve
// 成长曲线 — 智能时间粒度 + 多维度趋势 + 真实成长指标
const { db } = require('../db');
const { getColorForType } = require('./utils');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT id, created_at, type, analysis_structured, labels
      FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
      ORDER BY created_at ASC
    `);

    if (result.rows.length === 0) {
      return res.json({
        labels: [],
        datasets: [],
        severityDatasets: [],
        cumulativeDatasets: [],
        stats: { total: 0, improved: 0, topType: '', avgSeverity: '' }
      });
    }

    const rows = result.rows;

    // ── 1. 智能时间粒度 ──
    // 数据跨度 <= 14天 → 按天；>14天 → 按周
    const firstDate = new Date(rows[0].created_at);
    const lastDate = new Date(rows[rows.length - 1].created_at);
    const daySpan = Math.round((lastDate - firstDate) / 86400000);
    const useDaily = daySpan <= 14;

    // ── 2. 解析每条记录 ──
    const parsed = rows.map(row => {
      let analysis = {};
      try { analysis = JSON.parse(row.analysis_structured || '{}'); } catch(e) {}

      // 解析 labels
      let parsedLabels = null;
      if (analysis.labels) parsedLabels = analysis.labels;
      if (!parsedLabels && row.labels) {
        try { parsedLabels = JSON.parse(row.labels); } catch(e) {}
      }

      const d = new Date(row.created_at);
      let timeKey;
      if (useDaily) {
        const m = d.getMonth() + 1;
        const day = d.getDate();
        timeKey = `${m}/${day}`;
      } else {
        // 按周：ISO week
        const jan1 = new Date(d.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((d - jan1) / 86400000) + jan1.getDay() + 1) / 7);
        timeKey = `W${weekNum}`;
      }

      return {
        timeKey,
        date: d,
        type: row.type || analysis.type || '未分类',
        severity: parsedLabels ? parsedLabels.severity : (analysis.root ? '中' : ''),
        domain: parsedLabels ? (parsedLabels.domain || []) : [],
        pattern: parsedLabels ? (parsedLabels.pattern || []) : [],
      };
    });

    // ── 3. 按时间 key 排序去重 ──
    const allTimeKeys = [...new Set(parsed.map(p => p.timeKey))];
    // 保留时间顺序（用第一条记录的 date 排序）
    const timeKeyOrder = {};
    parsed.forEach(p => {
      if (!timeKeyOrder[p.timeKey]) timeKeyOrder[p.timeKey] = p.date.getTime();
    });
    allTimeKeys.sort((a, b) => timeKeyOrder[a] - timeKeyOrder[b]);

    // ── 4. 按类型统计 ──
    const allTypes = [...new Set(parsed.map(p => p.type))];
    const typeTimeMap = {};
    parsed.forEach(p => {
      if (!typeTimeMap[p.timeKey]) typeTimeMap[p.timeKey] = {};
      if (!typeTimeMap[p.timeKey][p.type]) typeTimeMap[p.timeKey][p.type] = 0;
      typeTimeMap[p.timeKey][p.type]++;
    });

    const typeDatasets = allTypes.map(type => ({
      label: type,
      values: allTimeKeys.map(k => (typeTimeMap[k] && typeTimeMap[k][type]) || 0),
      color: getColorForType(type)
    }));

    // ── 5. 累计趋势 ──
    const totalPerTime = allTimeKeys.map(k => {
      let sum = 0;
      allTypes.forEach(t => { sum += (typeTimeMap[k] && typeTimeMap[k][t]) || 0; });
      return sum;
    });
    const cumulative = [];
    let cumSum = 0;
    totalPerTime.forEach(v => { cumSum += v; cumulative.push(cumSum); });

    const cumulativeDatasets = [{
      label: '累计错题',
      values: cumulative,
      color: '#7F77DD'
    }];

    // ── 6. 严重度分布 ──
    const SEVERITY_ORDER = ['轻微', '轻', '中', '较重', '重', '严重'];
    const severitySort = (a, b) => {
      const ai = SEVERITY_ORDER.indexOf(a);
      const bi = SEVERITY_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    };

    const allSeverities = [...new Set(parsed.filter(p => p.severity).map(p => p.severity))].sort(severitySort);
    const sevTimeMap = {};
    parsed.forEach(p => {
      if (!p.severity) return;
      if (!sevTimeMap[p.timeKey]) sevTimeMap[p.timeKey] = {};
      if (!sevTimeMap[p.timeKey][p.severity]) sevTimeMap[p.timeKey][p.severity] = 0;
      sevTimeMap[p.timeKey][p.severity]++;
    });

    const severityColorMap = { '轻微': '#1D9E75', '轻': '#1D9E75', '中': '#BA7517', '较重': '#D85A30', '重': '#D85A30', '严重': '#cc2233' };
    const severityDatasets = allSeverities.map(sev => ({
      label: sev,
      values: allTimeKeys.map(k => (sevTimeMap[k] && sevTimeMap[k][sev]) || 0),
      color: severityColorMap[sev] || '#7F77DD'
    }));

    // ── 7. 统计指标 ──
    const totalCount = parsed.length;
    const typeCountMap = {};
    parsed.forEach(p => { typeCountMap[p.type] = (typeCountMap[p.type] || 0) + 1; });
    const topType = Object.entries(typeCountMap).sort((a,b) => b[1] - a[1])[0];

    // 改进指标：最后时间段的每类型数量 < 第一个时间段的 50%
    let improvedCount = 0;
    if (allTimeKeys.length >= 2) {
      const firstKey = allTimeKeys[0];
      const lastKey = allTimeKeys[allTimeKeys.length - 1];
      allTypes.forEach(type => {
        const firstVal = (typeTimeMap[firstKey] && typeTimeMap[firstKey][type]) || 0;
        const lastVal = (typeTimeMap[lastKey] && typeTimeMap[lastKey][type]) || 0;
        if (firstVal > 0 && lastVal < firstVal * 0.5) improvedCount++;
      });
    }

    // 平均严重度
    const sevScores = { '轻微': 1, '轻': 1, '中': 2, '较重': 3, '重': 3, '严重': 4 };
    const sevVals = parsed.filter(p => p.severity && sevScores[p.severity]).map(p => sevScores[p.severity]);
    const avgSeverity = sevVals.length > 0
      ? (sevVals.reduce((a,b) => a+b, 0) / sevVals.length).toFixed(1)
      : '—';

    // 领域多样性
    const allDomains = [...new Set(parsed.flatMap(p => p.domain))];

    res.json({
      labels: allTimeKeys,
      datasets: typeDatasets,
      cumulativeDatasets,
      severityDatasets,
      stats: {
        total: totalCount,
        improved: improvedCount,
        topType: topType ? topType[0] : '—',
        topTypeCount: topType ? topType[1] : 0,
        avgSeverity,
        domainCount: allDomains.length,
        timeRange: useDaily ? 'daily' : 'weekly',
        dateSpan: daySpan
      }
    });
  } catch (err) {
    console.error('/api/prism/curve 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
