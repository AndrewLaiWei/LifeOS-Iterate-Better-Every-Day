// Vercel Serverless Function: /api/prism/cards
const { db } = require('../db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT id, created_at, raw_text, type, scene_detail, analysis_structured, analysis_json
      FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
      ORDER BY created_at DESC
    `);

    const cards = result.rows.map(row => {
      let analysis = {};
      try { analysis = JSON.parse(row.analysis_structured || '{}'); } catch(e) {}
      let scene = analysis.scene || {};
      if (row.scene_detail && !analysis.scene) {
        try { scene = JSON.parse(row.scene_detail); } catch(e) {}
      }
      // 兼容旧 analysis_json 格式
      let root = analysis.root || { surface: '', deep: '', biases: [] };
      let suggestion = analysis.suggestion || { strategy: '', method: '' };
      let actions = analysis.actions || [];
      if (!analysis.root && row.analysis_json) {
        try {
          const old = JSON.parse(row.analysis_json);
          root = {
            surface: old.surfaceCause || old.behavioralAnalysis || '',
            deep: old.deepCause || '',
            biases: old.cognitiveBias ? [old.cognitiveBias] : []
          };
          suggestion = {
            strategy: (old.improvementSuggestions || []).join('；') || '',
            method: old.longTermValue || ''
          };
          actions = old.actionChecklist || [];
        } catch(e) {}
      }
      return {
        id: 'mk-' + row.id,
        raw: {
          type: '文本',
          content: row.raw_text || '',
          time: row.created_at || ''
        },
        type: row.type || analysis.type || '未分类',
        scene: scene,
        root: root,
        suggestion: suggestion,
        actions: actions
      };
    });

    res.json(cards);
  } catch (err) {
    console.error('/api/prism/cards 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
