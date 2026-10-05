// Engine-tested stage inputs shared by the UI, recorder and feasibility search.
export const STAGE_GUST_SENTENCE = '假設七美轉運點上午七點到十點，半徑 1 公里風速 ×1.25';
export const STAGE_GUST_HELPER = 'What-if：七美近岸局部強風，非單日實測；事件風速仍低於測站逐時 p99 約 17.6 m/s [S1]。';
export const STAGE_GUST = {kind: 'gust', nodeId: 'qimei-transfer', radiusKm: 1, fromH: 7, toH: 10, multiplier: 1.25};
export const STAGE_EXTRA_DRONE_BASE = 'magong-transfer';
export const urgentOrder = () => ({id: 'ORD-JIBEI', label: '吉貝衛生所', destinationNodeId: 'N11', doses: 30,
  deadlineMin: 690, receivingWindow: [480, 690], priority: 'urgent'});
