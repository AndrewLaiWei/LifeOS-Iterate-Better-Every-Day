// 共用工具函数（Vercel Serverless 用）

function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1)); // 周一切到周一
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

module.exports = { getWeekKey, getWeekNum, getColorForType };
