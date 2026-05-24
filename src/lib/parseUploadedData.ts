/**
 * CSV / JSON 数据解析器
 *
 * 支持内部字段和验收场景字段的映射
 */

import type {
  OrderLedger,
  InventoryRecord,
  PriceRecord,
  BatchInfo,
} from '../types';

/**
 * 解析上传的文件
 */
export async function parseUploadedFile(
  file: File,
  dataType: 'orders' | 'inventory' | 'prices'
): Promise<OrderLedger[] | InventoryRecord[] | PriceRecord[]> {
  const content = await readFileContent(file);

  if (file.name.endsWith('.json')) {
    return parseJSON(content, dataType);
  } else if (file.name.endsWith('.csv')) {
    return parseCSV(content, dataType);
  } else {
    throw new Error('不支持的文件格式，请上传 .csv 或 .json 文件');
  }
}

/**
 * 读取文件内容
 */
function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('读取文件失败'));
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

/**
 * 解析 JSON 文件
 */
function parseJSON(
  content: string,
  dataType: 'orders' | 'inventory' | 'prices'
): OrderLedger[] | InventoryRecord[] | PriceRecord[] {
  try {
    const data = JSON.parse(content);
    const items = Array.isArray(data) ? data : [data];

    // 根据数据类型进行验证和转换
    switch (dataType) {
      case 'orders':
        return items.map(validateAndTransformOrder);
      case 'inventory':
        return items.map(validateAndTransformInventory);
      case 'prices':
        return items.map(validateAndTransformPrice);
      default:
        throw new Error('未知的数据类型');
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('JSON 格式错误，请检查文件内容');
    }
    throw e;
  }
}

/**
 * 解析 CSV 文件
 */
function parseCSV(
  content: string,
  dataType: 'orders' | 'inventory' | 'prices'
): OrderLedger[] | InventoryRecord[] | PriceRecord[] {
  // 处理 CSV 中的换行（在引号内的换行）
  const lines = splitCSVLines(content).filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV 文件为空或缺少数据行');
  }

  // 解析表头
  const headers = parseCSVLine(lines[0]!);
  const rows = lines.slice(1).map(line => parseCSVLine(line));

  switch (dataType) {
    case 'orders':
      return rows.map(row => csvRowToOrder(headers, row));
    case 'inventory':
      return rows.map(row => csvRowToInventory(headers, row));
    case 'prices':
      return rows.map(row => csvRowToPrice(headers, row));
    default:
      throw new Error('未知的数据类型');
  }
}

/**
 * 分割 CSV 行（正确处理引号内的换行）
 */
function splitCSVLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (char === '\r') {
      // 忽略 \r
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    lines.push(current);
  }

  return lines;
}

/**
 * 解析 CSV 行（处理引号和逗号）
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // 转义引号
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * CSV 行转订单数据
 * 支持内部字段和验收场景字段
 */
function csvRowToOrder(headers: string[], row: string[]): OrderLedger {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? '';
  });

  return {
    order_id: getField(obj, ['order_id', 'order-id', 'orderId', 'po_number']) || `UPLOAD-${Date.now()}`,
    customer_id: getField(obj, ['customer_id', 'customer-id', 'customerId']) || 'UNKNOWN',
    customer_name: getField(obj, ['customer_name', 'customer-name', 'customerName', 'customer']) || '未知客户',
    sales_rep: getField(obj, ['sales_rep', 'sales-rep', 'salesRep', 'sales']) || '',
    has_official_po: parseBoolean(getField(obj, ['has_official_po', 'has-official-po', 'po_received', 'poReceived', 'po_confirmed'])),
    address_confirmed: parseBoolean(getField(obj, ['address_confirmed', 'address-confirmed', 'shipping_address_confirmed', 'shippingAddressConfirmed', 'address_confirmed'])),
    label_template_available: parseBoolean(getField(obj, ['label_template_available', 'label-template-available', 'label_template_uploaded', 'labelTemplateUploaded', 'label_available'])),
    allow_mix_batch: parseBoolean(getField(obj, ['allow_mix_batch', 'allow-mix-batch', 'mixed_batch_allowed', 'mixedBatchAllowed', 'allow_mix'])),
    status: validateOrderStatus(getField(obj, ['status', 'order_status', 'orderStatus']) || 'PENDING'),
  };
}

