// Vercel Serverless Function: /api/health
// 健康检查接口

module.exports = async (req, res) => {
  res.json({
    status: 'ok',
    message: 'LifeOS 云端 API 运行中!',
    turso: process.env.TURSO_DATABASE_URL ? '已配置' : '未配置',
    llm: process.env.LLM_API_KEY ? '已配置' : '未配置',
    timestamp: new Date().toISOString(),
  });
};
