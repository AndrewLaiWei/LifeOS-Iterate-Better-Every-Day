// Turso 云数据库连接模块（Vercel Serverless 用）
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 初始化表结构（幂等，重复执行不会报错）
// ⚠️ 列必须与 prism API / server.js 完全对齐
async function initTable() {
  // 先尝试创建表（新数据库），包含所有可能用到的列
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

  // 为已有旧表补全新列（已存在则跳过）
  const migrations = [
    'ALTER TABLE mistake_records ADD COLUMN category TEXT',
    'ALTER TABLE mistake_records ADD COLUMN scenario TEXT',
    'ALTER TABLE mistake_records ADD COLUMN analysis_structured TEXT',
    'ALTER TABLE mistake_records ADD COLUMN type TEXT',
    'ALTER TABLE mistake_records ADD COLUMN scene_detail TEXT',
    'ALTER TABLE mistake_records ADD COLUMN labels TEXT',
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch(e) {}
  }

  console.log('✅ Turso 表结构已就绪');
}

module.exports = { db, initTable };
