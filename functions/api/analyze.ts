/**
 * Cloudflare Pages Functions - 分析接口
 *
 * POST /api/analyze
 *
 * 复用本地分析链路，无 LLM 时执行规则引擎
 */

/**
 * 安全解析布尔值
 */
function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  return Boolean(value);
}

import { callMimoLLM } from '../lib/callMimoLLM';
import { validateLLMExtractedOrder } from '../lib/validateLLMExtractedOrder';

interface Env {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
}

interface RequestBody {
  chat_record?: string;
  message?: string;
  data_source?: {
    type?: 'BUILTIN' | 'CSV' | 'JSON';
    scenario_id?: string;
    orders?: OrderLedger[];
    inventory?: InventoryRecord[];
    prices?: PriceRecord[];
    flat_data?: Record<string, unknown>[];
  };
  mock_mode?: boolean;
}

interface OrderLedger {
  order_id: string;
  customer_id: string;
  customer_name: string;
  sales_rep: string;
  has_official_po: boolean;
  address_confirmed: boolean;
  label_template_available: boolean;
  allow_mix_batch: boolean;
  status: string;
}

interface InventoryRecord {
  part_num: string;
  total_avail: number;
  batches: { batch_no: string; qty: number }[];
  customer_id?: string;
  last_updated?: string;
}

interface PriceRecord {
  part_num: string;
  customer_id: string;
  quoted_price: number;
  currency: string;
  quote_date: string;
  valid_days: number;
  min_qty: number;
}

/**
 * 从聊天记录中抽取订单字段（纯正则，无 LLM）
 */
