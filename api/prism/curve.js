// Vercel Serverless Function: /api/prism/curve
const { db } = require('../db');
const { getWeekKey, getColorForType } = require('./utils');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT created_at, type, analysis_structured
      FROM mistake_records
      WHERE analysis_structured IS NOT NULL
      ORDER BY created_at ASC
    `);

    if (result.rows.length === 0) {
      return res.json({ labels: [], datasets: [] });
    }

    // 按周分组
    const weekMap = {};
    result.rows.forEach(row => {
      const d = new Date(row.created_at);
      const weekKey = getWeekKey(d);
      if (!weekMap[weekKey]) weekMap[weekKey] = {};
      const type = row.type || '未分类';
      if (!weekMap[weekKey][type]) weekMap[weekKey][type] = 0;
      weekMap[weekKey][type]++;
    });

    const weeks = Object.keys(weekMap).sort();
    const allTypes = [...new Set(result.rows.map(r => r.type || '未分类'))];

    const datasets = allTypes.map(type => {
      const color = getColorForType(type);
      return {
        label: type,
        values: weeks.map(w => weekMap[w][type] || 0),
        color
      };
    });

    res.json({ labels: weeks, datasets });
  } catch (err) {
    console.error('/api/prism/curve 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
