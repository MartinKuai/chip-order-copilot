/**
 * 从聊天记录中抽取订单信息
 *
 * 支持否定语义识别，避免误判
 */

import type { ExtractedOrder, ExtractedEntity } from '../types';

/**
 * 从聊天文本中抽取订单字段
 */
export function extractOrderInfo(chatRecord: string): ExtractedOrder {
  const entities = extractEntities(chatRecord);
  const urgencyLevel = detectUrgency(chatRecord);
  const missingInfo = detectMissingInfo(chatRecord);

  return {
    entities,
    urgency_level: urgencyLevel,
    identified_missing_info: missingInfo,
    raw_summary: generateSummary(entities, urgencyLevel, missingInfo),
  };
}

/**
 * 抽取物料实体（型号 + 数量 + 特殊要求）
 */
function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // 型号匹配：字母+数字组合，如 A133, B256, MCU-32, XT208
  const partPattern = /([A-Za-z][A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*)/g;
  const quantityPattern = /(\d+)\s*(颗|pcs|pcs\.|片|个|只|卷|盘)/g;

  // 提取所有型号
  const partMatches = [...text.matchAll(partPattern)];
  const quantityMatches = [...text.matchAll(quantityPattern)];

  // 去重型号（排除常见非型号词汇）
  const excludeWords = ['LINE', '微信', '企微', '助理', '销售', '客户', '经理'];
  const uniqueParts = [...new Set(
    partMatches
      .map(m => (m[1] ?? '').toUpperCase())
      .filter(p => p.length > 0 && !excludeWords.includes(p))
  )];

  // 对每个型号尝试关联数量
  for (const part of uniqueParts) {
    // 从上下文找数量（型号附近 100 字符内）
    let quantity = 1000; // 默认数量
    const partIndex = text.toUpperCase().indexOf(part);
    if (partIndex !== -1) {
      const context = text.substring(Math.max(0, partIndex - 20), partIndex + 100);
      const qtyMatch = context.match(/(\d+)\s*(颗|pcs|pcs\.|片|个|只)/);
      if (qtyMatch?.[1]) {
        quantity = parseInt(qtyMatch[1], 10);
      }
    }

    // 检测特殊要求（带否定语义）
    const specialReqs = detectSpecialRequirements(text);

    entities.push({
      part_number: part,
      quantity,
      special_requirements: specialReqs,
      requested_delivery: detectDeliveryRequest(text),
    });
  }

  // 如果没找到型号，尝试提取数字+单位作为数量
  if (entities.length === 0 && quantityMatches.length > 0) {
    const firstQty = quantityMatches[0];
    const qtyValue = firstQty?.[1] ? parseInt(firstQty[1], 10) : 0;
    if (qtyValue > 0) {
      entities.push({
        part_number: 'UNKNOWN',
        quantity: qtyValue,
        special_requirements: detectSpecialRequirements(text),
        requested_delivery: detectDeliveryRequest(text),
      });
    }
  }

  return entities;
}

/**
 * 检测特殊要求（带否定语义识别）
 *
 * 规则：
 * 1. 先检测否定模式（不需要、不用、没有、无、不要）
 * 2. 再检测肯定模式（需要、要、必须）
 * 3. 如果否定模式在肯定模式之前或距离更近，则不添加
 */
function detectSpecialRequirements(text: string): string[] {
  const requirements: string[] = [];

  // 标签相关 - 修正否定语义
  const hasLabelReq = detectLabelRequirement(text);
  if (hasLabelReq) {
    requirements.push('贴客户标签');
  }

  // 混批相关 - 修正否定语义
  const hasMixBatchReq = detectMixBatchRequirement(text);
  if (hasMixBatchReq === false) {
    requirements.push('不可混批');
  }

  // 包装相关
  if (/原包装|不拆包|原厂包装/i.test(text) && !/不.*原包装|不用.*原包装/.test(text)) {
    requirements.push('保持原包装');
  }

  // 拍照相关
  if (/拍照|照片|拍.*确认/i.test(text) && !/不.*拍照|不用.*拍照/.test(text)) {
    requirements.push('发货前拍照');
  }

  return requirements;
}

/**
 * 检测标签需求（带否定语义）
 *
 * 正确识别：
 * - "需要贴标签" → true
 * - "要贴他们自己的标签" → true
 * - "不需要特殊标签" → false
 * - "不用贴标签" → false
 * - "无标签要求" → false
 */
