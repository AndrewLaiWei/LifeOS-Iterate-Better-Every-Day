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

    // 有 answers 或 raw_text 至少一个即可
    const hasAnswers = answers && typeof answers === 'object' && Object.keys(answers).length > 0;
    if (!raw_text && !hasAnswers) {
      return res.status(400).json({ error: '缺少 raw_text 或 answers 参数' });
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

    // 构建 prompt：从 raw_text 和 answers 中提取信息
    const parts = [];

    if (raw_text) {
      parts.push('【用户原始口述】\n' + raw_text);
    }

    if (hasAnswers) {
      if (answers.event) parts.push('【发生了什么事】\n' + answers.event);
      if (answers.action) parts.push('【当时做了什么】\n' + answers.action);
      if (answers.thought) parts.push('【当时是怎么想的】\n' + answers.thought);
      if (answers.consequence) parts.push('【导致了什么后果】\n' + answers.consequence);
      if (answers.plan) parts.push('【以后打算怎么做】\n' + answers.plan);
    }

    const inputText = parts.join('\n\n');

    const prompt = `你是一位专业的错题分析教练。请用5WHY+PDCA方法分析以下失误：

${inputText}

请返回JSON格式：
{"eventRecord":"","surfaceCause":"","behavioralAnalysis":"","deepCause":"","cognitiveBias":"","improvementSuggestions":[],"actionChecklist":[],"longTermValue":"","category":"","scenario":""}

要求：
- eventRecord：用客观、简洁的语言记录事件经过
- surfaceCause：直接导致失误的表面原因
- behavioralAnalysis：从行为模式角度分析
- deepCause：用5WHY深挖根本原因
- cognitiveBias：识别涉及的认知偏差（如确认偏差、锚定效应等）
- improvementSuggestions：2-4条具体的改进建议
- actionChecklist：2-4条可执行的行动项
- longTermValue：从这次失误中能获得的长期价值
- category：从以下5种错题类型中选最匹配的1种（只能选1种）：沟通失误、决策偏差、情绪失控、知识盲区、执行力问题
- scenario：提取2-3个场景标签，用逗号分隔，如"工作,团队协作,客户沟通"`;

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

    // 保存分析结果到数据库（同时存 analysis_structured + type + scene_detail）
    if (id) {
      let category = null;
      let scenario = null;
      let structured = null;
      let type = null;
      let sceneDetail = null;
      try {
        const parsed = JSON.parse(clean);
        category = parsed.category || null;
        scenario = parsed.scenario || null;
        type = parsed.type || category || null;
        // 构建 structured 格式（与 server.js 一致）
        if (parsed.root) {
          structured = JSON.stringify(parsed);
          sceneDetail = parsed.scene ? JSON.stringify(parsed.scene) : null;
        } else {
          // 旧格式 → 转换为新格式
          structured = JSON.stringify({
            type: parsed.category || '未分类',
            scene: {},
            root: {
              surface: parsed.surfaceCause || parsed.behavioralAnalysis || '',
              deep: parsed.deepCause || '',
              biases: parsed.cognitiveBias ? [parsed.cognitiveBias] : []
            },
            suggestion: {
              strategy: (parsed.improvementSuggestions || []).join('；'),
              method: parsed.longTermValue || ''
            },
            actions: parsed.actionChecklist || []
          });
          type = parsed.category || null;
        }
      } catch (e) {
        // 解析失败不影响主流程
      }
      await db.execute({
        sql: 'UPDATE mistake_records SET analysis_json = ?, analysis_structured = ?, type = COALESCE(?, type), category = COALESCE(?, category), scenario = COALESCE(?, scenario), scene_detail = COALESCE(?, scene_detail) WHERE id = ?',
        args: [clean, structured, type, category, scenario, sceneDetail, id],
      });
    }

    res.json({ analysis: clean });
  } catch (err) {
    console.error('AI 分析错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
