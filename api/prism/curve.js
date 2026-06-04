// Vercel Serverless Function: /api/prism/curve
const { db } = require('../db');
const { getWeekKey, getColorForType } = require('./utils');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT created_at, type, analysis_structured, labels FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
      ORDER BY created_at ASC
    `);

    if (result.rows.length === 0) {
      return res.json({ labels: [], datasets: [] });
    }

    // ── 按错题类型 + 按领域 两条曲线 ──
    const typeWeekMap = {};
    const domainWeekMap = {};

    result.rows.forEach(row => {
      const d = new Date(row.created_at);
      const weekKey = getWeekKey(d);
      const type = row.type || '未分类';

      // 按类型
      if (!typeWeekMap[weekKey]) typeWeekMap[weekKey] = {};
      if (!typeWeekMap[weekKey][type]) typeWeekMap[weekKey][type] = 0;
      typeWeekMap[weekKey][type]++;

      // 按 domain label
      let parsedLabels = null;
      try {
        let a = JSON.parse(row.analysis_structured || '{}');
        if (a.labels) parsedLabels = a.labels;
      } catch(e) {}
      if (!parsedLabels && row.labels) {
        try { parsedLabels = JSON.parse(row.labels); } catch(e) {}
      }
      if (parsedLabels && parsedLabels.domain) {
        parsedLabels.domain.forEach(domain => {
          if (!domainWeekMap[weekKey]) domainWeekMap[weekKey] = {};
          if (!domainWeekMap[weekKey][domain]) domainWeekMap[weekKey][domain] = 0;
          domainWeekMap[weekKey][domain]++;
        });
      }
    });

    // 合并所有 week keys
    const allWeeks = [...new Set([...Object.keys(typeWeekMap), ...Object.keys(domainWeekMap)])].sort();

    // 按类型的 datasets
    const allTypes = [...new Set(result.rows.map(r => r.type || '未分类'))];
    const typeDatasets = allTypes.map(type => ({
      label: type,
      values: allWeeks.map(w => (typeWeekMap[w] && typeWeekMap[w][type]) || 0),
      color: getColorForType(type)
    }));

    // 按 domain 的 datasets
    const allDomains = [...new Set(
      result.rows.flatMap(r => {
        let parsedLabels = null;
        try {
          let a = JSON.parse(r.analysis_structured || '{}');
          if (a.labels) parsedLabels = a.labels;
        } catch(e) {}
        if (!parsedLabels && r.labels) {
          try { parsedLabels = JSON.parse(r.labels); } catch(e) {}
        }
        return (parsedLabels && parsedLabels.domain) || [];
      })
    )];
    const domainColorMap = { '工作': '#7F77DD', '生活': '#1D9E75', '人际关系': '#D85A30', '健康': '#BA7517', '财务': '#378ADD', '学习': '#AFA9EC', '家庭': '#CECBF6' };
    const domainDatasets = allDomains.map(domain => ({
      label: domain,
      values: allWeeks.map(w => (domainWeekMap[w] && domainWeekMap[w][domain]) || 0),
      color: domainColorMap[domain] || '#7F77DD'
    }));

    res.json({
      labels: allWeeks,
      datasets: typeDatasets,
      domainDatasets
    });
  } catch (err) {
    console.error('/api/prism/curve 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
