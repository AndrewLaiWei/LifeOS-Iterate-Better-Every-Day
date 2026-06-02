// Vercel Serverless Function: /api/cleanup
// AI 语音记录预整理：去噪音、去重复、组织成连贯文字

const OpenAI = require('openai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '请使用 POST 方法' });
  }

  try {
    const { answers } = req.body;

    if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
      return res.status(400).json({ error: '缺少 answers 参数' });
    }

    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器未配置 API Key' });
    }

    const ai = new OpenAI({
      apiKey: apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });

    // 把5个回答拼成结构化输入
    const parts = [];
    if (answers.event) parts.push('【发生了什么事】\n' + answers.event);
    if (answers.action) parts.push('【当时做了什么】\n' + answers.action);
    if (answers.thought) parts.push('【当时是怎么想的】\n' + answers.thought);
    if (answers.consequence) parts.push('【导致了什么后果】\n' + answers.consequence);
    if (answers.plan) parts.push('【以后打算怎么做】\n' + answers.plan);

    const inputText = parts.join('\n\n');

    const prompt = `你是一位专业的文字编辑。以下是用户通过语音回答的5个关于一次失误的问题，文字由语音识别自动转换，可能包含语气词、重复、口语化表达等噪音。

请完成以下工作：
1. 删除语气词（嗯、啊、那个、就是、然后、呃…）
2. 合并重复信息，保留最完整的版本
3. 修正语音识别可能产生的错别字（根据上下文判断）
4. 将口语化表达改为书面语
5. 按事件发展的逻辑顺序（起因→经过→想法→后果→计划）组织成一段连贯的叙述
6. 保留所有关键事实、数字、人名、时间、情感
7. 不要添加任何原文没有的信息或建议

原文：
${inputText}

请直接输出整理后的文字，不要加任何标题、标签或解释。`;

    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    });

    const cleanedText = (response.choices[0].message.content || '').trim();

    res.json({ cleaned: cleanedText });
  } catch (err) {
    console.error('AI 整理错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
