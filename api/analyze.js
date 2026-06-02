// Vercel Serverless Function: /api/analyze
// AI 错题分析接口（Turso 云数据库版）

const OpenAI = require('openai');
const { db, initTable } = require('./db');

module.exports = async (req, res) => {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '请使用 POST 方法' });
  }

  try {
    const { id, raw_text } = req.body;

    if (!raw_text) {
      return res.status(400).json({ error: '缺少 raw_text 参数' });
    }

    // 确保表存在
    await initTable();

    // 读取 API Key
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器未配置 API Key' });
    }

    const ai = new OpenAI({
      apiKey: apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });

    const prompt = `你是一位专业的错题分析教练。请用5WHY+PDCA方法分析以下失误：
"${raw_text}"
请返回JSON格式：{"eventRecord":"","surfaceCause":"","behavioralAnalysis":"","deepCause":"","cognitiveBias":"","improvementSuggestions":[],"actionChecklist":[],"longTermValue":""}`;

    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0].message.content;

    // 清理 Markdown 代码块标记
    let clean = content.trim();
    if (clean.startsWith('```')) {
      const firstNewline = clean.indexOf('\n');
      clean = clean.substring(firstNewline + 1);
      if (clean.endsWith('```')) {
        clean = clean.substring(0, clean.lastIndexOf('```'));
      }
      clean = clean.trim();
    }

    // 如果有 id，保存分析结果到数据库
    if (id) {
      await db.execute({
        sql: 'UPDATE mistake_records SET analysis_json = ? WHERE id = ?',
        args: [clean, id],
      });
    }

    res.json({ analysis: clean });
  } catch (err) {
    console.error('AI 分析错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
