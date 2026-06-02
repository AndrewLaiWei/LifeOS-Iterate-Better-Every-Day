const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'lifemistakes.db');

function initDB() {
  const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('❌ 无法连接数据库:', err.message);
      process.exit(1);
    }
  });

  // 启用 WAL 模式（提升并发性能）
  db.run('PRAGMA journal_mode=WAL;');
  db.run('PRAGMA foreign_keys=ON;');

  // 创建错题记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS mistake_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      
      -- 5字段结构化输入
      time TEXT,
      scene TEXT,
      event TEXT,
      mistake TEXT,
      result TEXT,
      
      -- 原始文本
      raw_text TEXT,
      
      -- 8段分析（JSON格式）
      structured TEXT,
      analysis_json TEXT,
      
      -- 标签（逗号分隔）
      tags TEXT,

      -- V2: 错题分类
      category TEXT,
      scenario TEXT
    )
  `, (err) => {
    if (err) {
      console.error('❌ 创建 mistake_records 表失败:', err.message);
    } else {
      console.log('✅ mistake_records 表就绪');
    }
  });

  // V2 迁移：为已有表添加新列（如果不存在）
  db.run(`ALTER TABLE mistake_records ADD COLUMN category TEXT`, () => {});
  db.run(`ALTER TABLE mistake_records ADD COLUMN scenario TEXT`, () => {});

  // 创建行动清单表
  db.run(`
    CREATE TABLE IF NOT EXISTS action_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER,
      content TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (record_id) REFERENCES mistake_records(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('❌ 创建 action_items 表失败:', err.message);
    } else {
      console.log('✅ action_items 表就绪');
    }
  });

  // 创建周复盘总结表
  db.run(`
    CREATE TABLE IF NOT EXISTS week_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL,
      essence TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `, (err) => {
    if (err) {
      console.error('❌ 创建 week_reviews 表失败:', err.message);
    } else {
      console.log('✅ week_reviews 表就绪');
    }
  });

  // 创建索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_records_date ON mistake_records(created_at DESC)`, () => {});
  db.run(`CREATE INDEX IF NOT EXISTS idx_actions_record ON action_items(record_id)`, () => {});

  // 等待表创建完成后返回 db 对象
  setTimeout(() => {
    console.log('✅ 数据库初始化完成:', DB_PATH);
  }, 500);

  return db;
}

module.exports = initDB;