function extractOrderInfo(chatRecord: string) {
  const entities: Array<{
    part_number: string;
    quantity: number;
    special_requirements: string[];
    requested_delivery?: string;
  }> = [];

  // 型号匹配
  const partPattern = /([A-Za-z][A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*)/g;
  const excludeWords = ['LINE', '微信', '企微', '助理', '销售', '客户', '经理'];
  const partMatches = [...chatRecord.matchAll(partPattern)];
  const uniqueParts = [...new Set(
    partMatches
      .map(m => (m[1] ?? '').toUpperCase())
      .filter(p => p.length > 0 && !excludeWords.includes(p))
  )];

  for (const part of uniqueParts) {
    let quantity = 1000;
    const partIndex = chatRecord.toUpperCase().indexOf(part);
    if (partIndex !== -1) {
      const context = chatRecord.substring(Math.max(0, partIndex - 20), partIndex + 100);
      const qtyMatch = context.match(/(\d+)\s*(颗|pcs|片|个|只)/);
      if (qtyMatch?.[1]) {
        quantity = parseInt(qtyMatch[1], 10);
      }
    }

    const specialReqs: string[] = [];

    // 标签检测（带否定语义）
    const negativePatterns = [/不\s*需要.*标签/, /不\s*用.*标签/, /没\s*有.*标签/, /无.*标签/, /不\s*要.*标签/];
    const hasNegativeLabel = negativePatterns.some(p => p.test(chatRecord));
    if (!hasNegativeLabel && /需要.*标签|要.*标签|贴.*标签|标签.*要求/.test(chatRecord)) {
      specialReqs.push('贴客户标签');
    }

    // 混批检测（带否定语义）
    const negativeBatch = [/不能\s*混批/, /不可\s*混批/, /不.*允许.*混批/, /分开\s*发/, /单独\s*发/];
    const positiveBatch = [/可以\s*混批/, /可以\s*分批/, /分批.*可以/, /分批.*也行/];
    const hasNegativeBatch = negativeBatch.some(p => p.test(chatRecord));
    const hasPositiveBatch = positiveBatch.some(p => p.test(chatRecord));
    if (hasNegativeBatch) {
      specialReqs.push('不可混批');
    } else if (!hasPositiveBatch && /混批/.test(chatRecord)) {
      // 默认不添加
    }

    // 交期检测
    let requestedDelivery: string | undefined;
    if (/明天/.test(chatRecord)) requestedDelivery = '明天';
    else if (/后天/.test(chatRecord)) requestedDelivery = '后天';
    else if (/尽快|马上/.test(chatRecord)) requestedDelivery = '尽快';
    else if (/下周/.test(chatRecord)) requestedDelivery = '下周';

    entities.push({
      part_number: part,
      quantity,
      special_requirements: specialReqs,
      requested_delivery: requestedDelivery,
    });
  }

  // 紧急程度
  let urgencyLevel: 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL';
  if (/不\s*急|可以\s*等|下周/.test(chatRecord)) {
    urgencyLevel = 'NORMAL';
  } else if (/急|加急|明天|尽快|马上/.test(chatRecord)) {
    urgencyLevel = 'HIGH';
  } else if (/非常急|特急/.test(chatRecord)) {
    urgencyLevel = 'CRITICAL';
  }

  // 缺失信息检测
  const missingInfo: string[] = [];
  const poConfirmed = /PO\s*已收到|PO\s*已确认|收到.*PO|有.*PO|正式.*PO/i.test(chatRecord);
  const poMissing = /还没.*PO|没有.*PO|PO.*还没|未收到.*PO/i.test(chatRecord);
  if (!poConfirmed && !poMissing && !/PO|采购单/.test(chatRecord)) {
    missingInfo.push('正式PO');
  } else if (poMissing) {
    missingInfo.push('正式PO');
  }

  const addrConfirmed = /地址.*已确认|已.*确认.*地址|地址已|已.*地址/i.test(chatRecord);
  const addrMissing = /还没.*地址|没有.*地址|地址.*没|未.*地址/i.test(chatRecord);
  if (!addrConfirmed && !addrMissing && !/地址|收货/.test(chatRecord)) {
    missingInfo.push('收货地址');
  } else if (addrMissing) {
    missingInfo.push('收货地址');
  }

  return {
    entities,
    urgency_level: urgencyLevel,
    identified_missing_info: missingInfo,
    raw_summary: entities.length > 0
      ? `需求：${entities.map(e => `${e.part_number} ${e.quantity}颗`).join('，')}`
      : '未识别到明确的订单信息',
  };
}

/**
 * 查找匹配的订单（根据型号关联）
 */
function findMatchingOrders(
  extracted: ReturnType<typeof extractOrderInfo>,
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

/**
 * 运行风险规则引擎
 */
function runRiskEngine(
  extracted: ReturnType<typeof extractOrderInfo>,
  orders: OrderLedger[],
  inventory: InventoryRecord[],
  prices: PriceRecord[]
) {
  const risks: Array<{
    id: string;
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;
    message: string;
    suggestion: string;
    owner: string;
    source: string;
  }> = [];

  const DEMO基准日 = new Date('2026-05-24');

  for (const entity of extracted.entities) {
    const inv = inventory.find(i => i.part_num.toUpperCase() === entity.part_number.toUpperCase());

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

    // 库存不足
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

    // 批次风险
    const hasMixedBatchReq = entity.special_requirements.some(r => r.includes('不可混批'));
    if (hasMixedBatchReq) {
      if (!inv.batches || inv.batches.length === 0) {
        risks.push({
          id: `RISK-INV-BATCH-${entity.part_number}`,
          level: 'HIGH',
          category: '批次风险',
          message: `客户要求不可混批，但 ${entity.part_number} 批次信息缺失`,
          suggestion: '请联系库房确认批次信息',
          owner: '库房/销售',
          source: 'RULE',
        });
      } else if (inv.batches.length > 1) {
        risks.push({
          id: `RISK-INV-BATCH-${entity.part_number}`,
          level: 'HIGH',
          category: '批次风险',
          message: `客户要求不可混批，但 ${entity.part_number} 有 ${inv.batches.length} 个批次`,
          suggestion: '请确认是否可以单独拣货',
          owner: '库房/销售',
          source: 'RULE',
        });
      }
    }
  }

  // 价格规则
  for (const entity of extracted.entities) {
    const priceRecord = prices.find(p => p.part_num.toUpperCase() === entity.part_number.toUpperCase());
    if (!priceRecord) {
      risks.push({
        id: `RISK-PRICE-${entity.part_number}`,
        level: 'MEDIUM',
        category: '价格风险',
        message: `物料 ${entity.part_number} 未找到报价记录`,
        suggestion: '请确认报价',
        owner: '销售',
        source: 'RULE',
      });
      continue;
    }

    const quoteDate = new Date(priceRecord.quote_date);
    const validUntil = new Date(quoteDate);
    validUntil.setDate(validUntil.getDate() + priceRecord.valid_days);

    if (DEMO基准日 > validUntil) {
      risks.push({
        id: `RISK-PRICE-EXPIRED-${entity.part_number}`,
        level: 'HIGH',
        category: '价格风险',
        message: `${entity.part_number} 报价已过期，不允许直接报价`,
        suggestion: '需要重新核价',
        owner: '销售',
        source: 'RULE',
      });
    }
  }

  // 合规规则
  const matchedOrders = findMatchingOrders(extracted, orders, inventory);

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

    const hasLabelReq = extracted.entities.some(e => e.special_requirements.some(r => r.includes('标签')));
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
  }

  // 计算风险等级
  let overallLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE' = 'SAFE';
  if (risks.some(r => r.level === 'HIGH')) overallLevel = 'HIGH';
  else if (risks.some(r => r.level === 'MEDIUM')) overallLevel = 'MEDIUM';

  // 生成 Checklist
  const checklist = [
    { id: 'CL-001', text: '确认沟通记录中的订单信息', status: 'DONE', priority: 'MEDIUM' },
    ...risks.filter(r => r.level === 'HIGH' || r.level === 'MEDIUM').map(r => ({
      id: `CL-${r.id}`,
      text: `[${r.category}] ${r.suggestion}`,
      status: 'PENDING' as const,
      priority: r.level === 'HIGH' ? ('HIGH' as const) : ('MEDIUM' as const),
    })),
    {
      id: 'CL-SHIP',
      text: overallLevel === 'HIGH' ? '存在高风险，暂不建议发货' : '确认无高风险后可安排发货',
      status: overallLevel === 'HIGH' ? ('BLOCKED' as const) : ('PENDING' as const),
      priority: overallLevel === 'HIGH' ? ('HIGH' as const) : ('LOW' as const),
    },
  ];

  // 生成交接卡片
  const primaryMatchedOrder = matchedOrders[0];
  const highRisks = risks.filter(r => r.level === 'HIGH');
  const handoverCard = {
    order_id: primaryMatchedOrder?.order_id || '待创建',
    customer_name: primaryMatchedOrder?.customer_name || '待确认',
    sales_rep: primaryMatchedOrder?.sales_rep || '待指定',
    handler: '销售助理',
    items: extracted.entities.map(e => ({
      part_number: e.part_number,
      quantity: e.quantity,
      special_requirements: e.special_requirements,
      risk_flags: risks.filter(r => r.message.includes(e.part_number)).map(r => r.message.substring(0, 50)),
    })),
    risk_summary: highRisks.length > 0
      ? `存在 ${highRisks.length} 项高危风险，需处理后方可发货`
      : risks.length > 0
      ? `存在 ${risks.length} 项风险`
      : '未发现风险',
    action_items: highRisks.map(r => `${r.owner}: ${r.suggestion}`),
    missing_info: extracted.identified_missing_info,
    should_ship: overallLevel !== 'HIGH',
    ship_conclusion: overallLevel !== 'HIGH'
      ? '条件满足，建议发货'
      : '存在高风险，暂不建议发货',
    generated_at: DEMO基准日.toISOString(),
  };

  return {
    overall_risk_level: overallLevel,
    risks,
    checklist,
    handover_card: handoverCard,
  };
}

/**
 * 从扁平数据生成结构化台账
 */
function generateLedgersFromFlatData(flatData: Record<string, unknown>[]) {
  const orders: OrderLedger[] = [];
  const inventory: InventoryRecord[] = [];
  const prices: PriceRecord[] = [];

  for (const item of flatData) {
    const partNum = String(item.product_model ?? item.model ?? item.part_num ?? '');
    const virtualCustomerId = String(item.customer_id ?? (partNum ? `UPLOAD_CUSTOMER-${partNum.toUpperCase()}` : 'UPLOAD_CUSTOMER'));

    orders.push({
      order_id: String(item.order_id ?? `UPLOAD-${Date.now()}`),
      customer_id: virtualCustomerId,
      customer_name: String(item.customer_name ?? '上传客户'),
      sales_rep: String(item.sales_rep ?? ''),
      has_official_po: parseBoolean(item.po_received ?? item.has_official_po ?? false),
      address_confirmed: parseBoolean(item.shipping_address_confirmed ?? item.address_confirmed ?? false),
      label_template_available: parseBoolean(item.label_template_uploaded ?? item.label_template_available ?? false),
      allow_mix_batch: parseBoolean(item.mixed_batch_allowed ?? item.allow_mix_batch ?? true),
      status: 'CONFIRMED',
    });

    inventory.push({
      part_num: partNum,
      total_avail: Number(item.available_quantity ?? item.quantity ?? 0),
      batches: [],
      last_updated: new Date().toISOString(),
      customer_id: virtualCustomerId,
    });

    prices.push({
      part_num: partNum,
      customer_id: virtualCustomerId,
      quoted_price: Number(item.price ?? item.quoted_price ?? 0),
      currency: String(item.currency ?? 'USD'),
      quote_date: String(item.quote_date ?? new Date().toISOString()),
      valid_days: Number(item.valid_days ?? 30),
      min_qty: Number(item.min_qty ?? 1),
    });
  }

  return { orders, inventory, prices };
}

// Cloudflare Pages Functions 类型
interface PagesContext {
  request: Request;
  env: Env;
}

export const onRequestPost = async (context: PagesContext) => {
  const startTime = Date.now();

  try {
    const body = (await context.request.json()) as RequestBody;

    const chatRecord = body.chat_record || body.message;

    if (!chatRecord) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: '缺少 chat_record 或 message 字段' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }

    // 获取数据源
    let orders = body.data_source?.orders || [];
    let inventory = body.data_source?.inventory || [];
    let prices = body.data_source?.prices || [];

    // 如果有 flat_data，生成结构化数据
    if (body.data_source?.flat_data && orders.length === 0) {
      const ledgers = generateLedgersFromFlatData(body.data_source.flat_data);
      orders = ledgers.orders;
      inventory = ledgers.inventory;
      prices = ledgers.prices;
    }

    // 执行分析（优先使用 LLM / MiMo 抽取）
    let extracted: ReturnType<typeof extractOrderInfo>;
    let analysisMode: 'RULES_ONLY' | 'LLM_API' | 'RULES_FALLBACK' = 'RULES_ONLY';
    let fallbackReason: string | undefined;
    let llmUsed = false;
    const llmModel = context.env.LLM_MODEL || 'mimo-7b';
    const schemaVersion = '1.0.0';

    if (context.env.LLM_API_KEY && context.env.LLM_API_KEY.trim() !== '') {
      llmUsed = true;
      const llmResult = await callMimoLLM(chatRecord, context.env);
      if (llmResult.success && llmResult.data) {
        const valResult = validateLLMExtractedOrder(llmResult.data);
        if (valResult.ok && valResult.value) {
          analysisMode = 'LLM_API';
          const llmExtracted = valResult.value;

          // 将 LLM 抽取的结构转换成规则引擎兼容的格式
          const entities: Array<{
            part_number: string;
            quantity: number;
            special_requirements: string[];
            requested_delivery?: string;
          }> = [];

          if (llmExtracted.product_model) {
            const specialReqs: string[] = [...(llmExtracted.special_requirements || [])];
            
            if (llmExtracted.label_required === true && !specialReqs.some(r => r.includes('标签'))) {
              specialReqs.push('贴客户标签');
            }
            if (llmExtracted.mixed_batch_allowed === false && !specialReqs.some(r => r.includes('不可混批'))) {
              specialReqs.push('不可混批');
            }

            entities.push({
              part_number: llmExtracted.product_model.toUpperCase(),
              quantity: llmExtracted.quantity ?? 1000,
              special_requirements: specialReqs,
              requested_delivery: llmExtracted.delivery_deadline || undefined,
            });
          }

          const identifiedMissingInfo: string[] = [];
          if (llmExtracted.po_received === false) {
            identifiedMissingInfo.push('正式PO');
          }
          if (llmExtracted.shipping_address_confirmed === false) {
            identifiedMissingInfo.push('收货地址');
          }

          extracted = {
            entities,
            urgency_level: (llmExtracted.urgency === 'HIGH' ? 'HIGH' : llmExtracted.urgency === 'LOW' ? 'NORMAL' : 'NORMAL') as 'NORMAL' | 'HIGH' | 'CRITICAL',
            identified_missing_info: identifiedMissingInfo,
            raw_summary: `[LLM] 需求：${llmExtracted.product_model} ${llmExtracted.quantity ?? 1000}颗`
          };
        } else {
          analysisMode = 'RULES_FALLBACK';
          fallbackReason = `数据校验失败: ${valResult.reason}`;
          extracted = extractOrderInfo(chatRecord);
        }
      } else {
        analysisMode = 'RULES_FALLBACK';
        fallbackReason = `模型调用异常: ${llmResult.reason}`;
        extracted = extractOrderInfo(chatRecord);
      }
    } else {
      analysisMode = 'RULES_ONLY';
      extracted = extractOrderInfo(chatRecord);
    }

    const assessment = runRiskEngine(extracted, orders, inventory, prices);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          extracted,
          assessment,
          analysis_mode: analysisMode,
          fallback_reason: fallbackReason,
          llm_used: llmUsed,
          llm_model: llmModel,
          schema_version: schemaVersion,
          duration_ms: Date.now() - startTime,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );

  } catch (error) {
    console.error('API Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
};
