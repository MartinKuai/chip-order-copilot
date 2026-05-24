/**
 * 共享分析函数
 *
 * 前端 App.tsx 和 Cloudflare Functions 都调用同一套逻辑
 * 避免前后端逻辑分叉
 */

import { extractOrderInfo } from './extractOrderInfo';
import { runRiskEngine } from './riskRules';
import type {
  DataSource,
  ExtractedOrder,
  RiskAssessment,
  OrderLedger,
  InventoryRecord,
  PriceRecord,
} from '../types';
import { parseBoolean } from './utils';

/**
 * 分析结果
 */
export interface AnalysisResult {
  extracted: ExtractedOrder;
  assessment: RiskAssessment;
  analysis_mode: 'LOCAL_RULES' | 'LLM_API';
  fallback_reason?: string;
  duration_ms: number;
}

/**
 * 从扁平数据生成结构化台账
 */
export function generateLedgersFromFlatData(flatData: Record<string, unknown>[]): {
  orders: OrderLedger[];
  inventory: InventoryRecord[];
  prices: PriceRecord[];
} {
  const orders: OrderLedger[] = [];
  const inventory: InventoryRecord[] = [];
  const prices: PriceRecord[] = [];

  for (const item of flatData) {
    const partNum = String(item.product_model ?? item.model ?? item.mpn ?? item.part_num ?? '');
    const virtualCustomerId = String(item.customer_id ?? (partNum ? `UPLOAD_CUSTOMER-${partNum.toUpperCase()}` : 'UPLOAD_CUSTOMER'));

    // 生成订单
    orders.push({
      order_id: String(item.order_id ?? `UPLOAD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      customer_id: virtualCustomerId,
      customer_name: String(item.customer_name ?? '上传客户'),
      sales_rep: String(item.sales_rep ?? ''),
      has_official_po: parseBoolean(item.po_received ?? item.has_official_po ?? false),
      address_confirmed: parseBoolean(item.shipping_address_confirmed ?? item.address_confirmed ?? false),
      label_template_available: parseBoolean(item.label_template_uploaded ?? item.label_template_available ?? false),
      allow_mix_batch: parseBoolean(item.mixed_batch_allowed ?? item.allow_mix_batch ?? true),
      status: 'CONFIRMED',
    });

    // 生成库存
    inventory.push({
      part_num: partNum,
      total_avail: Number(item.available_quantity ?? item.quantity ?? item.total_avail ?? 0),
      batches: [],
      last_updated: new Date().toISOString(),
      customer_id: virtualCustomerId,
    });

    // 生成报价
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

/**
 * 执行完整分析（共享逻辑）
 */
export function analyzeOrder(
  chatRecord: string,
  dataSource: DataSource
): AnalysisResult {
  const startTime = Date.now();

  // 1. 抽取订单字段
  const extracted = extractOrderInfo(chatRecord);

  // 2. 获取数据源
  let orders = dataSource.orders || [];
  let inventory = dataSource.inventory || [];
  let prices = dataSource.prices || [];

  // 3. 如果是上传数据但没有结构化数据，尝试从 flat_data 生成
  if (
    dataSource.type !== 'BUILTIN' &&
    orders.length === 0 &&
    inventory.length === 0 &&
    prices.length === 0 &&
    dataSource.flat_data
  ) {
    const ledgers = generateLedgersFromFlatData(dataSource.flat_data);
    orders = ledgers.orders;
    inventory = ledgers.inventory;
    prices = ledgers.prices;
  }

  // 4. 运行风险规则引擎
  const assessment = runRiskEngine(extracted, orders, inventory, prices);

  return {
    extracted,
    assessment,
    analysis_mode: 'LOCAL_RULES',
    duration_ms: Date.now() - startTime,
  };
}

/**
 * 校验 API 响应是否有效
 */
export function isValidAnalysisResponse(response: unknown): response is {
  success: boolean;
  data: {
    extracted: ExtractedOrder;
    assessment: RiskAssessment;
    analysis_mode: string;
    duration_ms: number;
  };
} {
  if (!response || typeof response !== 'object') return false;
  const res = response as Record<string, unknown>;

  if (!res.success || !res.data) return false;
  const data = res.data as Record<string, unknown>;

  if (!data.extracted || !data.assessment) return false;

  const extracted = data.extracted as Record<string, unknown>;
  const assessment = data.assessment as Record<string, unknown>;

  // 检查必要字段
  if (!Array.isArray(extracted.entities)) return false;
  if (!assessment.risks || !Array.isArray(assessment.risks)) return false;
  if (!assessment.checklist || !Array.isArray(assessment.checklist)) return false;
  if (!assessment.handover_card) return false;

  const handoverCard = assessment.handover_card as Record<string, unknown>;
  if (typeof handoverCard.should_ship !== 'boolean') return false;
  if (typeof handoverCard.ship_conclusion !== 'string') return false;
  if (!Array.isArray(handoverCard.missing_info)) return false;

  // 检查是否为空 SAFE Mock（无效响应）
  if (
    assessment.overall_risk_level === 'SAFE' &&
    extracted.entities.length === 0 &&
    assessment.risks.length === 0
  ) {
    // 如果 entities 为空但输入不为空，可能是旧 Mock
    // 这种情况下需要额外检查
    const rawSummary = String(extracted.raw_summary ?? '');
    if (rawSummary.includes('Mock') || rawSummary.includes('MOCK')) {
      return false;
    }
  }

  return true;
}
