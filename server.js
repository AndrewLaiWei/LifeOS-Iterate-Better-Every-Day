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
  const { time, scene, event, mistake, result, raw_text } = req.body;
  const sql = 'INSERT INTO mistake_records (time, scene, event, mistake, result, raw_text) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [time, scene, event, mistake, result, raw_text], function(err) {
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
app.post('/api/analyze', async (req, res) => {
  const { id, raw_text } = req.body;
  const prompt = `你是一位专业的错题分析教练。请用5WHY+PDCA方法分析以下失误：
"${raw_text}"
请返回JSON格式：{"eventRecord":"","surfaceCause":"","behavioralAnalysis":"","deepCause":"","cognitiveBias":"","improvementSuggestions":[],"actionChecklist":[],"longTermValue":""}`;
  try {
    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    const content = response.choices[0].message.content;
    // 清理 Markdown 代码块标记（如 ```json\n...\n```）
    let clean = content.trim();
    if (clean.startsWith('```')) {
      const firstNewline = clean.indexOf('\n');
      clean = clean.substring(firstNewline + 1);
      if (clean.endsWith('```')) {
        clean = clean.substring(0, clean.lastIndexOf('```'));
      }
      clean = clean.trim();
    }
    db.run('UPDATE mistake_records SET analysis_json = ? WHERE id = ?', [clean, id]);
    res.json({ analysis: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('LifeOS 服务器已启动! 打开 http://localhost:3000');
});
