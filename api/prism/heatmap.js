// Vercel Serverless Function: /api/prism/heatmap
const { db } = require('../db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT analysis_structured, analysis_json, scene_detail, labels FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
    `);

    // ── 时间×时段 热力图 ──
    const DAYS = ['周一','周二','周三','周四','周五','周末'];
    const PERIODS = ['上午','下午','夜间','周末'];
    const heat = {};
    DAYS.forEach(d => { heat[d] = {}; PERIODS.forEach(p => { heat[d][p] = 0; }); });

    // ── labels 聚合 ──
    const emotionCount = {};
    const domainCount = {};
    const patternCount = {};
    const severityCount = {};
    const recurrenceCount = {};

    result.rows.forEach(row => {
      // 时间热力图
      try {
        let a = {};
        try { a = JSON.parse(row.analysis_structured || '{}'); } catch(e) {}
        const s = a.scene || {};
        const day = s.time || '';
        const period = s.period || '';
        if (heat[day] && heat[day][period] !== undefined) {
          heat[day][period]++;
        }
      } catch(e) {}

      // labels 聚合
      let parsedLabels = null;
      try {
        let a = JSON.parse(row.analysis_structured || '{}');
        if (a.labels) parsedLabels = a.labels;
      } catch(e) {}
      if (!parsedLabels && row.labels) {
        try { parsedLabels = JSON.parse(row.labels); } catch(e) {}
      }
      if (!parsedLabels) {
        // 兼容旧 analysis_json
        try {
          const old = JSON.parse(row.analysis_json || '{}');
          if (old.labels) parsedLabels = old.labels;
        } catch(e) {}
      }

      if (parsedLabels) {
        (parsedLabels.emotion || []).forEach(e => { emotionCount[e] = (emotionCount[e] || 0) + 1; });
        (parsedLabels.domain || []).forEach(d => { domainCount[d] = (domainCount[d] || 0) + 1; });
        (parsedLabels.pattern || []).forEach(p => { patternCount[p] = (patternCount[p] || 0) + 1; });
        if (parsedLabels.severity) severityCount[parsedLabels.severity] = (severityCount[parsedLabels.severity] || 0) + 1;
        if (parsedLabels.recurrenceRisk) recurrenceCount[parsedLabels.recurrenceRisk] = (recurrenceCount[parsedLabels.recurrenceRisk] || 0) + 1;
      }
    });

    const timeHeatmap = {
      headers: ['', ...PERIODS],
      rows: DAYS.map(label => ({
        label,
        vals: PERIODS.map(p => heat[label][p])
      }))
    };

    res.json({
      timeHeatmap,
      labels: {
        emotion: Object.entries(emotionCount).sort((a,b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        domain: Object.entries(domainCount).sort((a,b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        pattern: Object.entries(patternCount).sort((a,b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        severity: Object.entries(severityCount).sort((a,b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        recurrenceRisk: Object.entries(recurrenceCount).sort((a,b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
      }
    });
  } catch (err) {
    console.error('/api/prism/heatmap 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
