/**
 * 风险规则引擎
 *
 * 纯函数设计，无副作用，可独立于 LLM 运行
 */

import type {
  ExtractedOrder,
  OrderLedger,
  InventoryRecord,
  PriceRecord,
  RiskItem,
  RiskAssessment,
  ChecklistItem,
  HandoverCard,
} from '../types';

/**
 * Demo 基准日 - 固定为 2026-05-24，避免内置 2024 报价全部过期
 * 实际生产环境应使用 new Date()
 */
const DEMO基准日 = new Date('2026-05-24');

/**
 * 运行风险规则引擎
 */
export function runRiskEngine(
  extracted: ExtractedOrder,
  orders: OrderLedger[],
  inventory: InventoryRecord[],
  prices: PriceRecord[]
): RiskAssessment {
  const risks: RiskItem[] = [];

  // 收集所有规则检查结果
  risks.push(...checkInventoryRules(extracted, inventory, orders));
  risks.push(...checkPriceRules(extracted, prices));
  risks.push(...checkComplianceRules(extracted, orders, inventory));

  // 计算综合风险等级
  const overallLevel = calculateOverallLevel(risks);

  // 生成 Checklist
  const checklist = generateChecklist(risks, overallLevel);

  // 生成交接卡片
  const handoverCard = generateHandoverCard(extracted, orders, risks, overallLevel, inventory);

  return {
    overall_risk_level: overallLevel,
    risks,
    checklist,
    handover_card: handoverCard,
  };
}

// ============================================================
// 库存规则
// ============================================================

function checkInventoryRules(
  extracted: ExtractedOrder,
  inventory: InventoryRecord[],
  orders: OrderLedger[]
): RiskItem[] {
  const risks: RiskItem[] = [];

  for (const entity of extracted.entities) {
    const inv = inventory.find(i =>
      i.part_num.toUpperCase() === entity.part_number.toUpperCase()
    );

    if (!inv) {
      risks.push({
        id: `RISK-INV-${entity.part_number}`,
        level: 'HIGH',
        category: '库存风险',
        message: `物料 ${entity.part_number} 在库存台账中未找到`,
        suggestion: '请确认物料型号或联系采购确认库存',
        owner: '采购',
        source: 'RULE',
      });
      continue;
    }

    // 规则 5: 库存数量不足
    if (entity.quantity > inv.total_avail) {
      risks.push({
        id: `RISK-INV-QTY-${entity.part_number}`,
        level: 'HIGH',
        category: '库存风险',
        message: `现货库存不足！需求 ${entity.quantity} 颗，当前可用仅 ${inv.total_avail} 颗`,
        suggestion: '需确认后续到货期或与客户协商分批发货',
        owner: '采购/销售',
        source: 'RULE',
      });
    }

    // 规则 6: 库存未绑定客户（归属风险）
    // 只有当库存绑定了特定客户，且当前订单客户不同时才触发
    if (inv.customer_id) {
      // 检查是否有匹配的订单
      const matchingOrder = orders.find(o =>
        o.customer_id === inv.customer_id
      );
      if (!matchingOrder) {
        risks.push({
          id: `RISK-INV-CUST-${entity.part_number}`,
          level: 'MEDIUM',
          category: '库存归属风险',
          message: `物料 ${entity.part_number} 当前绑定客户 ${inv.customer_id}，可能存在归属争议`,
          suggestion: '请确认库存归属或联系库房确认',
          owner: '销售',
          source: 'RULE',
        });
      }
    }

    // 规则 7: 不可混批检查（修正：支持多种触发条件）
    const hasMixedBatchReq = entity.special_requirements.some(r => r.includes('不可混批'));
    if (hasMixedBatchReq) {
      // 检查 1: 批次信息完全缺失
      if (!inv.batches || inv.batches.length === 0) {
        risks.push({
          id: `RISK-INV-BATCH-EMPTY-${entity.part_number}`,
          level: 'HIGH',
          category: '批次风险',
          message: `客户要求不可混批，但 ${entity.part_number} 批次信息缺失`,
          suggestion: '请联系库房确认批次信息，或与客户沟通是否可接受混批',
          owner: '库房/销售',
          source: 'RULE',
        });
      }
      // 检查 2: 多批次（原逻辑）
      else if (inv.batches.length > 1) {
        risks.push({
          id: `RISK-INV-BATCH-MIX-${entity.part_number}`,
          level: 'HIGH',
          category: '批次风险',
          message: `客户要求不可混批，但 ${entity.part_number} 有 ${inv.batches.length} 个批次`,
          suggestion: '请确认是否可以单独拣货或与客户沟通',
          owner: '库房/销售',
          source: 'RULE',
        });
      }
      // 检查 3: 单批次但数量不足，可能需要从其他批次调货
      else if (inv.batches[0] && inv.batches[0].qty < entity.quantity) {
        risks.push({
          id: `RISK-INV-BATCH-PARTIAL-${entity.part_number}`,
          level: 'MEDIUM',
          category: '批次风险',
          message: `客户要求不可混批，但当前批次仅有 ${inv.batches[0].qty} 颗，需求 ${entity.quantity} 颗`,
          suggestion: '请确认是否可从其他批次调货，或与客户协商',
          owner: '库房/销售',
          source: 'RULE',
        });
      }
    }
  }

  return risks;
}