/**
 * CSV 行转库存数据
 * 支持内部字段和验收场景字段
 */
function csvRowToInventory(headers: string[], row: string[]): InventoryRecord {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? '';
  });

  // 解析批次信息
  const batches: BatchInfo[] = [];
  const batchNo = getField(obj, ['batch_no', 'batch-no', 'batchNo', 'batch_number']);
  const batchQty = parseInt(getField(obj, ['batch_qty', 'batch-qty', 'batchQty', 'batch_quantity']) || '0', 10);

  if (batchNo && batchQty > 0) {
    batches.push({
      batch_no: batchNo,
      qty: batchQty,
      date_code: getField(obj, ['date_code', 'date-code', 'dateCode']),
    });
  }

  return {
    part_num: getField(obj, ['part_num', 'part-num', 'partNum', 'product_model', 'productModel', 'model', 'mpn']) || '',
    description: getField(obj, ['description', 'desc', 'name']),
    total_avail: parseInt(getField(obj, ['total_avail', 'total-avail', 'available_quantity', 'availableQuantity', 'qty', 'quantity']) || '0', 10),
    batches,
    location: getField(obj, ['location', 'warehouse', '仓']),
    last_updated: getField(obj, ['last_updated', 'last-updated', 'lastUpdated', 'update_date']) || new Date().toISOString(),
    customer_id: getField(obj, ['customer_id', 'customer-id', 'customerId']),
  };
}

/**
 * CSV 行转报价数据
 * 支持内部字段和验收场景字段
 */
function csvRowToPrice(headers: string[], row: string[]): PriceRecord {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? '';
  });

  return {
    part_num: getField(obj, ['part_num', 'part-num', 'partNum', 'product_model', 'productModel', 'model', 'mpn']) || '',
    customer_id: getField(obj, ['customer_id', 'customer-id', 'customerId']) || 'UNKNOWN',
    quoted_price: parseFloat(getField(obj, ['quoted_price', 'quoted-price', 'quotedPrice', 'price', 'unit_price']) || '0'),
    currency: getField(obj, ['currency', '币种']) || 'USD',
    quote_date: getField(obj, ['quote_date', 'quote-date', 'quoteDate', 'date']) || new Date().toISOString(),
    valid_days: parseInt(getField(obj, ['valid_days', 'valid-days', 'validDays', 'validity']) || '30', 10),
    min_qty: parseInt(getField(obj, ['min_qty', 'min-qty', 'minQty', 'moq']) || '1', 10),
    lead_time_days: parseInt(getField(obj, ['lead_time_days', 'lead-time-days', 'leadTimeDays', 'lead_time']) || '0', 10),
    notes: getField(obj, ['notes', 'remark', '备注']),
  };
}

/**
 * 从对象中获取字段值（支持多个别名）
 */
function getField(obj: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    if (obj[alias] !== undefined && obj[alias] !== '') {
      return obj[alias];
    }
  }
  return '';
}

// ============================================================
// 验证和转换函数（用于 JSON 解析）
// ============================================================

