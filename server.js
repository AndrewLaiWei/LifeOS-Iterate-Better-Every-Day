const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@libsql/client');
const OpenAI = require('openai');

// ── Turso 云数据库 ──
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── DeepSeek AI ──
const ai = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── 初始化表结构（幂等）──
async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mistake_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      time TEXT,
      scene TEXT,
      event TEXT,
      mistake TEXT,
      result TEXT,
      raw_text TEXT,
      structured TEXT,
      analysis_json TEXT,
      tags TEXT,
      category TEXT,
      scenario TEXT,
      analysis_structured TEXT,
      type TEXT,
      scene_detail TEXT,
      labels TEXT
    )
  `);
  // 补全新列（已存在则跳过）
  const migrations = [
    'ALTER TABLE mistake_records ADD COLUMN category TEXT',
    'ALTER TABLE mistake_records ADD COLUMN scenario TEXT',
    'ALTER TABLE mistake_records ADD COLUMN analysis_structured TEXT',
    'ALTER TABLE mistake_records ADD COLUMN type TEXT',
    'ALTER TABLE mistake_records ADD COLUMN scene_detail TEXT',
    'ALTER TABLE mistake_records ADD COLUMN labels TEXT',
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch(e) { /* 列已存在，跳过 */ }
  }
  console.log('✅ Turso 表结构已就绪');
}

// ═══════════════════════════════════════════
//  复盘棱镜 API
// ═══════════════════════════════════════════

// 获取所有已分析的错题卡片
app.get('/api/prism/cards', async (req, res) => {
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
      // 解析 labels
      if (!parsedLabels) {
        if (analysis.labels) {
          parsedLabels = analysis.labels;
        } else if (row.labels) {
          try { parsedLabels = JSON.parse(row.labels); } catch(e) {}
        }
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
        actions: actions,
        labels: parsedLabels
      };
    });
    res.json(cards);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取热力图聚合数据
app.get('/api/prism/heatmap', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT analysis_structured, analysis_json, scene_detail FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
    `);
    const DAYS = ['周一','周二','周三','周四','周五','周末'];
    const PERIODS = ['上午','下午','夜间','周末'];
    const heat = {};
    DAYS.forEach(d => { heat[d] = {}; PERIODS.forEach(p => { heat[d][p] = 0; }); });

    result.rows.forEach(row => {
      try {
        let a = {};
        try { a = JSON.parse(row.analysis_structured || '{}'); } catch(e) {}
        const s = a.scene || {};
        const day = s.time || '';
        const period = s.period || '';
        if (heat[day] && heat[day][period] !== undefined) {
          heat[day][period]++;
        }
      } catch(e) {}
    });

    res.json({
      headers: ['', ...PERIODS],
      rows: DAYS.map(label => ({
        label,
        vals: PERIODS.map(p => heat[label][p])
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取成长曲线数据
app.get('/api/prism/curve', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT created_at, type, analysis_structured FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
      ORDER BY created_at ASC
    `);
    if (result.rows.length === 0) {
      return res.json({ labels: [], datasets: [] });
    }
    const weekMap = {};
    result.rows.forEach(row => {
      const d = new Date(row.created_at);
      const weekKey = getWeekKey(d);
      if (!weekMap[weekKey]) weekMap[weekKey] = {};
      const type = row.type || '未分类';
      if (!weekMap[weekKey][type]) weekMap[weekKey][type] = 0;
      weekMap[weekKey][type]++;
    });
    const weeks = Object.keys(weekMap).sort();
    const allTypes = [...new Set(result.rows.map(r => r.type || '未分类'))];
    const datasets = allTypes.map(type => ({
      label: type,
      values: weeks.map(w => weekMap[w][type] || 0),
      color: getColorForType(type)
    }));
    res.json({ labels: weeks, datasets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取用户画像
app.get('/api/prism/profile', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT type, analysis_structured FROM mistake_records
      WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
    `);
    if (result.rows.length === 0) {
      return res.json({
        strengths: [], weaknesses: [],
        trend: '数据不足', reasoning: '需要至少5条错题记录才能生成画像'
      });
    }
    const rows = result.rows;
    // 用 AI 汇总生成画像
    const summary = rows.map(r => {
      let a = {};
      try { a = JSON.parse(r.analysis_structured || '{}'); } catch(e) {}
      return `类型:${r.type || '未分类'}\n表层:${a.root ? a.root.surface : ''}\n深层:${a.root ? a.root.deep : ''}\n认知偏误:${(a.root && a.root.biases) ? a.root.biases.join(',') : ''}`;
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
      // 降级：返回基于规则的结果
      const typeCount = {};
      rows.forEach(r => {
        const t = r.type || '未分类';
        typeCount[t] = (typeCount[t] || 0) + 1;
      });
      const sorted = Object.entries(typeCount).sort((a,b) => b[1] - a[1]);
      res.json({
        strengths: sorted.length > 1 ? [{ name: sorted[1][0], reason: `出现频率较低（${sorted[1][1]}次）` }] : [],
        weaknesses: [{ name: sorted[0][0], reason: `出现频率最高（${sorted[0][1]}次）` }],
        trend: rows.length >= 5 ? '缓慢提升' : '数据不足',
        reasoning: `基于${rows.length}条错题记录分析，主要弱项为${sorted[0][0]}。`
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════
//  原有 API
// ═══════════════════════════════════════════

app.post('/api/mistakes', async (req, res) => {
  const { time, scene, event, mistake, result: resultField, raw_text, type, scene_detail } = req.body;
  try {
    const dbResult = await db.execute({
      sql: `INSERT INTO mistake_records (time, scene, event, mistake, result, raw_text, type, scene_detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [time, scene, event, mistake, resultField, raw_text, type || '', scene_detail || '']
    });
    res.json({ id: Number(dbResult.lastInsertRowid), message: '错题已保存' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mistakes', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM mistake_records ORDER BY created_at DESC LIMIT 20');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LifeOS 服务器运行中 (Turso)!' });
});

// AI 分析接口
app.post('/api/analyze', async (req, res) => {
  const { id, raw_text } = req.body;
  if (!raw_text) return res.status(400).json({ error: '缺少 raw_text' });

  const prompt = `你是一位专业的错题分析教练。用户会一次性口述一次失误经历，可能包含事件经过、行为、想法、后果、改进计划等内容。

⚠️ 关键要求：
1. 你必须从用户的口述中提取所有维度的信息，不能遗漏
2. 用户的口述是连续的，可能按任意顺序提到以下内容：发生了什么事、做了什么、怎么想的、后果、以后打算怎么做
3. 如果某个维度用户没提到，根据已有信息合理推断，不要留空

用户口述：
${raw_text}

请返回纯JSON（不要加任何解释文字），格式如下：
{
  "type": "错题类型（沟通冲突/情绪失控/时间管理/技能不足/认知盲区 之一）",
  "scene": {
    "time": "发生错误的星期（周一/周二/周三/周四/周五/周末）",
    "period": "发生时段（上午/下午/夜间/周末）",
    "object": "涉及对象（上级/同级/客户/亲友/其他）",
    "env": "环境（线下/线上/公开场合/私下）",
    "pressure": "压力水平（高/中/低）"
  },
  "root": {
    "surface": "表层原因（1-2句话）",
    "deep": "深层原因（2-3句话，说明认知偏误或情绪模式）",
    "biases": ["认知偏误名称"]
  },
  "suggestion": {
    "strategy": "改进策略（具体可执行，3-5句话）",
    "method": "可练习的方法名称（如：三问法、外部大脑法）"
  },
  "actions": ["下次行动1", "下次行动2", "下次行动3"],
  "labels": {
    "emotion": ["涉及的核心情绪，1-3个，从以下选取：愤怒/焦虑/恐惧/沮丧/烦躁/冲动/犹豫/侥幸/自责/委屈/无感"],
    "severity": "严重程度（轻微/中等/严重/关键）",
    "recurrenceRisk": "再发风险（高/中/低）",
    "domain": ["涉及的生活领域，1-2个，从以下选取：工作/生活/人际关系/健康/财务/学习/家庭"],
    "pattern": ["行为模式，1-2个，从以下选取：逃避/对抗/拖延/冲动/盲从/过度准备/事后后悔/自以为是"]
  }
}

⚠️ labels 是棱镜分析的核心数据，必须认真填写：
- emotion：识别口述中隐含的情绪，即使用户没直说也要推断
- severity：根据后果影响范围和不可逆程度判断
- recurrenceRisk：根据行为模式是否根深蒂固判断
- domain：这件事主要发生在哪个生活领域
- pattern：用户犯了什么行为模式的错误（不是表面错误，是底层模式）`;

  try {
    const response = await ai.chat.completions.create({
      model: process.env.LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    let content = response.choices[0].message.content;
    const m = content.match(/\{[\s\S]*\}/);
    if (m) content = m[0];

    let structured = null;
    try { structured = JSON.parse(content); } catch(e) {}

    let labels = null;
    if (structured && structured.labels) {
      labels = JSON.stringify(structured.labels);
    }

    if (structured) {
      await db.execute({
        sql: `UPDATE mistake_records
              SET analysis_json = ?, analysis_structured = ?, type = ?, labels = COALESCE(?, labels)
              WHERE id = ?`,
        args: [content, JSON.stringify(structured), structured.type || '', labels, id]
      });
    } else {
      await db.execute({
        sql: 'UPDATE mistake_records SET analysis_json = ? WHERE id = ?',
        args: [content, id]
      });
    }

    res.json({ analysis: content, structured });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 工具函数 ──
function getWeekKey(date) {
  return `第${getWeekNum(date)}周`;
}
function getWeekNum(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay()||7));
  const yearStart = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}
function getColorForType(type) {
  const map = {
    '沟通冲突': '#7F77DD',
    '情绪失控': '#D85A30',
    '时间管理': '#1D9E75',
    '技能不足': '#378ADD',
    '认知盲区': '#BA7517'
  };
  return map[type] || '#7F77DD';
}

// ── 启动 ──
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`🚀 LifeOS 服务器已启动! http://localhost:${PORT}`);
  });
}
start().catch(e => {
  console.error('启动失败:', e);
  process.exit(1);
});
