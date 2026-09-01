/**
 * UI 冒烟验证脚本（可选工具，不影响构建/运行）：
 * 验证登录、项目/表导航、表头排序（升序/降序）、新建字段、新增记录、
 * Excel 导入、300 行/页分页（满 300 自动出现下一页、翻页按钮位于最后一行数据下方）。
 *
 * 用法（脚本位于项目根目录）：
 *   cd frontend
 *   npm i -D playwright            # 临时安装（用完后可 npm prune 移除）
 *   node ../ui-test.cjs            # 默认 http://localhost:5173（需后端与前端 dev 已启动）
 *   UI_BASE=http://localhost:4173 node ../ui-test.cjs   # 验证 vite preview 生产包
 *
 * 说明：使用本机已安装的 Edge 浏览器（channel: msedge），无需下载 Chromium。
 */
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const BASE = process.env.UI_BASE || 'http://localhost:5173';
// 本地开发默认账号（可用 UI_TEST_USER / UI_TEST_PASSWORD 覆盖，勿用于生产）
const UI_TEST_USER = process.env.UI_TEST_USER || 'admin';
const UI_TEST_PASSWORD = process.env.UI_TEST_PASSWORD || 'Admin123456';
// playwright 装在 frontend 下（临时 npm i -D playwright）
const { chromium } = require(path.join(ROOT, 'frontend', 'node_modules', 'playwright'));

