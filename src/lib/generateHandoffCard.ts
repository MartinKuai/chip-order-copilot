/**
 * 交接卡片生成器
 *
 * 生成 Markdown 格式的交接卡片，支持一键复制
 */

import type { RiskAssessment } from '../types';

/**
 * 生成纯文本格式的交接卡片（适合复制到企微/飞书）
 */
export function generateHandoffCardText(assessment: RiskAssessment): string {
  const { handover_card, risks, overall_risk_level } = assessment;

  const lines: string[] = [];

  lines.push('【订单交接卡片】');
  lines.push('');

  // 基本信息
  lines.push('【订单信息】');
  lines.push(`订单号: ${handover_card.order_id}`);
  lines.push(`客户: ${handover_card.customer_name}`);
  lines.push(`销售负责人: ${handover_card.sales_rep}`);
  lines.push(`当前处理人: ${handover_card.handler}`);
  lines.push('');

  // 物料清单
  lines.push('【物料清单】');
  for (const item of handover_card.items) {
    let line = `${item.part_number} x ${item.quantity}颗`;
    if (item.special_requirements.length > 0) {
      line += ` (${item.special_requirements.join(', ')})`;
    }
    lines.push(line);
  }
  lines.push('');

  // 缺失信息
  if (handover_card.missing_info.length > 0) {
    lines.push('【缺失信息】');
    handover_card.missing_info.forEach(info => {
      lines.push(`- ${info}`);
    });
    lines.push('');
  }

  // 风险等级
  const riskText = overall_risk_level === 'HIGH' ? '高风险' :
                   overall_risk_level === 'MEDIUM' ? '中风险' :
                   overall_risk_level === 'LOW' ? '低风险' : '安全';
  lines.push(`【风险等级】${riskText}`);
  lines.push(handover_card.risk_summary);
  lines.push('');

  // 需要补充的内容
  const highRisks = risks.filter(r => r.level === 'HIGH');
  if (highRisks.length > 0) {
    lines.push('【需要补充】');
    highRisks.forEach((risk, i) => {
      lines.push(`${i + 1}. ${risk.owner}: ${risk.suggestion}`);
    });
    lines.push('');
  }

  // 发货结论
  lines.push('【发货建议】');
  lines.push(handover_card.ship_conclusion);
  lines.push('');

  // 生成时间
  lines.push(`生成时间: ${handover_card.generated_at}`);
  lines.push('');
  lines.push('-- 由 Chip Order Copilot 生成');

  return lines.join('\n');
}

/**
 * 生成 Markdown 格式的交接卡片
 */
export function generateHandoffCardMarkdown(assessment: RiskAssessment): string {
  const { handover_card, risks, overall_risk_level } = assessment;

  const lines: string[] = [];

  lines.push('# 订单交接卡片');
  lines.push('');

  // 基本信息
  lines.push('## 订单信息');
  lines.push(`- **订单号**: ${handover_card.order_id}`);
  lines.push(`- **客户**: ${handover_card.customer_name}`);
  lines.push(`- **销售负责人**: ${handover_card.sales_rep}`);
  lines.push(`- **当前处理人**: ${handover_card.handler}`);
  lines.push('');

  // 物料清单
  lines.push('## 物料清单');
  for (const item of handover_card.items) {
    let line = `- **${item.part_number}** x ${item.quantity}颗`;
    if (item.special_requirements.length > 0) {
      line += ` (${item.special_requirements.join(', ')})`;
    }
    lines.push(line);
  }
  lines.push('');

  // 缺失信息
  if (handover_card.missing_info.length > 0) {
    lines.push('## 缺失信息');
    handover_card.missing_info.forEach(info => {
      lines.push(`- ${info}`);
    });
    lines.push('');
  }

  // 风险等级
  const riskIcon = overall_risk_level === 'HIGH' ? '🔴' :
                   overall_risk_level === 'MEDIUM' ? '🟡' :
                   overall_risk_level === 'LOW' ? '🟢' : '✅';
  const riskText = overall_risk_level === 'HIGH' ? '高风险' :
                   overall_risk_level === 'MEDIUM' ? '中风险' :
                   overall_risk_level === 'LOW' ? '低风险' : '安全';

  lines.push('## 风险评估');
  lines.push(`- **风险等级**: ${riskIcon} ${riskText}`);
  lines.push(`- **摘要**: ${handover_card.risk_summary}`);
  lines.push('');

  // 需要补充的内容
  const highRisks = risks.filter(r => r.level === 'HIGH');
  if (highRisks.length > 0) {
    lines.push('## 需要补充');
    highRisks.forEach((risk, i) => {
      lines.push(`${i + 1}. **${risk.owner}**: ${risk.suggestion}`);
    });
    lines.push('');
  }

  // 发货结论
  lines.push('## 发货建议');
  lines.push(handover_card.ship_conclusion);
  lines.push('');

  // 尾部
  lines.push('---');
  lines.push(`*生成时间: ${handover_card.generated_at}*`);
  lines.push('*由 Chip Order Copilot 生成*');

  return lines.join('\n');
}

/**
 * 复制到剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
