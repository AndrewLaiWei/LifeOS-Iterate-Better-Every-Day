// Vercel Serverless Function: /api/analyze
// AI 错题分析接口（Turso 云数据库版）
// 接收用户一次性语音口述，AI 综合分析 + 自动打标签

const OpenAI = require('openai');
const { db, initTable } = require('./db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '请使用 POST 方法' });
  }

  try {
    const { id, raw_text } = req.body;

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

    const prompt = `你是一位专业的错题分析教练。用户会一次性口述一次失误经历，可能包含事件经过、行为、想法、后果、改进计划等内容。

⚠️ 关键要求：
1. 你必须从用户的口述中提取所有维度的信息，不能遗漏
2. 用户的口述是连续的，可能按任意顺序提到以下内容：发生了什么事、做了什么、怎么想的、后果、以后打算怎么做
3. 如果某个维度用户没提到，根据已有信息合理推断，不要留空

用户口述：
${raw_text}

请返回JSON格式（不要加任何解释文字，纯JSON）：
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

    // 保存分析结果到数据库（含 labels）
    if (id) {
      let category = null;
      let scenario = null;
      let structured = null;
      let type = null;
      let sceneDetail = null;
      let labels = null;
      try {
        const parsed = JSON.parse(clean);
        category = parsed.category || null;
        scenario = parsed.scenario || null;
        type = parsed.type || category || null;
        // 提取 labels
        if (parsed.labels) {
          labels = JSON.stringify(parsed.labels);
        }
        // 构建 structured 格式
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
            actions: parsed.actionChecklist || [],
            labels: parsed.labels || null
          });
          type = parsed.category || null;
        }
      } catch (e) {
        // 解析失败不影响主流程
      }
      await db.execute({
        sql: `UPDATE mistake_records
              SET analysis_json = ?, analysis_structured = ?,
                  type = COALESCE(?, type), category = COALESCE(?, category),
                  scenario = COALESCE(?, scenario), scene_detail = COALESCE(?, scene_detail),
                  labels = COALESCE(?, labels)
              WHERE id = ?`,
        args: [clean, structured, type, category, scenario, sceneDetail, labels, id],
      });
    }

    res.json({ analysis: clean });
  } catch (err) {
    console.error('AI 分析错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
