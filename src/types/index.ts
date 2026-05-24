// ============================================================
// Chip Order Copilot - 核心类型定义
// ============================================================

// ---- 输入层 ----

/** 原始聊天记录 */
export interface ChatRecord {
  content: string;
  timestamp?: string;
  source?: string;
}

// ---- 台账层 ----

/** 订单台账 */
export interface OrderLedger {
  order_id: string;
  customer_id: string;
  customer_name: string;
  sales_rep: string;
  has_official_po: boolean;
  address_confirmed: boolean;
  label_template_available: boolean;
  allow_mix_batch: boolean;
  photo_before_shipping_confirmed?: boolean;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'CANCELLED';
}

// ---- 库存与报价层 ----

/** 批次信息 */
export interface BatchInfo {
  batch_no: string;
  qty: number;
  date_code?: string;
  manufacture_date?: string;
  expiry_date?: string;
  customer_id?: string;
}

/** 库存台账 */
export interface InventoryRecord {
  part_num: string;
  description?: string;
  total_avail: number;
  batches: BatchInfo[];
  location?: string;
  last_updated: string;
  customer_id?: string;
}

/** 报价台账 */
export interface PriceRecord {
  part_num: string;
  customer_id: string;
  quoted_price: number;
  currency: string;
  quote_date: string;
  valid_days: number;
  min_qty: number;
  lead_time_days?: number;
  notes?: string;
}

// ---- AI 抽取层 ----

/** 抽取的物料实体 */
export interface ExtractedEntity {
  part_number: string;
  quantity: number;
  special_requirements: string[];
  mentioned_price?: number;
  requested_delivery?: string;
}

/** LLM 抽取结果 */
export interface ExtractedOrder {
  entities: ExtractedEntity[];
  urgency_level: 'NORMAL' | 'HIGH' | 'CRITICAL';
  identified_missing_info: string[];
  raw_summary?: string;
}

// ---- 风控评估层 ----

/** 风险项 */
export interface RiskItem {
  id: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  message: string;
  suggestion: string;
  owner: string;
  source: 'RULE' | 'LLM';
}

/** Checklist 项 */
export interface ChecklistItem {
  id: string;
  text: string;
  status: 'PENDING' | 'DONE' | 'BLOCKED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** 交接卡片物料项 */
export interface HandoverItem {
  part_number: string;
  quantity: number;
  special_requirements: string[];
  risk_flags: string[];
}

/** 交接卡片 */
export interface HandoverCard {
  order_id: string;
  customer_name: string;
  sales_rep: string;
  handler: string;
  items: HandoverItem[];
  risk_summary: string;
  action_items: string[];
  missing_info: string[];
  should_ship: boolean;
  ship_conclusion: string;
  generated_at: string;
}

/** 风控评估结果 */
export interface RiskAssessment {
  overall_risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  risks: RiskItem[];
  checklist: ChecklistItem[];
  handover_card: HandoverCard;
}

// ---- API 层 ----

/** 数据源配置 */
export interface DataSource {
  type: 'BUILTIN' | 'CSV' | 'JSON';
  scenario_id?: string;
  orders?: OrderLedger[];
  inventory?: InventoryRecord[];
  prices?: PriceRecord[];
  flat_data?: Record<string, unknown>[];
}

/** 分析请求 */
export interface AnalyzeRequest {
  chat_record: string;
  data_source: DataSource;
  mock_mode?: boolean;
}

/** 分析响应 */
export interface AnalyzeResponse {
  success: boolean;
  data?: {
    extracted: ExtractedOrder;
    assessment: RiskAssessment;
    analysis_mode: 'LOCAL_RULES' | 'LLM_API';
    fallback_reason?: string;
    duration_ms: number;
  };
  error?: {
    code: string;
    message: string;
    fallback_to_local?: boolean;
  };
}

// ---- 内置场景 ----

/** 内置场景数据 */
export interface BuiltinScenario {
  id: string;
  name: string;
  description: string;
  chat_record: string;
  orders: OrderLedger[];
  inventory: InventoryRecord[];
  prices: PriceRecord[];
  expected_risks: string[];
}