function validateAndTransformOrder(data: Record<string, unknown>): OrderLedger {
  return {
    order_id: String(data.order_id ?? data['order-id'] ?? data.orderId ?? data.po_number ?? `UPLOAD-${Date.now()}`),
    customer_id: String(data.customer_id ?? data['customer-id'] ?? data.customerId ?? 'UNKNOWN'),
    customer_name: String(data.customer_name ?? data['customer-name'] ?? data.customerName ?? data.customer ?? '未知客户'),
    sales_rep: String(data.sales_rep ?? data['sales-rep'] ?? data.salesRep ?? data.sales ?? ''),
    has_official_po: parseBooleanValue(data.has_official_po ?? data['has-official-po'] ?? data.po_received ?? data.poReceived ?? data.po_confirmed),
    address_confirmed: parseBooleanValue(data.address_confirmed ?? data['address-confirmed'] ?? data.shipping_address_confirmed ?? data.shippingAddressConfirmed),
    label_template_available: parseBooleanValue(data.label_template_available ?? data['label-template-available'] ?? data.label_template_uploaded ?? data.labelTemplateUploaded ?? data.label_available),
    allow_mix_batch: parseBooleanValue(data.allow_mix_batch ?? data['allow-mix-batch'] ?? data.mixed_batch_allowed ?? data.mixedBatchAllowed),
    status: validateOrderStatus(String(data.status ?? data.order_status ?? data.orderStatus ?? 'PENDING')),
  };
}

function validateAndTransformInventory(data: Record<string, unknown>): InventoryRecord {
  const batches = Array.isArray(data.batches)
    ? data.batches.map((b: Record<string, unknown>) => ({
        batch_no: String(b.batch_no ?? b['batch-no'] ?? b.batchNo ?? ''),
        qty: Number(b.qty ?? 0),
        date_code: b.date_code ? String(b.date_code) : undefined,
        customer_id: b.customer_id ? String(b.customer_id) : undefined,
      }))
    : [];

  // 也支持扁平的批次字段
  const batchNo = String(data.batch_no ?? data['batch-no'] ?? data.batchNo ?? '');
  const batchQty = Number(data.batch_qty ?? data['batch-qty'] ?? data.batchQty ?? 0);

  if (batchNo && batchQty > 0 && batches.length === 0) {
    batches.push({
      batch_no: batchNo,
      qty: batchQty,
      date_code: data.date_code ? String(data.date_code) : undefined,
      customer_id: data.customer_id ? String(data.customer_id) : undefined,
    });
  }

  return {
    part_num: String(data.part_num ?? data['part-num'] ?? data.partNum ?? data.product_model ?? data.productModel ?? data.model ?? data.mpn ?? ''),
    description: data.description ? String(data.description) : undefined,
    total_avail: Number(data.total_avail ?? data['total-avail'] ?? data.available_quantity ?? data.availableQuantity ?? data.qty ?? data.quantity ?? 0),
    batches,
    location: data.location ? String(data.location) : undefined,
    last_updated: String(data.last_updated ?? data['last-updated'] ?? data.lastUpdated ?? data.update_date ?? new Date().toISOString()),
    customer_id: data.customer_id ? String(data.customer_id) : undefined,
  };
}

function validateAndTransformPrice(data: Record<string, unknown>): PriceRecord {
  return {
    part_num: String(data.part_num ?? data['part-num'] ?? data.partNum ?? data.product_model ?? data.productModel ?? data.model ?? data.mpn ?? ''),
    customer_id: String(data.customer_id ?? data['customer-id'] ?? data.customerId ?? 'UNKNOWN'),
    quoted_price: Number(data.quoted_price ?? data['quoted-price'] ?? data.quotedPrice ?? data.price ?? data.unit_price ?? 0),
    currency: String(data.currency ?? data['币种'] ?? 'USD'),
    quote_date: String(data.quote_date ?? data['quote-date'] ?? data.quoteDate ?? data.date ?? new Date().toISOString()),
    valid_days: Number(data.valid_days ?? data['valid-days'] ?? data.validDays ?? data.validity ?? 30),
    min_qty: Number(data.min_qty ?? data['min-qty'] ?? data.minQty ?? data.moq ?? 1),
    lead_time_days: data.lead_time_days ? Number(data.lead_time_days) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
  };
}

function parseBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value === 'true' || value === '1' || value === 'yes';
  }
  return Boolean(value);
}

function parseBoolean(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 'yes';
}

function validateOrderStatus(status: string): OrderLedger['status'] {
  const validStatuses: OrderLedger['status'][] = ['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED'];
  const upper = status.toUpperCase() as OrderLedger['status'];
  return validStatuses.includes(upper) ? upper : 'PENDING';
}
