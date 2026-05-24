export interface LLMExtractedOrder {
  customer_name?: string | null;
  customer_id?: string | null;
  order_id?: string | null;
  product_model?: string | null;
  quantity?: number | null;
  delivery_deadline?: string | null;
  urgency?: 'LOW' | 'NORMAL' | 'HIGH';
  label_required?: boolean | null;
  label_template_uploaded?: boolean | null;
  mixed_batch_allowed?: boolean | null;
  po_received?: boolean | null;
  shipping_address_confirmed?: boolean | null;
  special_requirements?: string[];
  raw_evidence?: Record<string, string>;
}

export interface Env {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
}

/**
 * 清理并尝试解析 LLM 返回的 JSON
 */
export function tryCleanAndParseJSON(text: string): unknown {
  let cleaned = text.trim();
  // 移除 markdown 代码块标记如 ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * 调用 MiMo LLM API 抽取非结构化沟通记录字段
 */
export async function callMimoLLM(chatRecord: string, env: Env): Promise<{
  success: boolean;
  data?: LLMExtractedOrder;
  reason?: string;
  model_used?: string;
}> {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return { success: false, reason: 'LLM_API_KEY 未配置，自动跳过' };
  }

  const baseUrl = (env.LLM_BASE_URL || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '');
  const model = env.LLM_MODEL || 'mimo-7b';
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 8000);

  const url = `${baseUrl}/chat/completions`;

  const systemPrompt = `你是 B2B 电子元器件订单字段抽取器。请从用户输入的非结构化沟通记录中精确抽取订单相关字段。
你只负责字段抽取，不要判断风险，不要判断是否发货，不要生成交接卡片。
必须只输出 JSON 对象，不要包含任何 Markdown 格式包裹（不要用 \`\`\`json 标记），不要有任何前言或后记。

输出 JSON 的 schema 必须如下：
{
  "customer_name": string | null, // 客户名称，如未提及则为 null
  "customer_id": string | null, // 客户 ID，如未提及则为 null
  "order_id": string | null, // 订单 ID，如未提及则为 null
  "product_model": string | null, // 芯片/产品型号，如未提及则为 null
  "quantity": number | null, // 数量，必须是整数数字，如未提及则为 null
  "delivery_deadline": string | null, // 期望交期，如“明天”、“后天”、“下周”等，如未提及则为 null
  "urgency": "LOW" | "NORMAL" | "HIGH", // 紧急程度，根据语气和交期判断，如未提及默认为 "NORMAL"
  "label_required": boolean | null, // 是否需要贴客户自己的标签，如未提及则为 null
  "label_template_uploaded": boolean | null, // 客户标签模板是否已上传/可用，如未提及则为 null
  "mixed_batch_allowed": boolean | null, // 是否允许混批，如未提及默认为 true
  "po_received": boolean | null, // 正式 PO 是否已收到，如未提及则为 null
  "shipping_address_confirmed": boolean | null, // 收货地址是否已确认，如未提及则为 null
  "special_requirements": string[], // 特殊要求数组，如“不能混批”、“外箱贴标签”等，无要求则为空数组
  "raw_evidence": { [key: string]: string } // 抽取的证据对，key 为抽取的字段名，value 为原句中的依据
}

注意对否定语义要高度谨慎，例如：
- “不需要标签”、“不用标签” -> label_required: false
- “可以分批”、“分批也可以” -> mixed_batch_allowed: true
- “不能混批”、“不可混批” -> mixed_batch_allowed: false
- “PO已收到” -> po_received: true
- “未收到PO”、“PO还没到” -> po_received: false
- “地址已确认” -> shipping_address_confirmed: true
- “地址未确认” -> shipping_address_confirmed: false`;

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: chatRecord }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      return { success: false, reason: `API 返回非 2xx 状态码: ${res.status}`, model_used: model };
    }

    interface ChatCompletionResponse {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    }

    const resJson = (await res.json()) as ChatCompletionResponse;
    const content = resJson?.choices?.[0]?.message?.content;
    if (!content) {
      return { success: false, reason: 'API 返回的 choices 内容为空', model_used: model };
    }

    try {
      const parsedData = tryCleanAndParseJSON(content);
      return { success: true, data: parsedData as LLMExtractedOrder, model_used: model };
    } catch (parseErr) {
      const error = parseErr as Error;
      return { success: false, reason: `JSON 解析失败: ${error.message}`, model_used: model };
    }

  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') {
      return { success: false, reason: `模型调用超时（超过 ${timeoutMs}ms）`, model_used: model };
    }
    return { success: false, reason: `调用接口异常: ${error.message}`, model_used: model };
  } finally {
    clearTimeout(timeoutId);
  }
}
