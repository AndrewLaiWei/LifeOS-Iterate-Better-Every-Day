const express = require('express');
const cors = require('cors');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const initDB = require('./db/init-db');
const OpenAI = require('openai');

const ai = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const app = express();
const PORT = 3000;

const db = initDB();

// ── 数据库迁移：添加新列（忽略已存在的错误）──
function runMigrations() {
  const migrations = [
    'ALTER TABLE mistake_records ADD COLUMN analysis_structured TEXT',
    'ALTER TABLE mistake_records ADD COLUMN type TEXT',
    'ALTER TABLE mistake_records ADD COLUMN scene_detail TEXT',
  ];
  migrations.forEach(sql => {
    db.run(sql, (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        // 列已存在是正常情况，不输出警告
      }
    });
  });
}
// 等待表创建完成后再执行迁移
setTimeout(runMigrations, 800);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ═══════════════════════════════════════════
//  复盘棱镜 API
// ═══════════════════════════════════════════

// 获取所有已分析的错题卡片（兼容 analysis_json 和 analysis_structured）
app.get('/api/prism/cards', (req, res) => {
  const sql = `
    SELECT id, created_at, raw_text, type, scene_detail, analysis_structured, analysis_json
    FROM mistake_records
    WHERE analysis_structured IS NOT NULL OR analysis_json IS NOT NULL
    ORDER BY created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const cards = rows.map(row => {
        let analysis = {};
        try { analysis = JSON.parse(row.analysis_structured); } catch(e) {}
        let scene = analysis.scene || {};
        // 如果 scene_detail 存在且 analysis.scene 不存在，则使用 scene_detail
        if (row.scene_detail && !analysis.scene) {
          try { scene = JSON.parse(row.scene_detail); } catch(e) {}
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
          root: analysis.root || { surface: '', deep: '', biases: [] },
          suggestion: analysis.suggestion || { strategy: '', method: '' },
          actions: analysis.actions || [],
          analysis_json: row.analysis_json || ''
        };
      });
      res.json(cards);
    } catch (e) {
      res.status(500).json({ error: '解析数据失败: ' + e.message });
    }
  });
});

// 获取热力图聚合数据
app.get('/api/prism/heatmap', (req, res) => {
  const sql = `
    SELECT analysis_structured FROM mistake_records
    WHERE analysis_structured IS NOT NULL
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const DAYS = ['周一','周二','周三','周四','周五','周末'];
    const PERIODS = ['上午','下午','夜间','周末'];
    // heatmap[day][period] = count
    const heat = {};
    DAYS.forEach(d => { heat[d] = {}; PERIODS.forEach(p => { heat[d][p] = 0; }); });

    rows.forEach(row => {
      try {
        const a = JSON.parse(row.analysis_structured);
        const s = a.scene || {};
        const day = s.time || '';
        const period = s.period || '';
        if (heat[day] && heat[day][period] !== undefined) {
          heat[day][period]++;
        }
      } catch(e) {}
    });

    const result = {
      headers: ['', ...PERIODS],
      rows: DAYS.map(label => ({
        label,
        vals: PERIODS.map(p => heat[label][p])
      }))
    };
    res.json(result);
  });
});

// 获取成长曲线数据
app.get('/api/prism/curve', (req, res) => {
  const sql = `
    SELECT created_at, type, analysis_structured
    FROM mistake_records
    WHERE analysis_structured IS NOT NULL
    ORDER BY created_at ASC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    if (rows.length === 0) {
      return res.json({ labels: [], datasets: [] });
    }

    // 按周分组
    const weekMap = {};
    rows.forEach(row => {
      const d = new Date(row.created_at);
      const weekKey = getWeekKey(d);
      if (!weekMap[weekKey]) weekMap[weekKey] = {};
      const type = row.type || '未分类';
      if (!weekMap[weekKey][type]) weekMap[weekKey][type] = 0;
      weekMap[weekKey][type]++;
    });

    const weeks = Object.keys(weekMap).sort();
    const allTypes = [...new Set(rows.map(r => r.type || '未分类'))];

    const datasets = allTypes.map(type => {
      const color = getColorForType(type);
      return {
        label: type,
        values: weeks.map(w => weekMap[w][type] || 0),
        color
      };
    });

    res.json({ labels: weeks, datasets });
  });
});

// 获取用户画像
app.get('/api/prism/profile', (req, res) => {
  const sql = `
    SELECT type, analysis_structured FROM mistake_records
    WHERE analysis_structured IS NOT NULL
  `;
  db.all(sql, [], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) {
      return res.json({
        strengths: [], weaknesses: [], trend: '数据不足', reasoning: '需要至少5条错题记录才能生成画像'
      });
    }

    // 用 AI 汇总生成画像
    const summary = rows.map(r => {
      let a = {};
      try { a = JSON.parse(r.analysis_structured); } catch(e) {}
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
  });
});

// ═══════════════════════════════════════════
//  原有 API（保持不变）
// ═══════════════════════════════════════════

app.post('/api/mistakes', (req, res) => {
  const { time, scene, event, mistake, result, raw_text, type, scene_detail } = req.body;
  const sql = `INSERT INTO mistake_records (time, scene, event, mistake, result, raw_text, type, scene_detail)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [time, scene, event, mistake, result, raw_text, type || '', scene_detail || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: '错题已保存' });
  });
});

app.get('/api/mistakes', (req, res) => {
  db.all('SELECT * FROM mistake_records ORDER BY created_at DESC LIMIT 20', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'LifeOS 服务器运行中!' });
});

// 增强的 AI 分析接口
app.post('/api/analyze', async (req, res) => {
  const { id, raw_text } = req.body;
  if (!id || !raw_text) return res.status(400).json({ error: '缺少 id 或 raw_text' });

  const prompt = `你是一位专业的错题分析教练。请分析以下失误记录，并返回纯JSON（不要加任何解释文字），格式如下：
{
  "type": "错误的类型（沟通冲突/情绪失控/时间管理/技能不足/认知盲区 之一）",
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
  "actions": ["下次行动1", "下次行动2", "下次行动3"]
}
失误记录："${raw_text}"`;

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

    if (structured) {
      db.run(
        'UPDATE mistake_records SET analysis_json = ?, analysis_structured = ?, type = ? WHERE id = ?',
        [content, JSON.stringify(structured), structured.type || '', id],
        (err) => { if (err) console.error('更新失败:', err.message); }
      );
    } else {
      db.run('UPDATE mistake_records SET analysis_json = ? WHERE id = ?', [content, id]);
    }

    res.json({ analysis: content, structured });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`LifeOS 服务器已启动! http://localhost:${PORT}`);
});

// ── 工具函数 ──
function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay() + 1); // 周一
  const m = d.getMonth()+1, day = d.getDate();
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