// ============================================================
// 价格规则
// ============================================================

function checkPriceRules(
  extracted: ExtractedOrder,
  prices: PriceRecord[]
): RiskItem[] {
  const risks: RiskItem[] = [];

  for (const entity of extracted.entities) {
    const priceRecord = prices.find(p =>
      p.part_num.toUpperCase() === entity.part_number.toUpperCase()
    );

    if (!priceRecord) {
      risks.push({
        id: `RISK-PRICE-${entity.part_number}`,
        level: 'MEDIUM',
        category: '价格风险',
        message: `物料 ${entity.part_number} 未找到报价记录`,
        suggestion: '请确认报价或联系销售获取最新报价',
        owner: '销售',
        source: 'RULE',
      });
      continue;
    }

    // 规则 2: 报价过期（使用 Demo 基准日）
    const quoteDate = new Date(priceRecord.quote_date);
    const validUntil = new Date(quoteDate);
    validUntil.setDate(validUntil.getDate() + priceRecord.valid_days);

    if (DEMO基准日 > validUntil) {
      const daysExpired = Math.floor(
        (DEMO基准日.getTime() - validUntil.getTime()) / (1000 * 60 * 60 * 24)
      );
      risks.push({
        id: `RISK-PRICE-EXPIRED-${entity.part_number}`,
        level: 'HIGH',
        category: '价格风险',
        message: `${entity.part_number} 报价已过期 ${daysExpired} 天（基准日: ${DEMO基准日.toLocaleDateString('zh-CN')}），不允许直接报价`,
        suggestion: '需要重新核价，请联系销售经理获取新报价',
        owner: '销售',
        source: 'RULE',
      });
    }

    // 检查价格是否匹配
    if (entity.mentioned_price && entity.mentioned_price !== priceRecord.quoted_price) {
      risks.push({
        id: `RISK-PRICE-MISMATCH-${entity.part_number}`,
        level: 'MEDIUM',
        category: '价格风险',
        message: `沟通价格 $${entity.mentioned_price} 与台账报价 $${priceRecord.quoted_price} 不一致`,
        suggestion: '请确认最终成交价格',
        owner: '销售',
        source: 'RULE',
      });
    }
  }

  return risks;
}

// ============================================================
// 合规规则
// ============================================================

