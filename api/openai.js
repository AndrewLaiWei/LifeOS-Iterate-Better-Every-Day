// 共用 OpenAI 客户端（Vercel Serverless 用）
const OpenAI = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const ai = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

module.exports = ai;
