// Turso 云数据库连接模块（Vercel Serverless 用）
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// 初始化表结构（幂等，重复执行不会报错）
async function initTable() {
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
      tags TEXT
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER,
      content TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (record_id) REFERENCES mistake_records(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS week_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      essence TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('✅ Turso 表结构已就绪');
}

module.exports = { db, initTable };