function detectLabelRequirement(text: string): boolean {
  // 否定模式（不需要、不用、没有、无、不要）
  const negativePatterns = [
    /不\s*需要.*标签/,
    /不\s*用.*标签/,
    /没\s*有.*标签/,
    /无.*标签/,
    /不\s*要.*标签/,
    /不需要\s*特殊\s*标签/,
    /不用\s*贴/,
    /没有\s*标签/,
  ];

  for (const pattern of negativePatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  // 肯定模式
  const positivePatterns = [
    /需要.*标签/,
    /要.*标签/,
    /贴.*标签/,
    /标签.*要求/,
    /有.*标签/,
  ];

  for (const pattern of positivePatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * 检测混批需求（带否定语义）
 *
 * 返回值：
 * - true: 可以混批
 * - false: 不可混批
 * - null: 未明确
 */
function detectMixBatchRequirement(text: string): boolean | null {
  // 不可混批的明确表述
  const negativePatterns = [
    /不能\s*混批/,
    /不可\s*混批/,
    /不\s*允许\s*混批/,
    /禁止\s*混批/,
    /分开\s*发/,
    /单独\s*发/,
    /不要\s*混/,
  ];

  for (const pattern of negativePatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  // 可以混批的明确表述
  const positivePatterns = [
    /可以\s*混批/,
    /允许\s*混批/,
    /能\s*混/,
    /不\s*用\s*分开/,
    /可以\s*分批/,
    /可以分批发/,
    /分批发\s*也\s*可以/,
    /分批\s*也\s*行/,
  ];

  for (const pattern of positivePatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return null;
}

/**
 * 检测紧急程度
 */
function detectUrgency(text: string): 'NORMAL' | 'HIGH' | 'CRITICAL' {
  // 非紧急表述
  const normalPatterns = [
    /不\s*急/,
    /可以\s*等/,
    /下周\s*也\s*可以/,
    /不\s*着急/,
    /慢慢\s*来/,
  ];

  for (const pattern of normalPatterns) {
    if (pattern.test(text)) {
      return 'NORMAL';
    }
  }

  // 高紧急
  if (/急|加急|urgent|ASAP|马上|尽快|今天|明天/i.test(text)) {
    return 'HIGH';
  }

  // 非常紧急
  if (/非常急|特急|crisis/i.test(text)) {
    return 'CRITICAL';
  }

  return 'NORMAL';
}

/**
 * 检测交期要求
 */
function detectDeliveryRequest(text: string): string | undefined {
  const patterns = [
    /明天/,
    /后天/,
    /今天/,
    /(\d+)\s*天内/,
    /本周/,
    /下周/,
    /尽快/,
    /马上/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

/**
 * 检测缺失信息（带肯定语义识别）
 *
 * 正确识别：
 * - "PO 已收到" → 不标记 PO 缺失
 * - "地址已确认" → 不标记地址缺失
 * - "还没有 PO" → 标记 PO 缺失
 */
function detectMissingInfo(text: string): string[] {
  const missing: string[] = [];

  // PO 检查
  const poConfirmed = /PO\s*已收到|PO\s*已确认|收到.*PO|有.*PO|正式.*PO|采购单.*收到/i.test(text);
  const poMissing = /还没.*PO|没有.*PO|PO.*还没|未收到.*PO|缺.*PO/i.test(text);

  if (!poConfirmed && !poMissing) {
    // 未明确提及，根据上下文判断
    if (!/PO|采购单|正式订单/i.test(text)) {
      missing.push('正式PO');
    }
  } else if (poMissing) {
    missing.push('正式PO');
  }

  // 地址检查
  const addrConfirmed = /地址.*已确认|已.*确认.*地址|地址.*确认|收货.*确认|确认.*地址|地址已|已.*地址/i.test(text);
  const addrMissing = /还没.*地址|没有.*地址|地址.*没|未.*地址|缺.*地址/i.test(text);

  if (!addrConfirmed && !addrMissing) {
    if (!/地址|收货|送货/i.test(text)) {
      missing.push('收货地址');
    }
  } else if (addrMissing) {
    missing.push('收货地址');
  }

  // 联系方式检查
  const contactConfirmed = /联系人.*确认|已.*联系|有.*联系/i.test(text);
  if (!contactConfirmed && !/联系人|电话|手机/i.test(text)) {
    missing.push('收货人联系方式');
  }

  // 标签模板检查（如果需要标签）
  const hasLabelReq = detectLabelRequirement(text);
  if (hasLabelReq && !/模板.*已|已.*模板|模板.*有|有.*模板/i.test(text)) {
    missing.push('标签模板');
  }

  return missing;
}

/**
 * 生成摘要
 */
function generateSummary(
  entities: ExtractedEntity[],
  urgency: string,
  missingInfo: string[]
): string {
  const parts = entities.map(
    e => `${e.part_number} ${e.quantity}颗`
  ).join('，');

  const urgencyText = urgency === 'HIGH' ? '紧急' : urgency === 'CRITICAL' ? '非常紧急' : '正常';

  const partsText = parts || '未识别型号';
  const missingText = missingInfo.length > 0 ? `，缺失：${missingInfo.join('、')}` : '';

  return `需求：${partsText}，交期：${urgencyText}${missingText}`;
}
