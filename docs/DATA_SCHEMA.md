# 数据结构设计

## 概述

本项目数据流分为 5 个核心层级：输入层、台账层、库存报价层、AI 抽取层、输出层。

## 1. Context Data (输入层)

用户输入的原始沟通记录。

```typescript
interface ChatRecord {
  content: string;        // 原始聊天记录文本
  timestamp?: string;     // 可选：记录时间
  source?: string;        // 可选：来源（企微/微信/其他）
}
```

**示例**:
```json
{
  "content": "客户：A133要5000颗，最好明天发。销售：库存有，让助理建单。客户：外箱要贴客户自己的标签，不能混批。"
}
```

## 2. Ledger Data (台账层 - 订单/客户)

订单基础信息台账。

```typescript
interface OrderLedger {
  order_id: string;               // 订单编号
  customer_id: string;            // 客户编号
  customer_name: string;          // 客户名称
  sales_rep: string;              // 销售代表
  has_official_po: boolean;       // 是否有正式 PO
  address_confirmed: boolean;     // 收货地址是否确认
  label_template_available: boolean; // 标签模板是否可用
  allow_mix_batch: boolean;       // 是否允许混批
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED'; // 订单状态
}
```

**示例**:
```json
{
  "order_id": "PO-202405-001",
  "customer_id": "CUST_088",
  "customer_name": "某知名终端制造厂",
  "sales_rep": "张三",
  "has_official_po": false,
  "address_confirmed": true,
  "label_template_available": false,
  "allow_mix_batch": false,
  "status": "PENDING"
}
```

## 3. Inventory & Price Data (库存与报价层)

### 3.1 库存台账

```typescript
interface InventoryRecord {
  part_num: string;           // 物料型号
  description?: string;       // 物料描述
  total_avail: number;        // 总可用数量
  batches: BatchInfo[];       // 批次信息
  location?: string;          // 库存位置
  last_updated: string;       // 最后更新时间
}

interface BatchInfo {
  batch_no: string;           // 批次号
  qty: number;                // 数量
  date_code?: string;         // Date Code
  manufacture_date?: string;  // 生产日期
  expiry_date?: string;       // 有效期（如有）
}
```

**示例**:
```json
{
  "part_num": "A133",
  "description": "MCU 32bit ARM Cortex-M4",
  "total_avail": 3000,
  "batches": [
    {"batch_no": "B20240301", "qty": 1500, "date_code": "2024"},
    {"batch_no": "B20240315", "qty": 1500, "date_code": "2024"}
  ],
  "location": "深圳仓",
  "last_updated": "2024-05-20"
}
```

### 3.2 报价台账

```typescript
interface PriceRecord {
  part_num: string;           // 物料型号
  customer_id: string;        // 客户编号
  quoted_price: number;       // 报价金额
  currency: string;           // 币种（USD/CNY）
  quote_date: string;         // 报价日期
  valid_days: number;         // 有效天数
  min_qty: number;            // 最小起订量
  lead_time_days?: number;    // 交期（天）
  notes?: string;             // 备注
}
```

**示例**:
```json
{
  "part_num": "A133",
  "customer_id": "CUST_088",
  "quoted_price": 1.2,
  "currency": "USD",
  "quote_date": "2024-04-01",
  "valid_days": 30,
  "min_qty": 1000,
  "lead_time_days": 7,
  "notes": "含税价格"
}
```

## 4. Extracted Data (AI 抽取层)

LLM 从聊天记录中提取的结构化数据。

```typescript
interface ExtractedOrder {
  entities: ExtractedEntity[];     // 提取的物料实体
  urgency_level: 'NORMAL' | 'HIGH' | 'CRITICAL'; // 紧急程度
  identified_missing_info: string[]; // 缺失信息
  raw_summary?: string;           // 可选：AI 生成的摘要
}

interface ExtractedEntity {
  part_number: string;            // 物料型号
  quantity: number;               // 数量
  special_requirements: string[]; // 特殊要求
  mentioned_price?: number;       // 沟通中提到的价格
  requested_delivery?: string;    // 期望交期
}
```

**示例**:
```json
{
  "entities": [
    {
      "part_number": "A133",
      "quantity": 5000,
      "special_requirements": ["贴客户标签", "不可混批"],
      "requested_delivery": "明天"
    }
  ],
  "urgency_level": "HIGH",
  "identified_missing_info": ["正式PO", "标签模板", "收货人联系方式"],
  "raw_summary": "客户急需 A133 共 5000 颗，要求贴专属标签且不可混批，期望明天发货"
}
```

## 5. Risk Assessment (风控评估层)

规则引擎输出的风险评估结果。

