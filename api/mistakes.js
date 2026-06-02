// Vercel Serverless Function: /api/mistakes
// 错题保存/查询接口（Turso 云数据库版）

const { db, initTable } = require('./db');

// 把 undefined 转成 null，Turso 不支持 undefined 参数
function safeArgs(arr) {
  return arr.map(v => v === undefined ? null : v);
}

module.exports = async (req, res) => {
  try {
    // 确保表存在
    await initTable();

    // POST: 保存错题
    if (req.method === 'POST') {
      const { time, scene, event, mistake, result, raw_text, structured, category, scenario } = req.body;

      const result_db = await db.execute({
        sql: `INSERT INTO mistake_records (time, scene, event, mistake, result, raw_text, structured, category, scenario)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: safeArgs([time, scene, event, mistake, result, raw_text, structured, category, scenario]),
      });

      const lastInsertId = Number(result_db.lastInsertRowid);
      return res.json({ id: lastInsertId, message: '错题已保存到云端' });
    }

    // GET: 查询错题列表
    if (req.method === 'GET') {
      const result_db = await db.execute(
        'SELECT * FROM mistake_records ORDER BY created_at DESC LIMIT 20'
      );
      return res.json(result_db.rows);
    }

    // 其他方法
    res.status(405).json({ error: '请使用 GET 或 POST 方法' });
  } catch (err) {
    console.error('mistakes API 错误:', err.message);
    res.status(500).json({ error: err.message });
  }
};
