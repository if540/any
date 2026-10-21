// Markdown 表格外包一層可捲動區塊：窄螢幕表格太寬時，鍵盤使用者也能聚焦後用方向鍵捲動
// （WCAG 2.1.1 鍵盤操作）。表格本身維持 table 顯示，不用 display:block，避免輔助科技不再視為表格。
// 是否真的需要捲動由 src/scripts/post.ts 判斷；不需要時移除 tabindex 與 region，避免多餘的 Tab 停駐點。

const textOf = (node) =>
  'value' in node ? node.value : (node.children ?? []).map(textOf).join('');

const firstRowCells = (table) => {
  const section = table.children.find((c) => c.type === 'element' && (c.tagName === 'thead' || c.tagName === 'tbody'));
  const row = section?.children.find((c) => c.type === 'element' && c.tagName === 'tr');
  return (row?.children ?? []).filter((c) => c.type === 'element').map((c) => textOf(c).trim()).filter(Boolean);
};

export function tableRegion() {
  return {
    name: 'table-region',
    element: {
      filter: ['table'],
      visit(node, ctx) {
        const cols = firstRowCells(node);
        ctx.wrapNode(node, {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['table-wrap'],
            role: 'region',
            tabIndex: 0,
            // 用欄位名稱當區塊名稱，同一頁有多個表格時才分得出來
            ariaLabel: cols.length ? `表格：${cols.join('、')}` : '表格',
          },
          children: [],
        });
      },
    },
  };
}