function log(...args) {
  console.log('[ui-test]', ...args);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const apiCalls = [];
  const queryBodies = [];
  page.on('request', (req) => {
    const url = req.url().replace(BASE, '');
    if (url.includes('/api/v1/')) {
      apiCalls.push(`${req.method()} ${url}`);
      if (url.includes('/records/query') && req.method() === 'POST') {
        try {
          queryBodies.push(JSON.parse(req.postData() || '{}'));
        } catch {}
      }
    }
  });
  page.on('pageerror', (err) => log('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log('[console.error]', msg.text().slice(0, 300));
  });

  let failed = false;
  const check = (name, cond) => {
    log(`${cond ? 'PASS' : 'FAIL'} - ${name}`);
    if (!cond) failed = true;
  };

  // 1. 登录
  await page.goto(`${BASE}/login`);
  await page.fill('input[placeholder="用户名或邮箱"]', UI_TEST_USER);
  await page.fill('input[placeholder="密码"]', UI_TEST_PASSWORD);
  await page.click('button:has-text("登 录")');
  await page.waitForURL('**/projects', { timeout: 15000 });
  check('登录成功并跳转 /projects', true);

  // 2. 打开第一个项目 → 项目详情（数据表卡片列表）
  await page.waitForSelector('.project-card', { timeout: 15000 });
  await page.click('.project-card .el-button:has-text("打开")');
  await page.waitForSelector('.table-card', { timeout: 15000 });
  check('打开项目详情（数据表卡片列表）', true);

  // 打开第一个数据表
  await page.click('.table-card .el-button:has-text("打开")');
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 15000 });
  await page.waitForTimeout(1200);
  check('打开数据表视图', true);

  // 记录排序前的第一行值
  const firstRowBefore = await page
    .locator('.vxe-body--row')
    .first()
    .locator('.vxe-cell')
    .allTextContents()
    .catch(() => []);
  log('排序前第一行:', JSON.stringify(firstRowBefore.slice(0, 4)));

  // 记录排序前的整页快照（比较全页）
  const pageSnapshot = async () =>
    page
      .locator('.vxe-body--row')
      .allTextContents()
      .then((rows) => rows.map((r) => r.replace(/\s+/g, '|')).join('#'))
      .catch(() => '');
  const rowsBefore = await pageSnapshot();
  log('排序前快照长度:', rowsBefore.length);
  // 3. 点击第二个表头（第一个为复选框列）两次（升序→降序），验证触发带 sort 的查询且数据变化
  const headers = page.locator('.vxe-header--column .vxe-cell');
  const headerCount = await headers.count();
  log('表头数量:', headerCount);
  await headers.nth(1).click();
  await page.waitForTimeout(1200);
  await headers.nth(1).click();
  await page.waitForTimeout(1500);
  const rowsAfterDesc = await pageSnapshot();
  log('降序后快照长度:', rowsAfterDesc.length);
  const lastBody = queryBodies[queryBodies.length - 1];
  log('最近一次 query 请求体:', JSON.stringify(lastBody));
  check(
    '点击表头后触发了带 sort 的排序查询（升序/降序）',
    Array.isArray(lastBody?.sort) && ['asc', 'desc'].includes(lastBody.sort[0]?.order),
  );
  check('排序后数据发生变化', rowsAfterDesc !== rowsBefore);

  // 4. 字段管理 → 新建字段（不填 fieldKey，自动生成标识）
  await page.click('button:has-text("字段管理")');
  await page.waitForSelector('.fm-toolbar', { timeout: 10000 });
  await page.click('button:has-text("新建字段")');
  await page.waitForSelector('.el-dialog:visible input[placeholder="例如：SKU"]', { timeout: 10000 });
  const fieldName = `UI测试字段${Date.now().toString().slice(-6)}`;
  await page.fill('input[placeholder="例如：SKU"]', fieldName);
  await page.click('.el-dialog:visible button:has-text("保存")');
  await page.waitForTimeout(1500);
  const fieldSaved = await page.locator('.el-message').first().textContent().catch(() => '');
  log('新建字段提示:', fieldSaved);
  check('新建字段成功（出现成功提示）', /已创建/.test(fieldSaved || ''));
  // 关闭两个弹窗：先内层「取消」，再外层「关闭」
  await page.waitForTimeout(600);
  await page.locator('.el-dialog:visible button:has-text("取消")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('.el-dialog:visible button:has-text("关闭")').first().click({ timeout: 5000 }).catch(() => {});

  // 5. 新增记录
  await page.click('button:has-text("新增记录")');
  await page.waitForSelector('.el-dialog:visible .record-form', { timeout: 10000 });
  await page.click('.el-dialog:visible button:has-text("保存")');
  await page.waitForTimeout(1500);
  const recSaved = await page.locator('.el-message').first().textContent().catch(() => '');
  log('新增记录提示:', recSaved);
  check('新增记录成功', /已创建/.test(recSaved || ''));

  // 6. Excel 导入（UI 上传 .xlsx）
  const exceljsPath = path.join(ROOT, 'backend', 'node_modules', 'exceljs');
  if (fs.existsSync(exceljsPath)) {
    const ExcelJS = require(exceljsPath);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    const impSuffix = Date.now().toString().slice(-6);
    ws.addRow(['sku', 'sales']);
    ws.addRow([`UI-IMP-${impSuffix}-1`, 11]);
    ws.addRow([`UI-IMP-${impSuffix}-2`, '22']);
    const buf = await wb.xlsx.writeBuffer();
    const importFile = path.join(ROOT, '.ui-import.xlsx');
    fs.writeFileSync(importFile, Buffer.from(buf));
    await page.click('button:has-text("导入 Excel")');
    await page.waitForSelector('.import-actions', { timeout: 10000 });
    await page.setInputFiles('.el-dialog:visible input[type="file"]', importFile);
    await page.waitForSelector('.el-result', { timeout: 30000 });
    const importTitle = await page.locator('.el-result__title').first().textContent().catch(() => '');
    log('导入结果标题:', importTitle);
    check('Excel 导入成功（成功 2 条）', /成功 2 条/.test(importTitle || ''));
    await page.locator('.el-result__extra button:has-text("完成")').first().click().catch(() => {});
    await page.waitForTimeout(800);
    fs.unlinkSync(importFile);
  } else {
    log('跳过 Excel 导入 UI 测试（未找到后端 exceljs）');
  }

  // 7. 分页：每页 300 行，数据满 300 自动出现下一页，翻页按钮在最后一行数据下方
  const apiBase = BASE + '/api/v1';
  const loginRes = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UI_TEST_USER, password: UI_TEST_PASSWORD }),
  }).then((r) => r.json());
  const token = loginRes.data.accessToken;
  const tableId = new URL(page.url()).pathname.split('/').pop();
  const pagedSku = `PAGETEST-${Date.now().toString().slice(-6)}`;
  const batchPayload = {
    records: Array.from({ length: 305 }, (_, i) => ({ sku: `${pagedSku}-${String(i).padStart(3, '0')}` })),
  };
  const batchRes = await fetch(`${apiBase}/tables/${tableId}/records/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(batchPayload),
  }).then((r) => r.json());
  check('批量创建 305 条分页测试数据', batchRes.data && batchRes.data.created === 305);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const paginationVisible = await page.locator('.tv-pagination').count();
  const pageText1 = await page.locator('.tv-pagination').first().textContent().catch(() => '');
  log('分页条:', paginationVisible, '| 文案:', pageText1);
  check('数据表底部（最后一行数据下方）始终显示翻页按钮', paginationVisible === 1);
  check('分页条显示每页 300 行与页码（第 1 / N 页）', /每页 300 行/.test(pageText1 || '') && /第 1 \/ \d+ 页/.test(pageText1 || ''));

  // 第 1 页满 300 行：滚动表格到底，最后一行（第 300 行）不应被分页条遮挡
  const noOverlap = await page.evaluate(() => {
    const wrapper = document.querySelector('.tv-grid-body .vxe-table--main-wrapper .vxe-table--body-wrapper');
    if (!wrapper) return null;
    wrapper.scrollTop = wrapper.scrollHeight;
    const rows = document.querySelectorAll('.tv-grid-body .vxe-table--main-wrapper .vxe-body--row');
    const lastRow = rows[rows.length - 1];
    const pager = document.querySelector('.tv-pagination');
    if (!lastRow || !pager) return null;
    const lr = lastRow.getBoundingClientRect();
    const pr = pager.getBoundingClientRect();
    return {
      rowCount: rows.length,
      lastRowBottom: Math.round(lr.bottom),
      pagerTop: Math.round(pr.top),
      overlap: lr.bottom > pr.top + 1,
    };
  });
  log('滚动到底后最后一行位置:', JSON.stringify(noOverlap));
  check(
    '第 300 行数据不被分页条遮挡（最后一行完整显示在分页条上方）',
    Boolean(noOverlap) && noOverlap.rowCount === 300 && !noOverlap.overlap,
  );

  // 点击「下一页」按钮翻页（用户要求的上一页/下一页按钮）
  const pagerCount = await page.locator('.tv-pagination .el-pager .number').count();
  if (pagerCount >= 2) {
    await page.locator('.tv-pagination .btn-next').click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const pageText = await page.locator('.tv-pagination').first().textContent().catch(() => '');
    const lastPageBody = queryBodies[queryBodies.length - 1];
    log('点击下一页后文案:', pageText, '| 请求 page:', lastPageBody?.page);
    check('通过「下一页」按钮翻到第 2 页成功', /第 2 \/ \d+ 页/.test(pageText || '') && lastPageBody?.page === 2);

    // 上一页按钮翻回第 1 页
    await page.locator('.tv-pagination .btn-prev').click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const pageTextBack = await page.locator('.tv-pagination').first().textContent().catch(() => '');
    const backBody = queryBodies[queryBodies.length - 1];
    log('点击上一页后文案:', pageTextBack, '| 请求 page:', backBody?.page);
    check('通过「上一页」按钮翻回第 1 页成功', /第 1 \/ \d+ 页/.test(pageTextBack || '') && backBody?.page === 1);
  } else {
    log('当前仅 1 页，跳过翻页点击验证（数据未满 300 行）');
    check('仅 1 页时上一页/下一页按钮禁用', await page.locator('.tv-pagination .btn-prev.is-disabled').count() === 1);
  }

  // 清理分页测试数据（限流 429 时重试一次）
  const q = await fetch(`${apiBase}/tables/${tableId}/records/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filters: [{ field: 'sku', operator: 'starts_with', value: pagedSku }], pageSize: 500 }),
  }).then((r) => r.json());
  const ids = (q.data.records || []).map((r) => r.id);
  log('清理分页测试记录:', ids.length, '条');
  let cleaned = true;
  for (const id of ids) {
    let del = await fetch(`${apiBase}/tables/${tableId}/records/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      del = await fetch(`${apiBase}/tables/${tableId}/records/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (del.status !== 200) cleaned = false;
  }
  check('分页测试数据清理完成', cleaned && ids.length === 305);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const paginationText = await page.locator('.tv-pagination').first().textContent().catch(() => '');
  log('清理后分页条文案:', paginationText);
  check('清理后分页按钮仍在最后一行数据下方（每页 300 行）', /每页 300 行/.test(paginationText || ''));

  // 审计日志：每页切换到 300 行不应报错（pageSize 上限已放开）
  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.audit-filters', { timeout: 10000 });
  await page.locator('.el-pagination .el-select').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('.el-select-dropdown__item', { hasText: '300条/页' }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const auditErr = await page.locator('.el-message--error').count();
  log('审计日志切换 300/页 后错误提示数:', auditErr);
  check('审计日志每页 300 行切换无报错', auditErr === 0);

  // 8. 新建数据表必须是空表（keep-alive 切换回归）：先建测试表并加字段
  const ts = Date.now().toString().slice(-6);
  const projList = await fetch(`${apiBase}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const firstProject = projList.data[0];
  const newTableRes = await fetch(`${apiBase}/projects/${firstProject.id}/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: `UI新表-${ts}`, tableType: 'SYSTEM' }),
  }).then((r) => r.json());
  const newTableId = newTableRes.data.id;
  check('创建新数据表成功', Boolean(newTableId));
  // 给新表加两个字段（新表本身无字段、无数据）
  for (const f of [
    { name: 'SKU', fieldKey: 'sku', fieldType: 'STRING' },
    { name: '数量', fieldKey: 'qty', fieldType: 'NUMBER' },
  ]) {
    await fetch(`${apiBase}/tables/${newTableId}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(f),
    });
  }
  // 通过页面内链接 SPA 导航（keep-alive 组件复用场景）：
  // 项目页 → 旧表（建立 TableView 缓存）→ 表格页顶部项目链接回项目页 → 点开新表（复用缓存）
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.project-card', { timeout: 15000 });
  await page.locator('.project-card').first().locator('button:has-text("打开")').click();
  await page.waitForSelector('.table-card', { timeout: 15000 });
  await page.waitForTimeout(600);
  // 打开旧表（第一个非测试表）
  const oldCard = page
    .locator('.table-card')
    .filter({ hasNotText: `UI新表-${ts}` })
    .first();
  log('旧表卡片:', await oldCard.locator('.table-name').textContent().catch(() => 'none'));
  await oldCard.locator('button:has-text("打开")').click();
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const oldRows = await page.locator('.vxe-body--row').count();
  log('旧表标题:', await page.locator('.tv-title').textContent().catch(() => 'none'), '| 行数:', oldRows);

  // 点击表格页顶部的项目名链接，返回项目详情页（keep-alive 缓存恢复 + 自动刷新）
  await page.locator('.tv-project').first().click({ timeout: 5000 });
  await page.waitForSelector('.table-card', { timeout: 15000 });
  await page.waitForTimeout(800);
  const newCardCount = await page.locator('.table-card', { hasText: `UI新表-${ts}` }).count();
  log('项目页可见新表卡片数:', newCardCount);
  check('返回项目页后能看到新建的数据表', newCardCount === 1);
  // 点开新表（TableView 组件从 keep-alive 缓存复用，watch 路由参数切换）
  await page.locator('.table-card', { hasText: `UI新表-${ts}` }).locator('button:has-text("打开")').click();
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 15000 });
  await page.waitForTimeout(1200);
  const newTableRows = await page.locator('.vxe-body--row').count();
  const newTableEmptyText = await page
    .locator('.tv-grid .el-empty__description')
    .first()
    .textContent()
    .catch(() => '');
  log('新表行数:', newTableRows, '| 空状态:', newTableEmptyText, '| 标题:', await page.locator('.tv-title').textContent().catch(() => ''));
  check('新数据表打开后为空表（0 行、无旧表数据）', newTableRows === 0 && /还没有数据/.test(newTableEmptyText || ''));

  // 9. 批量删除：造 3 条 → 勾选 2 条 → 批量删除 → 剩 1 条
  const batchCreate = await fetch(`${apiBase}/tables/${newTableId}/records/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      records: [
        { sku: `BD-${ts}-1`, qty: 1 },
        { sku: `BD-${ts}-2`, qty: 2 },
        { sku: `BD-${ts}-3`, qty: 3 },
      ],
    }),
  }).then((r) => r.json());
  check('批量创建 3 条测试记录', batchCreate.data && batchCreate.data.created === 3);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 10000 });
  await page.waitForTimeout(1000);
  const rowsBeforeDel = await page.locator('.vxe-body--row').count();
  log('批量删除前行数:', rowsBeforeDel);
  // 勾选前两行
  await page.locator('.vxe-body--row .vxe-cell--checkbox').nth(0).click();
  await page.locator('.vxe-body--row .vxe-cell--checkbox').nth(1).click();
  await page.waitForTimeout(400);
  const delBtnText = await page.locator('button:has-text("批量删除")').first().textContent().catch(() => '');
  log('批量删除按钮:', delBtnText);
  await page.locator('button:has-text("批量删除")').first().click();
  await page.waitForSelector('.el-message-box', { timeout: 5000 });
  await page.locator('.el-message-box button:has-text("删除")').click();
  await page.waitForTimeout(1500);
  const rowsAfterDel = await page.locator('.vxe-body--row').count();
  log('批量删除后行数:', rowsAfterDel);
  check('批量删除 2 条后剩余 1 条', rowsBeforeDel === 3 && rowsAfterDel === 1);

  // 清理：删除测试表
  const delTable = await fetch(`${apiBase}/tables/${newTableId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  check('清理测试表完成', delTable.status === 200);

  // 10. 从数据表切换到「管理表」不应弹「数据表不存在」
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.project-card', { timeout: 15000 });
  await page.locator('.project-card').first().locator('button:has-text("打开")').click();
  await page.waitForSelector('.table-card', { timeout: 15000 });
  await page.locator('.table-card').first().locator('button:has-text("打开")').click();
  await page.waitForSelector('.tv-grid .vxe-table', { timeout: 15000 });
  await page.waitForTimeout(1000);
  log('当前在表格页:', page.url());
  // 展开侧边栏项目树（若未展开），点击「管理表」
  const subOpened = await page
    .locator('.el-sub-menu')
    .first()
    .evaluate((el) => el.classList.contains('is-opened'))
    .catch(() => false);
  if (!subOpened) {
    await page.locator('.aside-menu .el-sub-menu__title').first().click();
    await page.waitForTimeout(600);
  }
  await page.locator('.el-sub-menu .el-menu-item', { hasText: '管理表' }).first().click({ timeout: 8000 });
  await page.waitForSelector('.table-card', { timeout: 10000 });
  await page.waitForTimeout(1000);
  const switchErr = await page.locator('.el-message--error').count();
  const switchMsg = await page.locator('.el-message--error').first().textContent().catch(() => '');
  log('切换到管理表后错误弹窗数:', switchErr, '| 内容:', switchMsg, '| URL:', page.url());
  check('从数据表切换到「管理表」不弹「数据表不存在」', switchErr === 0 && page.url().includes('/projects/'));

  await browser.close();
  log(failed ? '=== 存在失败项 ===' : '=== 全部通过 ===');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('[ui-test] 异常:', err);
  process.exit(1);
});
