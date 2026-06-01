#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工作复盘 + 深度分析助手（增强版）
- 时间自动取系统当前时间
- 用户账号自动添加（通过环境变量或参数传入）
- 每条消息自动编号（基于本地文件持久化）
"""

import json
import os
import datetime
import sys
from typing import Dict, Any

# ==================== 配置区域 ====================
API_KEY = os.getenv("LLM_API_KEY", "你的API_KEY")
BASE_URL = os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
MODEL_NAME = os.getenv("LLM_MODEL", "gpt-3.5-turbo")

# 用户账号配置：优先从环境变量取，否则要求手动输入
USER_ACCOUNT = os.getenv("USER_ACCOUNT", "")
if not USER_ACCOUNT:
    USER_ACCOUNT = input("请输入你的用户账号（用于记录）: ").strip()
    if not USER_ACCOUNT:
        USER_ACCOUNT = "anonymous"

# 消息计数器文件路径
COUNTER_FILE = "msg_counter.txt"

# ==================== 辅助函数 ====================
def get_next_msg_id() -> int:
    """获取下一条消息的自增编号（持久化）"""
    if os.path.exists(COUNTER_FILE):
        with open(COUNTER_FILE, "r") as f:
            try:
                last_id = int(f.read().strip())
            except:
                last_id = 0
    else:
        last_id = 0
    next_id = last_id + 1
    with open(COUNTER_FILE, "w") as f:
        f.write(str(next_id))
    return next_id

def get_current_time() -> str:
    """获取当前时间，格式：YYYY-MM-DD HH:MM:SS"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ==================== LLM 调用封装 ====================
from openai import OpenAI

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

def call_llm(system_prompt: str, user_content: str = "") -> str:
    messages = [{"role": "system", "content": system_prompt}]
    if user_content:
        messages.append({"role": "user", "content": user_content})
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=0.2,
    )
    return response.choices[0].message.content

# ==================== 工作复盘助手 ====================
def work_review_assistant(user_input: str, msg_id: int, user_account: str, occur_time: str) -> Dict[str, Any]:
    """
    整理复盘内容，自动附加元数据
    返回的 JSON 包含原有5字段 + 新增的 msg_id, user_account, time
    """
    system_prompt = f"""你是一名工作复盘助手。
任务：将用户输入内容整理为以下五个字段：
1. 时间（用户事件发生的时间，如果用户没有提供，请填“未提及”）
2. 场景
3. 发生事件
4. 失误点
5. 造成后果

要求：
- 保留用户提供的全部信息，不添加任何虚构内容。
- 每个字段若无明确信息，填“未提及”。
- 语言简洁，直接输出一个JSON对象，键名分别为：time, scene, event, mistake, consequence。
- 不要输出任何解释、标记或额外文字。

注意：用户输入中可能包含时间信息，请尽量提取到 time 字段。如果完全没有，则填“未提及”。
"""
    resp = call_llm(system_prompt, user_input)
    resp = resp.strip().strip("```json").strip("```").strip()
    review = json.loads(resp)
    
    # 自动添加元数据（覆盖或补充）
    review["msg_id"] = msg_id
    review["user_account"] = user_account
    review["upload_time"] = occur_time   # 系统上传时间
    return review

# ==================== 深度分析助手 ====================
def deep_analysis_assistant(review: Dict[str, Any]) -> Dict[str, Any]:
    """基于复盘内容做深度分析（保持原有逻辑）"""
    system_prompt = f"""你是一名专业的复盘分析专家，擅长 5WHY 分析法、PDCA、第一性原理、行为心理学。

已知复盘信息：
- 时间：{review.get('time', '未提及')}
- 场景：{review.get('scene', '未提及')}
- 发生事件：{review.get('event', '未提及')}
- 失误点：{review.get('mistake', '未提及')}
- 造成后果：{review.get('consequence', '未提及')}

请基于以上信息，按以下结构输出分析结果（JSON 格式，键名固定）：
{{
  "surface_causes": "表面原因（1-2句话）",
  "deep_causes": "深层原因（需包含至少3层5WHY推导，并点出可能的心理或认知因素）",
  "capability_gaps": "能力缺口（若信息不足，写待补充项）",
  "system_issues": "系统问题（从流程/工具/制度/环境角度）",
  "improvement_plan": "改进方案（按 PDCA 列出：Plan, Do, Check, Act，每个阶段1-2点）"
}}

要求：
- 不添加虚构信息。若推断必须有依据，请在括号内标注“推断”。
- 语言简洁、专业、可执行。
- 输出仅 JSON，不要额外解释。
"""
    resp = call_llm(system_prompt)
    resp = resp.strip().strip("```json").strip("```").strip()
    return json.loads(resp)

# ==================== 主流程 ====================
def main():
    print("=" * 60)
    print("工作复盘 + 深度分析助手（自动记录时间/用户/编号）")
    print(f"当前用户：{USER_ACCOUNT}")
    print("请输入你的复盘内容（描述发生了什么失误、后果等）")
    print("注意：无需手动输入时间、用户、编号，系统会自动添加。")
    print("输入完成后按 Ctrl+D (Mac/Linux) 或 Ctrl+Z 回车 (Windows) 结束")
    print("=" * 60)
    
    lines = []
    try:
        while True:
            line = input()
            lines.append(line)
    except EOFError:
        pass
    
    user_input = "\n".join(lines)
    if not user_input.strip():
        print("未输入任何内容，退出。")
        return
    
    # 自动生成元数据
    msg_id = get_next_msg_id()
    upload_time = get_current_time()
    
    print(f"\n消息编号：{msg_id} | 上传时间：{upload_time}")
    print("正在整理复盘信息...")
    
    try:
        review = work_review_assistant(user_input, msg_id, USER_ACCOUNT, upload_time)
        print("\n【复盘结果（含自动元数据）】")
        print(json.dumps(review, ensure_ascii=False, indent=2))
        print("\n正在深度分析...")
        analysis = deep_analysis_assistant(review)
        print("\n【深度分析报告】")
        print(json.dumps(analysis, ensure_ascii=False, indent=2))
        
        # 可选：将完整记录保存到文件
        full_record = {
            "review": review,
            "analysis": analysis
        }
        with open(f"review_{msg_id}.json", "w", encoding="utf-8") as f:
            json.dump(full_record, f, ensure_ascii=False, indent=2)
        print(f"\n完整记录已保存至 review_{msg_id}.json")
        
    except Exception as e:
        print(f"出错：{e}")
        print("请检查 API 配置或网络连接。")

if __name__ == "__main__":
    main()