function checkComplianceRules(
  extracted: ExtractedOrder,
  orders: OrderLedger[],
  inventory: InventoryRecord[]
): RiskItem[] {
  const risks: RiskItem[] = [];

  // 查找匹配的订单（根据型号关联）
  const matchedOrders = findMatchingOrders(extracted, orders, inventory);

  // 如果没有匹配的订单，生成明确的"未匹配"风险
  if (matchedOrders.length === 0) {
    if (orders.length === 0) {
      risks.push({
        id: 'RISK-COMP-NO-ORDER',
        level: 'HIGH',
        category: '合规风险',
        message: '未找到订单台账信息，仅基于沟通记录分析',
        suggestion: '请补充订单编号或客户名称',
        owner: '销售助理',
        source: 'RULE',
      });
    } else {
      risks.push({
        id: 'RISK-COMP-NO-MATCH',
        level: 'MEDIUM',
        category: '合规风险',
        message: '无法从沟通记录中匹配到具体订单，请销售补充订单信息',
        suggestion: '请确认订单编号或客户名称',
        owner: '销售',
        source: 'RULE',
      });
    }
  }

  for (const order of matchedOrders) {
    // 规则 3: PO 缺失
    if (!order.has_official_po) {
      risks.push({
        id: `RISK-COMP-NO-PO-${order.order_id}`,
        level: 'HIGH',
        category: '合规风险',
        message: `订单 ${order.order_id} 未收到正式 PO 文件，当前仅为沟通意向，严禁发货`,
        suggestion: '请等待客户发送正式采购订单',
        owner: '销售助理',
        source: 'RULE',
      });
    }

    // 规则 4: 收货地址缺失
    if (!order.address_confirmed) {
      risks.push({
        id: `RISK-COMP-NO-ADDR-${order.order_id}`,
        level: 'HIGH',
        category: '合规风险',
        message: `订单 ${order.order_id} 收货地址未确认，不可发货`,
        suggestion: '请与客户确认收货地址并记录',
        owner: '销售助理',
        source: 'RULE',
      });
    }

    // 规则 1: 标签模板缺失
    const hasLabelReq = extracted.entities.some(e =>
      e.special_requirements.some(r => r.includes('标签'))
    );
    if (hasLabelReq && !order.label_template_available) {
      risks.push({
        id: `RISK-COMP-NO-LABEL-${order.order_id}`,
        level: 'HIGH',
        category: '合规风险',
        message: `订单 ${order.order_id} 客户要求贴专属标签，但系统缺失标签模板文件`,
        suggestion: '联系客户获取标签模板，或确认是否可使用通用标签',
        owner: '销售',
        source: 'RULE',
      });
    }

    // 规则 8: 发货前拍照未确认
    const hasPhotoReq = extracted.entities.some(e =>
      e.special_requirements.some(r => r.includes('拍照'))
    );
    if (hasPhotoReq && !order.photo_before_shipping_confirmed) {
      risks.push({
        id: `RISK-COMP-NO-PHOTO-${order.order_id}`,
        level: 'MEDIUM',
        category: '合规风险',
        message: `订单 ${order.order_id} 客户要求发货前拍照，但未确认执行状态`,
        suggestion: '请与库房确认拍照流程',
        owner: '库房',
        source: 'RULE',
      });
    }

    // 规则 9: 订单状态检查
    if (order.status === 'PENDING') {
      risks.push({
        id: `RISK-COMP-PENDING-${order.order_id}`,
        level: 'MEDIUM',
        category: '合规风险',
        message: `订单 ${order.order_id} 状态为待确认，需先完成订单确认流程`,
        suggestion: '请先确认订单状态',
        owner: '销售',
        source: 'RULE',
      });
    }

    if (order.status === 'CANCELLED') {
      risks.push({
        id: `RISK-COMP-CANCELLED-${order.order_id}`,
        level: 'HIGH',
        category: '合规风险',
        message: `订单 ${order.order_id} 已取消，不可发货`,
        suggestion: '请核实订单状态',
        owner: '销售',
        source: 'RULE',
      });
    }

    // 规则 10: 销售负责人缺失
    if (!order.sales_rep || order.sales_rep.trim() === '') {
      risks.push({
        id: `RISK-COMP-NO-SALES-${order.order_id}`,
        level: 'MEDIUM',
        category: '合规风险',
        message: `订单 ${order.order_id} 销售负责人缺失，需要补充责任人`,
        suggestion: '请指定销售负责人',
        owner: '销售经理',
        source: 'RULE',
      });
    }
  }

  return risks;
}

/**
 * 查找匹配的订单（根据型号关联）
 */
