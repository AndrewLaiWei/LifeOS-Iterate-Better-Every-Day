// Vercel Serverless Function: /api/mistakes
// 错题保存/查询接口（Vercel 云版本 - 无持久数据库）

module.exports = async (req, res) => {
  // POST: 保存错题
  if (req.method === 'POST') {
    const { raw_text } = req.body;
    // Vercel 无持久存储，返回模拟 ID
    const fakeId = Date.now();
    console.log('Vercel 收到错题保存请求:', raw_text ? raw_text.substring(0, 50) + '...' : '(空)');
    return res.json({
      id: fakeId,
      message: '错题已接收（Vercel云版本暂不支持持久存储）',
    });
  }

  // GET: 查询错题列表
  if (req.method === 'GET') {
    return res.json([]);
  }

  // 其他方法
  res.status(405).json({ error: '请使用 GET 或 POST 方法' });
};
