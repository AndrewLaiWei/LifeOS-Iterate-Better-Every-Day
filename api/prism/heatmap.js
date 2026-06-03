// Vercel Serverless Function: /api/prism/heatmap
const { db } = require('../db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT analysis_structured FROM mistake_records
      WHERE analysis_structured IS NOT NULL
    `);

    const DAYS = ['周一','周二','周三','周四','周五','周末'];
    const PERIODS = ['上午','下午','夜间','周末'];
    const heat = {};
    DAYS.forEach(d => { heat[d] = {}; PERIODS.forEach(p => { heat[d][p] = 0; }); });

    result.rows.forEach(row => {
      try {
        const a = JSON.parse(row.analysis_structured);
        const s = a.scene || {};
        const day = s.time || '';
        const period = s.period || '';
        if (heat[day] && heat[day][period] !== undefined) {
          heat[day][period]++;
        }
      } catch(e) {}
    });

    const output = {
      headers: ['', ...PERIODS],
      rows: DAYS.map(label => ({
        label,
        vals: PERIODS.map(p => heat[label][p])
      }))
    };
    res.json(output);
  } catch (err) {
    console.error('/api/prism/heatmap 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
