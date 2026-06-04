// Vercel Serverless Function: /api/prism/cards
const { db } = require('../db');

/**
 * 检测文本是否为乱码/脏数据（旧版录音存入的二进制或错误编码数据）
 * 正常范围：ASCII可打印、中文、常见标点、换行回车制表符
 */
function isGarbageText(str) {
  if (!str || str.length < 4) return false;
  let normal = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 0x0A || c === 0x0D || c === 0x09) { normal++; continue; } // \n \r \t
    if (c >= 0x20 && c <= 0x7E) { normal++; continue; } // ASCII printable
    if (c >= 0x4E00 && c <= 0x9FFF) { normal++; continue; } // CJK
    if (c >= 0x3000 && c <= 0x303F) { normal++; continue; } // CJK punctuation
    if (c >= 0xFF00 && c <= 0xFFEF) { normal++; continue; } // Fullwidth
    if (c >= 0x2000 && c <= 0x206F) { normal++; continue; } // General punctuation
    if (c >= 0x00A0 && c <= 0x00BF) { normal++; continue; } // Latin-1 supplement symbols
  }
  return (normal / str.length) < 0.75; // 正常字符不足75%则判为乱码
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT id, created_at, raw_text, type, scene_detail, analysis_structured, analysis_json, labels
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
      let parsedLabels = null;
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
          if (old.labels) parsedLabels = old.labels;
        } catch(e) {}
      }
      // 解析 labels（从 analysis_structured 或独立 labels 字段）
      if (!parsedLabels) {
        if (analysis.labels) {
          parsedLabels = analysis.labels;
        } else if (row.labels) {
          try { parsedLabels = JSON.parse(row.labels); } catch(e) {}
        }
      }
      // 过滤乱码原始记录（旧版脏数据降级）
      let rawContent = row.raw_text || '';
      if (isGarbageText(rawContent)) rawContent = '';

      return {
        id: 'mk-' + row.id,
        raw: {
          type: '文本',
          content: rawContent,
          time: row.created_at || ''
        },
        type: row.type || analysis.type || '未分类',
        scene: scene,
        root: root,
        suggestion: suggestion,
        actions: actions,
        labels: parsedLabels
      };
    });

    res.json(cards);
  } catch (err) {
    console.error('/api/prism/cards 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
