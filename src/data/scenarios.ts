/**
 * 内置场景数据
 *
 * 3-4 套典型业务场景，用于演示和测试
 */

import type { BuiltinScenario } from '../types';

export const builtinScenarios: BuiltinScenario[] = [
  // ============================================================
  // 场景 1: 常规缺货场景
  // ============================================================
  {
    id: 'scenario_001',
    name: '常规缺货场景',
    description: '客户需求量超过库存，且缺少 PO',
    chat_record: `客户（王经理）：A133 要 5000 颗，最好明天发，我们产线等着用。
销售（张三）：库存有，让助理建单。
客户（王经理）：外箱要贴我们自己的标签，不能混批，上次那个格式。
助理：好的，我先确认一下。`,
    orders: [
      {
        order_id: 'PO-202405-001',
        customer_id: 'CUST_088',
        customer_name: '某知名终端制造厂',
        sales_rep: '张三',
        has_official_po: false,
        address_confirmed: true,
        label_template_available: false,
        allow_mix_batch: false,
        status: 'PENDING',
      },
    ],
    inventory: [
      {
        part_num: 'A133',
        description: 'MCU 32bit ARM Cortex-M4',
        total_avail: 3000,
        batches: [
          { batch_no: 'B20240301', qty: 1500, date_code: '2024' },
          { batch_no: 'B20240315', qty: 1500, date_code: '2024' },
        ],
        location: '深圳仓',
        last_updated: '2024-05-20',
      },
    ],
    prices: [
      {
        part_num: 'A133',
        customer_id: 'CUST_088',
        quoted_price: 1.2,
        currency: 'USD',
        quote_date: '2024-04-01',
        valid_days: 30,
        min_qty: 1000,
        lead_time_days: 7,
        notes: '含税价格',
      },
    ],
    expected_risks: ['库存不足', 'PO 缺失', '标签模板缺失'],
  },

  // ============================================================
  // 场景 2: 报价过期强行发货场景
  // ============================================================
  {
    id: 'scenario_002',
    name: '报价过期场景',
    description: '报价已过期，客户要求按旧价发货',
    chat_record: `销售（李四）：B256 客户要 2000 颗，就按上次那个报价 $0.85 来吧。
客户（赵总）：对，尽快发货，我们赶项目。
助理：李哥，这个报价好像过期了...
销售（李四）：没事，先发吧，后面再补。`,
    orders: [
      {
        order_id: 'PO-202405-002',
        customer_id: 'CUST_156',
        customer_name: '某科技有限公司',
        sales_rep: '李四',
        has_official_po: true,
        address_confirmed: true,
        label_template_available: true,
        allow_mix_batch: true,
        status: 'CONFIRMED',
      },
    ],
    inventory: [
      {
        part_num: 'B256',
        description: '电源管理芯片 PMIC',
        total_avail: 5000,
        batches: [{ batch_no: 'B20240401', qty: 5000, date_code: '2024' }],
        location: '上海仓',
        last_updated: '2024-05-18',
      },
    ],
    prices: [
      {
        part_num: 'B256',
        customer_id: 'CUST_156',
        quoted_price: 0.85,
        currency: 'USD',
        quote_date: '2024-03-01',
        valid_days: 30,
        min_qty: 500,
        lead_time_days: 5,
      },
    ],
    expected_risks: ['报价过期'],
  },

  // ============================================================
  // 场景 3: 特殊标签定制场景
  // ============================================================
  {
    id: 'scenario_003',
    name: '特殊标签场景',
    description: '客户要求贴专属标签，不可混批',
    chat_record: `客户（陈工）：这批货外箱要贴我们自己的标签，不能混批，上次那个格式。
助理：好的，请问标签模板文件发一下？
客户（陈工）：模板在邮件里，你找一下。
助理：我这边没收到，能再发一次吗？`,
    orders: [
      {
        order_id: 'PO-202405-003',
        customer_id: 'CUST_201',
        customer_name: '某汽车电子有限公司',
        sales_rep: '王五',
        has_official_po: true,
        address_confirmed: true,
        label_template_available: false,
        allow_mix_batch: false,
        status: 'CONFIRMED',
      },
    ],
    inventory: [
      {
        part_num: 'C789',
        description: '车规级 MCU',
        total_avail: 10000,
        batches: [
          { batch_no: 'B20240201', qty: 4000, date_code: '2024', customer_id: 'CUST_201' },
          { batch_no: 'B20240301', qty: 3000, date_code: '2024' },
          { batch_no: 'B20240401', qty: 3000, date_code: '2024' },
        ],
        location: '深圳仓',
        last_updated: '2024-05-19',
      },
    ],
    prices: [
      {
        part_num: 'C789',
        customer_id: 'CUST_201',
        quoted_price: 3.5,
        currency: 'USD',
        quote_date: '2024-05-01',
        valid_days: 60,
        min_qty: 2000,
        lead_time_days: 10,
      },
    ],
    expected_risks: ['标签模板缺失', '混批风险'],
  },

  // ============================================================
  // 场景 4: 收货地址缺失场景
  // ============================================================
  {
    id: 'scenario_004',
    name: '地址缺失场景',
    description: '收货地址未确认，销售负责人缺失',
    chat_record: `客户（刘经理）：D456 要 3000 颗，发到老地方。
助理：刘经理，系统里没有记录你们的收货地址，能发一下吗？
客户（刘经理）：就是上次那个，你查一下。
助理：好的，我确认一下。`,
    orders: [
      {
        order_id: 'PO-202405-004',
        customer_id: 'CUST_302',
        customer_name: '某通信设备有限公司',
        sales_rep: '',
        has_official_po: true,
        address_confirmed: false,
        label_template_available: true,
        allow_mix_batch: true,
        status: 'PENDING',
      },
    ],
    inventory: [
      {
        part_num: 'D456',
        description: '射频前端模块',
        total_avail: 8000,
        batches: [{ batch_no: 'B20240501', qty: 8000, date_code: '2024' }],
        location: '北京仓',
        last_updated: '2024-05-20',
      },
    ],
    prices: [
      {
        part_num: 'D456',
        customer_id: 'CUST_302',
        quoted_price: 2.8,
        currency: 'USD',
        quote_date: '2024-05-10',
        valid_days: 30,
        min_qty: 1000,
        lead_time_days: 3,
      },
    ],
    expected_risks: ['收货地址缺失', '销售负责人缺失', '订单待确认'],
  },

  // ============================================================
  // 场景 5: 低风险场景（用于验证否定语义）
  // ============================================================
  {
    id: 'scenario_005',
    name: '低风险场景',
    description: 'PO 已收到，地址已确认，不需要特殊标签',
    chat_record: `客户（张总）：XT208 要 1000 颗，下周发也可以，不需要特殊标签，可以分批发。
销售（李四）：好的，PO 已收到，地址已确认。
助理：好的，我来建单。`,
    orders: [
      {
        order_id: 'PO-202405-005',
        customer_id: 'CUST_401',
        customer_name: '某消费电子有限公司',
        sales_rep: '李四',
        has_official_po: true,
        address_confirmed: true,
        label_template_available: true,
        allow_mix_batch: true,
        status: 'CONFIRMED',
      },
    ],
    inventory: [
      {
        part_num: 'XT208',
        description: '蓝牙音频芯片',
        total_avail: 5000,
        batches: [{ batch_no: 'B20240510', qty: 5000, date_code: '2024' }],
        location: '深圳仓',
        last_updated: '2026-05-20',
        customer_id: 'CUST_401',
      },
    ],
    prices: [
      {
        part_num: 'XT208',
        customer_id: 'CUST_401',
        quoted_price: 0.95,
        currency: 'USD',
        quote_date: '2026-05-01',
        valid_days: 60,
        min_qty: 500,
        lead_time_days: 5,
      },
    ],
    expected_risks: [],
  },
];

/**
 * 根据 ID 获取场景
 */
export function getScenarioById(id: string): BuiltinScenario | undefined {
  return builtinScenarios.find(s => s.id === id);
}

/**
 * 根据关键词匹配场景
 */
export function matchScenarioByKeywords(text: string): BuiltinScenario | undefined {
  const lowerText = text.toLowerCase();

  // 缺货关键词
  if (/缺货|库存不足|数量不够|要.*颗.*发/.test(lowerText)) {
    return builtinScenarios[0];
  }

  // 报价过期关键词
  if (/报价|价格|.*价.*来|上次.*价/.test(lowerText)) {
    return builtinScenarios[1];
  }

  // 标签关键词
  if (/标签|贴标|label|包装/.test(lowerText)) {
    return builtinScenarios[2];
  }

  // 地址关键词
  if (/地址|发到|送货|收货/.test(lowerText)) {
    return builtinScenarios[3];
  }

  // 默认返回第一个场景
  return builtinScenarios[0];
}