function findMatchingOrders(
  extracted: ExtractedOrder,
  orders: OrderLedger[],
  inventory: InventoryRecord[]
): OrderLedger[] {
  const matchedOrderIds = new Set<string>();

  for (const entity of extracted.entities) {
    // 通过库存的 customer_id 关联
    const inv = inventory.find(i =>
      i.part_num.toUpperCase() === entity.part_number.toUpperCase()
    );

    if (inv?.customer_id) {
      const matchingOrder = orders.find(o =>
        o.customer_id === inv.customer_id
      );
      if (matchingOrder) {
        matchedOrderIds.add(matchingOrder.order_id);
      }
    }
  }

  return orders.filter(o => matchedOrderIds.has(o.order_id));
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 计算综合风险等级
 */
function calculateOverallLevel(
  risks: RiskItem[]
): 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE' {
  if (risks.some(r => r.level === 'HIGH')) {
    return 'HIGH';
  }
  if (risks.some(r => r.level === 'MEDIUM')) {
    return 'MEDIUM';
  }
  if (risks.some(r => r.level === 'LOW')) {
    return 'LOW';
  }
  return 'SAFE';
}

/**
 * 生成 Checklist
 */
function generateChecklist(
  risks: RiskItem[],
  overallLevel: string
): ChecklistItem[] {
  const checklist: ChecklistItem[] = [];

  // 基础 Checklist 项
  checklist.push({
    id: 'CL-001',
    text: '确认沟通记录中的订单信息',
    status: 'DONE',
    priority: 'MEDIUM',
  });

  // 根据风险生成待办项
  for (const risk of risks) {
    if (risk.level === 'HIGH' || risk.level === 'MEDIUM') {
      checklist.push({
        id: `CL-${risk.id}`,
        text: `[${risk.category}] ${risk.suggestion}`,
        status: 'PENDING',
        priority: risk.level === 'HIGH' ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  // 如果没有高风险，添加发货建议
  if (overallLevel !== 'HIGH') {
    checklist.push({
      id: 'CL-SHIP',
      text: '确认无高风险后可安排发货',
      status: overallLevel === 'SAFE' ? 'DONE' : 'PENDING',
      priority: 'LOW',
    });
  } else {
    checklist.push({
      id: 'CL-SHIP',
      text: '存在高风险，暂不建议发货',
      status: 'BLOCKED',
      priority: 'HIGH',
    });
  }

  return checklist;
}

/**
 * 生成交接卡片（增强版）
 */
function generateHandoverCard(
  extracted: ExtractedOrder,
  orders: OrderLedger[],
  risks: RiskItem[],
  overallLevel: string,
  inventory?: InventoryRecord[]
): HandoverCard {
  // 优先使用精准关联的订单
  let matchedOrder: OrderLedger | undefined;
  if (inventory) {
    const matchedOrders = findMatchingOrders(extracted, orders, inventory);
    matchedOrder = matchedOrders[0];
  }

  const items = extracted.entities.map(entity => {
    const riskFlags = risks
      .filter(r =>
        r.message.includes(entity.part_number) ||
        r.category.includes('库存') ||
        r.category.includes('批次')
      )
      .map(r => r.message.substring(0, 50));

    return {
      part_number: entity.part_number,
      quantity: entity.quantity,
      special_requirements: entity.special_requirements,
      risk_flags: riskFlags,
    };
  });

  const highRisks = risks.filter(r => r.level === 'HIGH');
  const riskSummary = highRisks.length > 0
    ? `存在 ${highRisks.length} 项高危风险，需处理后方可发货`
    : risks.length > 0
    ? `存在 ${risks.length} 项风险，建议确认后发货`
    : '未发现风险，可正常发货';

  const actionItems = risks
    .filter(r => r.level === 'HIGH')
    .map(r => `${r.owner}: ${r.suggestion}`);

  const missingInfo = extracted.identified_missing_info;

  // 判断是否建议发货
  const shouldShip = overallLevel !== 'HIGH';
  const shipConclusion = shouldShip
    ? '条件满足，建议发货'
    : '存在高风险，暂不建议发货，需先解决上述问题';

  return {
    order_id: matchedOrder?.order_id || '待创建（需补充订单信息）',
    customer_name: matchedOrder?.customer_name || '待确认',
    sales_rep: matchedOrder?.sales_rep || '待指定',
    handler: '销售助理',
    items,
    risk_summary: riskSummary,
    action_items: actionItems,
    missing_info: missingInfo,
    should_ship: shouldShip,
    ship_conclusion: shipConclusion,
    generated_at: DEMO基准日.toISOString(),
  };
}