```typescript
interface RiskAssessment {
  overall_risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE'; // 综合风险等级
  risks: RiskItem[];              // 风险列表
  checklist: ChecklistItem[];     // 发货 Checklist
  handover_card: HandoverCard;    // 交接卡片
}

interface RiskItem {
  id: string;                     // 风险 ID
  level: 'HIGH' | 'MEDIUM' | 'LOW'; // 风险等级
  category: string;               // 风险类别（库存/价格/合规/...）
  message: string;                // 风险描述
  suggestion: string;             // 处理建议
  owner: string;                  // 责任人
  source: 'RULE' | 'LLM';        // 风险来源
}

interface ChecklistItem {
  id: string;
  text: string;                   // 待办事项
  status: 'PENDING' | 'DONE' | 'BLOCKED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface HandoverCard {
  order_id: string;
  customer_name: string;
  sales_rep: string;
  items: HandoverItem[];          // 交接物料列表
  risk_summary: string;           // 风险摘要
  action_items: string[];         // 行动建议
  generated_at: string;           // 生成时间
}

interface HandoverItem {
  part_number: string;
  quantity: number;
  special_requirements: string[];
  risk_flags: string[];           // 该物料的风险标记
}
```

**示例**:
```json
{
  "overall_risk_level": "HIGH",
  "risks": [
    {
      "id": "RISK-001",
      "level": "HIGH",
      "category": "库存风险",
      "message": "现货库存不足！需求 5000 颗，当前可用仅 3000 颗",
      "suggestion": "需确认后续到货期或与客户协商分批发货",
      "owner": "采购/销售",
      "source": "RULE"
    },
    {
      "id": "RISK-002",
      "level": "HIGH",
      "category": "合规风险",
      "message": "客户要求贴专属标签，但系统缺失标签模板文件",
      "suggestion": "联系客户获取标签模板，或确认是否可使用通用标签",
      "owner": "销售",
      "source": "RULE"
    }
  ],
  "checklist": [
    {"id": "CL-001", "text": "确认库存缺口解决方案", "status": "PENDING", "priority": "HIGH"},
    {"id": "CL-002", "text": "获取客户标签模板", "status": "PENDING", "priority": "HIGH"},
    {"id": "CL-003", "text": "确认收货地址", "status": "DONE", "priority": "MEDIUM"}
  ],
  "handover_card": {
    "order_id": "PO-202405-001",
    "customer_name": "某知名终端制造厂",
    "sales_rep": "张三",
    "items": [
      {
        "part_number": "A133",
        "quantity": 5000,
        "special_requirements": ["贴客户标签", "不可混批"],
        "risk_flags": ["库存不足", "标签缺失"]
      }
    ],
    "risk_summary": "存在 2 项高危风险，需处理后方可发货",
    "action_items": [
      "1. 联系采购确认 A133 到货计划",
      "2. 联系客户获取标签模板文件",
      "3. 确认是否可接受分批发货"
    ],
    "generated_at": "2024-05-20T10:30:00Z"
  }
}
```

## 6. API Request/Response 格式

### 6.1 分析请求

```typescript
interface AnalyzeRequest {
  chat_record: string;           // 原始聊天记录
  data_source: {
    type: 'BUILTIN' | 'CSV' | 'JSON'; // 数据源类型
    orders?: OrderLedger[];      // 订单台账
    inventory?: InventoryRecord[]; // 库存台账
    prices?: PriceRecord[];      // 报价台账
  };
  mock_mode?: boolean;           // 是否使用 Mock 模式
}
```

### 6.2 分析响应

```typescript
interface AnalyzeResponse {
  success: boolean;
  data?: {
    extracted: ExtractedOrder;   // AI 抽取结果
    assessment: RiskAssessment;  // 风控评估
    mock_mode: boolean;          // 是否为 Mock 结果
  };
  error?: {
    code: string;
    message: string;
    fallback_to_mock?: boolean;  // 是否已降级到 Mock
  };
}
```

## 7. Mock 数据结构

### 7.1 内置场景数据

```typescript
interface BuiltinScenario {
  id: string;
  name: string;                  // 场景名称
  description: string;           // 场景描述
  chat_record: string;           // 预设聊天记录
  orders: OrderLedger[];         // 预设订单台账
  inventory: InventoryRecord[];  // 预设库存台账
  prices: PriceRecord[];         // 预设报价台账
  expected_risks: string[];      // 预期触发的风险（用于验证）
}
```

### 7.2 上传文件格式

**CSV 格式要求**:
- 订单台账: `order_id,customer_id,customer_name,sales_rep,has_official_po,address_confirmed,label_template_available,allow_mix_batch,status`
- 库存台账: `part_num,description,total_avail,batch_no,batch_qty,date_code,location`
- 报价台账: `part_num,customer_id,quoted_price,currency,quote_date,valid_days,min_qty`

**JSON 格式要求**:
- 与 TypeScript 接口定义一致的 JSON 数组
- 文件扩展名为 `.json`
- 编码为 UTF-8
