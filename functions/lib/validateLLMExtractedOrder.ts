import type { LLMExtractedOrder } from './callMimoLLM';

/**
 * 校验 LLM 抽取出来的订单结构
 */
export function validateLLMExtractedOrder(data: unknown): {
  ok: boolean;
  value?: LLMExtractedOrder;
  reason?: string;
} {
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '数据不是有效的 JSON 对象' };
  }

  const obj = data as Partial<LLMExtractedOrder> & Record<string, unknown>;

  // 7. 模型返回了风险判断字段，判定为失败
  if (
    'overall_risk_level' in obj ||
    'should_ship' in obj ||
    'risks' in obj ||
    'ship_conclusion' in obj
  ) {
    return { ok: false, reason: '模型越权返回了风险评估或发货结论字段' };
  }

  // 5. product_model 明显为空
  if (!obj.product_model || typeof obj.product_model !== 'string' || obj.product_model.trim() === '') {
    return { ok: false, reason: 'product_model 缺失或为空' };
  }

  // 3. quantity 不是数字判定为失败
  if (obj.quantity !== undefined && obj.quantity !== null) {
    if (typeof obj.quantity !== 'number' || isNaN(obj.quantity)) {
      return { ok: false, reason: 'quantity 字段必须是有效的数字' };
    }
  }

  // 4. 布尔字段不是 boolean 判定为失败
  const boolFields = [
    'label_required',
    'label_template_uploaded',
    'mixed_batch_allowed',
    'po_received',
    'shipping_address_confirmed'
  ];
  for (const field of boolFields) {
    const val = obj[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'boolean') {
        return { ok: false, reason: `布尔字段 ${field} 必须是真实的 boolean 值` };
      }
    }
  }

  return { ok: true, value: obj as unknown as LLMExtractedOrder };
}
