const express = require('express');
const cors = require('cors');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const initDB = require('./db/init-db');
const OpenAI = require('openai');

// 优先读 LLM_API_KEY，兼容 OPENAI_API_KEY
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('❌ 缺少 API Key！请设置环境变量 LLM_API_KEY 或 OPENAI_API_KEY');
  process.exit(1);
}

const ai = new OpenAI({
  apiKey: apiKey,
  baseURL: process.env.LLM_BASE_URL,
});
const app = express();
const PORT = process.env.PORT || 3000;
const db = initDB();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/mistakes', (req, res) => {
  const { time, scene, event, mistake, result, raw_text, structured, category, scenario } = req.body;
  const sql = 'INSERT INTO mistake_records (time, scene, event, mistake, result, raw_text, structured, category, scenario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.run(sql, [time || null, scene || null, event || null, mistake || null, result || null, raw_text || null, structured || null, category || null, scenario || null], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, message: '错题已保存' });
  });
});

app.get('/api/mistakes', (req, res) => {
  const sql = 'SELECT * FROM mistake_records ORDER BY created_at DESC LIMIT 20';
  db.all(sql, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LifeOS 服务器运行中!' });
});
app.post('/api/cleanup', async (req, res) => {
  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: '缺少 answers 参数' });
  }
  // 拼接结构化输入
  const parts = [];
  if (answers.event) parts.push('【发生了什么事】\n' + answers.event);
  if (answers.action) parts.push('【当时做了什么】\n' + answers.action);
  if (answers.thought) parts.push('【当时是怎么想的】\n' + answers.thought);
  if (answers.consequence) parts.push('【导致了什么后果】\n' + answers.consequence);
  if (answers.plan) parts.push('【以后打算怎么做】\n' + answers.plan);
  const inputText = parts.join('\n\n');

  const prompt = `请整理以下语音记录，使其更清晰：
${inputText}

要求：
- 删除语气词（嗯、啊、那个、就是等）
- 合并重复信息
- 修正可能的语音识别错别字
- 口语改书面语
- 按逻辑顺序组织（起因→经过→想法→后果→计划）
- 保留关键事实、数字、人名、时间、情感
- 不添加原文没有的信息或建议`;

  try {
    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.choices[0].message.content;
    let clean = content.trim();
    if (clean.startsWith('```')) {
      const firstNewline = clean.indexOf('\n');
      clean = clean.substring(firstNewline + 1);
      if (clean.endsWith('```')) clean = clean.substring(0, clean.lastIndexOf('```'));
      clean = clean.trim();
    }
    res.json({ cleaned: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/analyze', async (req, res) => {
  const { id, raw_text, answers } = req.body;
  const hasAnswers = answers && typeof answers === 'object' && Object.keys(answers).length > 0;
  const inputText = raw_text || JSON.stringify(answers) || '';
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
  try {
    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL,
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
    // 保存分析结果 + 分类到数据库
    if (id) {
      let category = null;
      let scenario = null;
      try {
        const parsed = JSON.parse(clean);
        category = parsed.category || null;
        scenario = parsed.scenario || null;
      } catch (e) {}
      db.run('UPDATE mistake_records SET analysis_json = ?, category = COALESCE(?, category), scenario = COALESCE(?, scenario) WHERE id = ?', [clean, category, scenario, id]);
    }
    res.json({ analysis: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('LifeOS 服务器已启动! 打开 http://localhost:3000');
});
