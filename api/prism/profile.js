// Vercel Serverless Function: /api/prism/profile
const { db } = require('../db');
const ai = require('../openai');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: '请使用 GET 方法' });

  try {
    const result = await db.execute(`
      SELECT type, analysis_structured, analysis_json FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
    `);

    if (result.rows.length === 0) {
      return res.json({
        strengths: [], weaknesses: [], trend: '数据不足', reasoning: '需要至少5条错题记录才能生成画像'
      });
    }

    // 用 AI 汇总生成画像
    const summary = result.rows.map(r => {
      let a = {};
      try { a = JSON.parse(r.analysis_structured || '{}'); } catch(e) {}
      // 兼容旧格式
      let root = a.root || { surface: '', deep: '', biases: [] };
      if (!a.root && r.analysis_json) {
        try {
          const old = JSON.parse(r.analysis_json);
          root = {
            surface: old.surfaceCause || old.behavioralAnalysis || '',
            deep: old.deepCause || '',
            biases: old.cognitiveBias ? [old.cognitiveBias] : []
          };
        } catch(e) {}
      }
      return `类型:${r.type || '未分类'}\n表层:${root.surface}\n深层:${root.deep}\n认知偏误:${root.biases.join(',')}`;
    }).join('\n---\n');

    const prompt = `你是一位专业的个人成长教练。基于以下错题记录汇总，请生成用户成长画像，返回纯JSON（不要加任何解释）：
{
  "strengths": [{"name":"优势名","reason":"原因"}],
  "weaknesses": [{"name":"弱项名","reason":"原因"}],
  "trend": "快速突破/缓慢提升/平台期/需要警惕",
  "reasoning": "总体评估依据（2-3句话）"
}
错题汇总：
${summary}`;

    try {
      const response = await ai.chat.completions.create({
        model: process.env.LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
      });
      let content = response.choices[0].message.content;
      const m = content.match(/\{[\s\S]*\}/);
      if (m) content = m[0];
      const profile = JSON.parse(content);
      res.json(profile);
    } catch (e) {
      // AI 失败，降级为规则结果
      console.warn('AI 画像生成失败，使用规则降级:', e.message);
      const typeCount = {};
      result.rows.forEach(r => {
        const t = r.type || '未分类';
        typeCount[t] = (typeCount[t] || 0) + 1;
      });
      const sorted = Object.entries(typeCount).sort((a,b) => b[1] - a[1]);
      res.json({
        strengths: sorted.length > 1 ? [{ name: sorted[1][0], reason: `出现频率较低（${sorted[1][1]}次）` }] : [],
        weaknesses: [{ name: sorted[0][0], reason: `出现频率最高（${sorted[0][1]}次）` }],
        trend: result.rows.length >= 5 ? '缓慢提升' : '数据不足',
        reasoning: `基于${result.rows.length}条错题记录分析，主要弱项为${sorted[0][0]}。`
      });
    }
  } catch (err) {
    console.error('/api/prism/profile 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
