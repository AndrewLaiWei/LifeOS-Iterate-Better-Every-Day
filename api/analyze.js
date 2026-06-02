// Vercel Serverless Function: /api/analyze
// AI 错题分析接口（Turso 云数据库版）
// 支持：原始语音 + 结构化引导回答

const OpenAI = require('openai');
const { db, initTable } = require('./db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '请使用 POST 方法' });
  }

  try {
    const { id, raw_text, answers } = req.body;

    if (!raw_text) {
      return res.status(400).json({ error: '缺少 raw_text 参数' });
    }

    await initTable();

    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器未配置 API Key' });
    }

    const ai = new OpenAI({
      apiKey: apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });

    // 构建 prompt：如果有结构化回答，合并进去让 AI 分析更精准
    let inputText = raw_text;

    if (answers && typeof answers === 'object' && Object.keys(answers).length > 0) {
      const parts = [];
      parts.push('【用户原始口述】\n' + raw_text);

      if (answers.event) parts.push('【发生了什么事】\n' + answers.event);
      if (answers.action) parts.push('【当时做了什么】\n' + answers.action);
      if (answers.thought) parts.push('【当时是怎么想的】\n' + answers.thought);
      if (answers.consequence) parts.push('【导致了什么后果】\n' + answers.consequence);
      if (answers.plan) parts.push('【以后打算怎么做】\n' + answers.plan);

      inputText = parts.join('\n\n');
    }

    const prompt = `你是一位专业的错题分析教练。请用5WHY+PDCA方法分析以下失误：

${inputText}

请返回JSON格式：
{"eventRecord":"","surfaceCause":"","behavioralAnalysis":"","deepCause":"","cognitiveBias":"","improvementSuggestions":[],"actionChecklist":[],"longTermValue":""}

要求：
- eventRecord：用客观、简洁的语言记录事件经过
- surfaceCause：直接导致失误的表面原因
- behavioralAnalysis：从行为模式角度分析
- deepCause：用5WHY深挖根本原因
- cognitiveBias：识别涉及的认知偏差（如确认偏差、锚定效应等）
- improvementSuggestions：2-4条具体的改进建议
- actionChecklist：2-4条可执行的行动项
- longTermValue：从这次失误中能获得的长期价值`;

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

    // 保存分析结果到数据库
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
