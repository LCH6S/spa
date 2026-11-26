"use strict";

const main = document.getElementById("main");
const notice = document.getElementById("notice");
const dialog = document.getElementById("confirm-dialog");
const singleDialog = document.getElementById("single-dialog");
const bankDialog = document.getElementById("bank-dialog");
const legacyDialog = document.getElementById("legacy-dialog");
const deletePopover = document.getElementById("delete-popover");
const allocationTitle = "激活任务管理";
const filters = { allocation: {}, tasks: {}, devices: {} };
const listPages = new Map();
const listPageSize = 10;
const selectedTabs = new Map();
const runningBatches = new Set();
const batchStatuses = {
  "": "全部状态", checking: "检查中", checkFailed: "检查失败", ready: "待执行",
  executing: "执行中", succeeded: "执行完成", executionFailed: "执行失败", cancelled: "已取消"
};
const progressLabels = { total: "共导入", pending: "待处理", activated: "已处理", failed: "导入失败", voided: "已作废" };
let activeView = null;
let noticeTimer;
let confirmOperation;
let deleteAnchor;

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit"
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, symbol => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[symbol]);
}

function date(value) {
  return value ? dateFormat.format(new Date(value)) : "—";
}

function matchesTimeRange(value, { startTime, endTime }) {
  if (!startTime && !endTime) return true;
  if (!value) return false;
  const minute = date(value).replace(" ", "T");
  return (!startTime || minute >= startTime) && (!endTime || minute <= endTime);
}

function plain(value) {
  return value ? esc(value) : '<span class="muted">—</span>';
}

function badge(type, label) {
  return `<span class="pill ${type}">${esc(label)}</span>`;
}

function link(path, text, css = "") {
  return `<a href="#${esc(path)}"${css ? ` class="${css}"` : ""}>${esc(text)}</a>`;
}

function textInput(label, name, value = "", placeholder = "") {
  return `<label>${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>`;
}

function selectInput(label, name, options, value) {
  return `<label>${label}<select name="${name}">${Object.entries(options).map(([key, text]) =>
    `<option value="${esc(key)}"${key === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
}

function timeRangeInput(label, { startTime, endTime }) {
  return `<fieldset class="time-range">
    <legend>${esc(label)}</legend>
    <div class="time-range-fields">
      <label>开始时间<input type="datetime-local" name="startTime" value="${esc(startTime)}"></label>
      <label>结束时间<input type="datetime-local" name="endTime" value="${esc(endTime)}" aria-describedby="time-range-error"></label>
    </div>
    <p class="form-error" id="time-range-error" role="alert"></p>
  </fieldset>`;
}

function bodyTable(headers, rows, emptyMessage) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="empty">${emptyMessage}</td></tr>`}</tbody></table></div>`;
}

function listPage(key, records) {
  const pageCount = Math.max(1, Math.ceil(records.length / listPageSize));
  const page = Math.min(listPages.get(key) ?? 1, pageCount);
  listPages.set(key, page);
  const offset = (page - 1) * listPageSize;
  return { key, page, pageCount, rows: records.slice(offset, offset + listPageSize) };
}

function pagination({ key, page, pageCount }) {
  if (pageCount < 2) return "";
  const button = (number, label, name, extra = "") => `<button class="button" type="button" data-action="list-page" data-list="${esc(key)}" data-page="${number}" aria-label="${name}"${extra}>${label}</button>`;
  const numbers = Array.from(new Set([1, page - 2, page - 1, page, page + 1, page + 2, pageCount]))
    .filter(number => number >= 1 && number <= pageCount).sort((a, b) => a - b);
  return `<nav class="pagination" aria-label="分页">${button(page - 1, "上一页", "上一页", page === 1 ? " disabled" : "")}
    ${numbers.map((number, index) => `${index && number > numbers[index - 1] + 1 ? '<span aria-hidden="true">…</span>' : ""}${button(number, number, `第 ${number} 页`, number === page ? ' aria-current="page"' : "")}`).join("")}
    ${button(page + 1, "下一页", "下一页", page === pageCount ? " disabled" : "")}</nav>`;
}

function row(...cells) {
  return `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`;
}

function displayFields(fields) {
  return `<dl class="meta-grid">${fields.map(([label, value]) =>
    `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function targetFields(target, includeSqbStoreCode = true) {
  const fields = [["品牌名称", plain(target.brand)], ["品牌编号", plain(target.brandId)],
    ["门店名称", plain(target.store)], ["门店编号", plain(target.storeId)]];
  if (includeSqbStoreCode) fields.push(["收钱吧门店号", plain(target.storeCode)]);
  return fields;
}

function routeTo(path) {
  if (location.hash.slice(1) === path) render();
  else location.hash = path;
}

function displayNotice(message, error = false) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.className = `notice visible${error ? " error" : ""}`;
  noticeTimer = setTimeout(() => { notice.className = "notice"; }, 3800);
}

function setFormError(form, message) {
  const element = form.querySelector(".form-error");
  if (element) element.textContent = message;
  else if (message) displayNotice(message, true);
}

function countChecked(batch) {
  return batch.checked.filter(row => !row.errors.length).length;
}

function batchRows(batch) {
  return batch.inputRows ?? batch.checked;
}

function batchProgress(state, batch) {
  const result = { total: batchRows(batch).length, pending: 0, activated: 0, failed: batchFailures(batch).length, voided: 0 };
  for (const task of batchTasks(state, batch)) result[task.status]++;
  return result;
}

function includes(value, search) {
  return !search || String(value ?? "").toLowerCase().includes(search.toLowerCase());
}

function pageHeader(title, action = "", parent = "allocation") {
  const root = { devices: "POS 激活管理", tasks: "设备激活任务" }[parent] ?? allocationTitle;
  return `<nav class="breadcrumbs" aria-label="当前位置"><span>集团客户</span><span aria-hidden="true">/</span><span>IOT 管理</span><span aria-hidden="true">/</span>${title === root ? `<span>${root}</span>` : `${link(parent, root)}<span aria-hidden="true">/</span><span>${esc(title)}</span>`}</nav>
    <div class="page-heading"><h1>${esc(title)}</h1>${action}</div>`;
}

function stepper(current) {
  return `<div class="steps" aria-label="设备分配步骤">${["上传", "检查", "执行"].map((text, i) =>
    `<span class="step"${i + 1 === current ? ' aria-current="step"' : ""}><b>${i + 1}</b>${text}</span>`).join("")}</div>`;
}

function renderAllocations(state) {
  const f = filters.allocation;
  const batches = state.batches.filter(batch =>
    includes(batch.id, f.query) &&
    includes(batch.remark, f.remark) && includes(batch.user, f.user) &&
    (!f.serial || batchRows(batch).some(row => includes(row.serial, f.serial))) &&
    matchesTimeRange(batch.checkedAt, f) && (!f.status || f.status === batch.status));
  const page = listPage("allocation", batches);
  const rows = page.rows.map(batch => {
    const status = batch.status;
    const executionStage = ["executing", "succeeded", "executionFailed"].includes(status);
    const open = link(`${executionStage ? "result" : "check"}/${batch.id}`, "查看详情", "nowrap");
    const progress = batchProgress(state, batch);
    return row(`<span class="num">${esc(batch.id)}</span>`, `<div class="file-cell">${esc(batch.filename)}</div>`,
      `<div class="remark-cell">${plain(batch.remark)}</div>`, plain(bankModes[batch.mode]), badge(status, batchStatuses[status]),
      ...Object.keys(progressLabels).map(key => progress[key]), esc(batch.user), `<span class="num">${date(batch.checkedAt)}</span>`, open);
  });
  return `${pageHeader(allocationTitle, link("upload", "上传设备清单", "button primary"))}${activationViews("allocation")}
    <div class="stack list-stack">
      <form class="surface filter" data-form="allocation-filter" aria-label="搜索分配批次">
        <div class="form-grid allocation-filter-grid">
          ${textInput("批次号", "query", f.query, "输入批次号")}
          ${textInput("批次备注", "remark", f.remark, "输入备注关键词")}
          ${textInput("设备号", "serial", f.serial, "输入设备号")}
          ${textInput("提交人", "user", f.user, "输入提交人")}
          ${timeRangeInput("上传时间范围", f)}
          ${selectInput("导入进度", "status", batchStatuses, f.status || "")}
        </div>
        <div class="actions align-right"><button type="button" class="button" data-action="reset-allocation">重置</button><button class="button primary">搜索</button></div>
      </form>
      <section class="surface" aria-label="批次列表">
        <div class="panel-title"><h2>批次列表</h2></div>
        ${bodyTable(["批次号", "文件名", "批次备注", "刷卡收单机构", "导入进度", ...Object.values(progressLabels), "提交人", "上传时间", "操作"], rows, "暂无符合条件的批次")}
        ${pagination(page)}
      </section>
    </div>`;
}

function renderUpload() {
  return `${pageHeader("上传设备清单")}${stepper(1)}
    <section class="surface section form-body">
      <form data-form="upload" class="form-stack">
        <div class="form-grid">
          ${selectInput("刷卡收单机构", "mode", bankModes, "union")}
          <div class="actions"><button class="link-button" type="button" data-action="download-template">下载模板</button></div>
        </div>
        <label>批次备注<input name="remark" placeholder="例如品牌、开店批次或发货单号" autocomplete="off"></label>
        <label class="file-upload">设备清单<input type="file" name="file" accept=".xlsx,.xls" required><span class="hint">支持 .xlsx、.xls。编号请按文本填写，保留前导零。</span></label>
        <p class="form-error" role="alert"></p>
        <div class="actions inline-footer align-right">${link("allocation", "取消", "button")}<button class="button primary" type="submit">上传并检查</button></div>
      </form>
    </section>`;
}

function batchMeta(batch, showDeviceCount = true) {
  return `<section class="surface" aria-label="批次信息">${displayFields([
    ["批次号", esc(batch.id)], ["上传文件", esc(batch.filename)], ["刷卡收单机构", esc(bankModes[batch.mode])],
    ["批次备注", plain(batch.remark)], ["提交人", esc(batch.user)], ["上传时间", date(batch.checkedAt)],
    ...(showDeviceCount ? [["设备记录", `${batchRows(batch).length} 条`]] : []),
    ...(batch.cancelled?.user ? [["取消人", esc(batch.cancelled.user)]] : []),
    ...(batch.cancelled?.time ? [["取消时间", date(batch.cancelled.time)]] : []),
    ...(batch.cancelled?.reason ? [["取消原因", esc(batch.cancelled.reason)]] : [])
  ])}</section>`;
}

function tabs(key, options, preferred, panel) {
  const active = selectedTabs.get(key) || preferred;
  return `<div class="tabs" role="tablist" aria-label="设备结果">${options.map(([id, label, count]) => `
    <button type="button" role="tab" id="tab-${id}" data-action="tab" data-tab="${id}" data-tab-key="${key}" aria-controls="tab-content" aria-selected="${active === id}" tabindex="${active === id ? 0 : -1}">${label}（${count}）</button>`).join("")}</div>
    <div id="tab-content" role="tabpanel" aria-labelledby="tab-${active}">${panel(active)}</div>`;
}

function previewPass(rows) {
  const headers = ["设备号", "品牌名称", "品牌编号", "门店名称", "门店编号", "收钱吧门店号", "收单机构", "通联商户号", "通联终端号"];
  return bodyTable(headers, rows.map(({ serial, target, mode, merchant, terminal }) => row(
    plain(serial), plain(target.brand), plain(target.brandId), plain(target.store), plain(target.storeId),
    plain(target.storeCode), plain(bankModes[mode]), plain(merchant), plain(terminal)
  )), "没有通过检查的设备");
}

function batchStatusPanel(batch, action = "") {
  const running = ["checking", "executing"].includes(batch.status);
  return `<section class="surface" aria-label="批次处理状态">
    <div class="status-panel" role="status">
      ${running ? '<span class="spinner" aria-hidden="true"></span>' : ""}
      ${badge(batch.status, batchStatuses[batch.status])}
      ${batch.failure ? `<p class="muted">${esc(batch.failure)}</p>` : ""}
    </div>
    ${action ? `<div class="footer-actions align-right">${action}</div>` : ""}
  </section>`;
}

function renderCheck(batch) {
  const title = "检查设备清单";
  const cancelled = batch.status === "cancelled";
  const header = `${pageHeader(title, cancelled ? badge(batch.status, batchStatuses[batch.status]) : "")}${stepper(2)}`;
  const cancel = `<button class="button" type="button" data-action="cancel-batch" data-id="${esc(batch.id)}">取消批次</button>`;
  if (cancelled && !batch.checked.length) return `${header}<div class="stack">${batchMeta(batch)}</div>`;
  if (batch.status === "checking" || batch.status === "checkFailed") {
    const retry = batch.status === "checkFailed" ? `<button class="button primary" data-action="retry-check" data-id="${esc(batch.id)}">重试检查</button>` : "";
    return `${header}<div class="stack">${batchMeta(batch)}${batchStatusPanel(batch, `<div class="actions">${cancel}${retry}</div>`)}</div>`;
  }
  const passed = batch.checked.filter(row => !row.errors.length);
  const failed = batch.checked.filter(row => row.errors.length);
  let nextAction = link(`result/${batch.id}`, "查看批次进度", "button primary");
  if (batch.status === "ready") {
    nextAction = `<div class="actions">${cancel}<button class="button primary" type="button" data-action="execute" data-id="${esc(batch.id)}">执行分配（${passed.length} 台）</button></div>`;
  } else if (cancelled) {
    nextAction = failed.length ? `<button class="button" type="button" data-action="download-import-failures" data-id="${esc(batch.id)}">下载失败清单</button>` : "";
  }
  return `${header}<div class="stack list-stack">${batchMeta(batch)}
    <section class="surface" aria-label="清单检查结果">
      ${tabs(`check-${batch.id}`, [["pass", "设备分配预览", passed.length], ["fail", "导入失败", failed.length]], passed.length ? "pass" : "fail", active =>
        active === "pass" ? previewPass(passed) : bodyTable(["设备号", "收钱吧门店号", "失败原因"], failed.map(item => row(plain(item.serial), plain(item.storeCode), esc(item.errors.join("；")))), "本批次没有导入失败的记录"))}
      ${nextAction ? `<div class="footer-actions align-right">${nextAction}</div>` : ""}
    </section></div>`;
}

function renderImportFailures(batch) {
  const items = batchFailures(batch);
  return `${items.length ? `<div class="panel-title align-right"><button class="button" type="button" data-action="download-import-failures" data-id="${esc(batch.id)}">下载失败清单</button></div>` : ""}
    ${bodyTable(["设备号", "收钱吧门店号", "失败阶段", "失败原因"], items.map(item =>
      row(plain(item.input.serial), plain(item.input.storeCode), esc(item.stage), esc(item.reason))), "本批次没有导入失败的记录")}`;
}

function renderResult(state, batch) {
  const header = `${pageHeader("批次详情")}${stepper(3)}`;
  if (batch.status === "executing" || batch.status === "executionFailed") {
    const retry = batch.status === "executionFailed" ? `<button class="button primary" data-action="execute" data-id="${esc(batch.id)}">重试执行（${countChecked(batch)} 台）</button>` : "";
    return `${header}<div class="stack">${batchMeta(batch)}${batchStatusPanel(batch, retry)}</div>`;
  }
  if (!batch.execution) return renderCheck(batch);
  const progress = batchProgress(state, batch);
  const taskCount = progress.pending + progress.activated + progress.voided;
  const options = [["tasks", "设备激活任务", taskCount], ["failed", "导入失败", progress.failed]];
  return `${header}
    <div class="stack list-stack">${batchMeta(batch, false)}<section class="surface progress-grid" aria-label="批次进度">
      ${Object.entries(progressLabels).map(([key, label]) => `<div class="progress-item"><span>${label}</span><strong>${progress[key]}</strong></div>`).join("")}
    </section><section class="surface" aria-label="批次设备明细">
      ${tabs(`result-${batch.id}`, options, taskCount ? "tasks" : "failed", active => active === "tasks" ? taskBatchContent(state, batch) : renderImportFailures(batch))}
    </section></div>`;
}

function cardFields(mode, merchant = "", terminal = "") {
  return `<div class="form-grid union-fields"${mode === "union" ? "" : " hidden"}>
     ${textInput("通联商户号", "merchant", merchant, "输入机构商户号")}
     ${textInput("通联终端号", "terminal", terminal, "输入机构终端号")}
   </div>`;
}

function openSingle() {
  if (singleDialog.open) return;
  singleDialog.innerHTML = `<form data-form="single">
      <header class="modal-heading"><h2 id="single-title">单台分配</h2><button type="button" class="modal-close" data-action="close-single" aria-label="关闭">×</button></header>
      <div class="modal-body form-stack">
        <label>收钱吧门店号<input name="storeCode" type="text" list="store-options" inputmode="numeric" placeholder="输入收钱吧门店号" required autocomplete="off" autofocus></label>
        <datalist id="store-options">${stores.map(store => `<option value="${esc(store.storeCode)}">${esc(store.brand)} · ${esc(store.store)}</option>`).join("")}</datalist>
        <div id="store-match" class="lookup" hidden></div>
        <p class="field-error" id="store-error" role="alert"></p>
        <label>设备号<input name="serial" placeholder="请输入 POS 设备号" required autocomplete="off" aria-describedby="serial-error"></label>
        <p id="serial-error" class="field-error"></p>
        <label>收钱吧激活码<input name="code" placeholder="输入目标门店激活码" required autocomplete="off"></label>
        ${selectInput("刷卡收单机构", "mode", bankModes, "none")}
        ${cardFields("none")}
        <p class="form-error" role="alert"></p>
      </div>
      <footer class="actions modal-footer align-right"><button class="button" type="button" data-action="close-single">取消</button><button class="button primary" type="submit">确认分配</button></footer>
    </form>`;
  singleDialog.showModal();
}

function showSingleSuccess() {
  singleDialog.innerHTML = `<div class="modal-body"><h2 id="single-title">设备激活任务创建成功</h2></div>
    <div class="actions modal-footer align-right">
      <button class="button" type="button" data-action="close-single">返回</button>
      <button class="button primary" type="button" data-action="view-created-task-list">查看详情</button>
    </div>`;
  if (!singleDialog.open) singleDialog.showModal();
  singleDialog.querySelector('[data-action="view-created-task-list"]').focus({ preventScroll: true });
}

function canUseLegacyActivation(device) {
  return device.origin === "legacy" && !device.active && !device.serial;
}

function legacyActivationButton(device, style = "link-button") {
  return canUseLegacyActivation(device)
    ? `<button type="button" class="${style}" data-action="legacy-activate" data-id="${esc(device.id)}" aria-haspopup="dialog">激活</button>` : "";
}

function deviceListActions(device) {
  const remove = device.active ? "" : `<button type="button" class="link-button danger-text" data-action="row-delete" data-id="${esc(device.id)}" aria-haspopup="dialog" aria-controls="delete-popover" aria-expanded="false">删除</button>`;
  return `<div class="actions device-actions">${link(`device/${device.id}`, "详情")}${legacyActivationButton(device)}${remove}</div>`;
}

function renderDevices(state) {
  const f = filters.devices;
  const statuses = { "": "全部状态", pending: "未激活", active: "已激活" };
  const devices = state.devices.filter(device => (device.active || device.origin === "legacy") && includes(device.id, f.id) && includes(device.serial, f.serial) &&
    includes(device.sqbTerminal, f.terminal) && (!f.brand || includes(device.target.brand, f.brand) || includes(device.target.brandId, f.brand)) &&
    (!f.store || includes(device.target.store, f.store) || includes(device.target.storeId, f.store) || includes(device.target.storeCode, f.store)) &&
    (!f.status || f.status === (device.active ? "active" : "pending")));
  return `${pageHeader("POS 激活管理")}<div class="stack">
    <form class="surface filter" data-form="device-filter" aria-label="搜索设备">
      <div class="form-grid">
        ${textInput("设备 ID", "id", f.id, "输入设备 ID")}
        ${textInput("设备号", "serial", f.serial, "输入设备号")}
        ${textInput("收钱吧终端号", "terminal", f.terminal, "输入收钱吧终端号")}
        ${textInput("品牌名称 / 编号", "brand", f.brand, "输入品牌名称或编号")}
        ${textInput("门店名称 / 编号", "store", f.store, "输入门店名称、编号或收钱吧门店号")}
        ${selectInput("设备状态", "status", statuses, f.status || "")}
      </div>
      <div class="actions align-right"><button type="button" class="button" data-action="reset-devices">重置</button><button class="button primary">搜索</button></div>
    </form>
    <section class="surface">
      <div class="panel-title"><h2>设备列表</h2></div>
      ${bodyTable(["状态更新时间", "设备 ID", "设备号", "设备类型", "收钱吧终端号", "应用版本", "品牌名称", "门店名称", "设备状态", "操作"], devices.map(device => row(
        `<span class="num">${date(device.updatedAt)}</span>`, esc(device.id), plain(device.serial), plain(device.type), plain(device.sqbTerminal), plain(device.version),
        esc(device.target.brand), esc(device.target.store), badge(device.active ? "active" : "pending", device.active ? "已激活" : "未激活"), deviceListActions(device))), "暂无符合条件的设备")}
    </section>
  </div>`;
}

function sqbTerminalDetails(device) {
  if (!device.active) {
    const activationCode = device.code ? '<span aria-label="激活码已隐藏">••••••</span>' : plain("");
    return `${displayFields([["激活码", activationCode]])}<p class="detail-empty">设备未激活</p>`;
  }
  const store = findStore(device.target.storeCode) ?? device.target;
  return `<div class="detail-fields">${displayFields([["终端号", plain(device.sqbTerminal)]])}${displayFields([
    ["收钱吧商户名", plain(store.sqbMerchant)], ["收钱吧商户号", plain(store.sqbMerchantCode)],
    ["收钱吧门店名", plain(store.sqbStore)], ["收钱吧门店号", plain(store.storeCode)]
  ])}</div>`;
}

function deviceReportDetails(device) {
  const report = device.active ? device.report : null;
  if (!report) return '<p class="detail-empty">无上报信息</p>';
  const cardStatus = typeof report.cardActive === "boolean"
    ? badge(report.cardActive ? "active" : "pending", report.cardActive ? "已激活" : "未激活") : plain("");
  return displayFields([
    ["银行卡是否激活", cardStatus], ["收单机构", plain(report.acquirer)],
    ["机构商户号", plain(report.merchant)], ["机构终端号", plain(report.terminal)],
    ["轻 POS 程序版本", plain(report.posVersion)], ["银行卡程序版本", plain(report.cardVersion)],
    ["固件版本信息", plain(report.firmware)], ["通讯方式", plain(report.connection)],
    ["SIM 卡品牌", plain(report.simBrand)], ["ICCID", plain(report.iccid)], ["IMSI", plain(report.imsi)], ["IMEI", plain(report.imei)],
    ["打印小票类型", plain(report.receiptType)], ["打印小票联数", plain(report.receiptCopies)]
  ]);
}

function renderDevice(device, source) {
  const back = source ? link(`result/${source}`, "返回批次结果", "button") : link("devices", "返回设备列表", "button");
  const action = device.active ? `<button class="button danger-outline" type="button" data-action="deactivate" data-id="${esc(device.id)}">反激活</button>` : "";
  return `${pageHeader("POS 激活详情", `<div class="actions">${back}${legacyActivationButton(device, "button primary")}${action}</div>`, "devices")}
    <div class="stack">
      <section class="surface section" aria-label="设备信息"><h2>设备信息</h2>${displayFields([
        ["设备 ID", esc(device.id)], ["创建时间", date(device.createdAt)], ["状态更新时间", date(device.updatedAt)],
        ["设备状态", badge(device.active ? "active" : "pending", device.active ? "已激活" : "未激活")],
        ["设备号", plain(device.serial)], ["设备类型", plain(device.type)]
      ])}</section>
      <section class="surface section" aria-label="设备归属"><h2>设备归属</h2>${displayFields(targetFields(device.target, false))}</section>
      <section class="surface section" aria-label="收钱吧终端信息"><h2>收钱吧终端信息</h2>${sqbTerminalDetails(device)}</section>
      <section class="surface" aria-label="银行卡终端信息">
        <div class="panel-title"><h2>银行卡终端信息</h2><div class="actions">
          ${device.active ? `<button class="button" type="button" data-action="bank-history" data-id="${esc(device.id)}" aria-haspopup="dialog">变更记录</button>` : ""}
          ${device.serial ? `<button class="button" type="button" data-action="edit-bank" data-id="${esc(device.id)}" aria-haspopup="dialog">编辑</button>` : ""}
        </div></div>
        ${displayFields([["收单机构", device.mode === "union" ? "通联" : "暂不配置银行卡"], ["机构商户号", plain(device.merchant)], ["机构终端号", plain(device.terminal)]])}
      </section>
      <section class="surface section" aria-label="设备上报信息"><h2>设备上报信息</h2>${deviceReportDetails(device)}</section>
    </div>`;
}

function openBankEdit(id) {
  if (bankDialog.open) return;
  const device = readState().devices.find(item => item.id === id);
  if (!device?.serial) return render();
  bankDialog.innerHTML = `<form data-form="bank" data-id="${esc(device.id)}">
      <header class="modal-heading"><h2 id="bank-title">编辑银行卡终端信息</h2><button type="button" class="modal-close" data-action="close-bank" aria-label="关闭">×</button></header>
      <div class="modal-body form-stack">
        <div class="lookup">${displayFields([["设备号", plain(device.serial)], ["品牌名称", esc(device.target.brand)], ["门店名称", esc(device.target.store)]])}</div>
        ${selectInput("银行卡配置", "mode", deviceBankModes, device.mode)}
        ${cardFields(device.mode, device.merchant, device.terminal)}
        <p class="form-error" role="alert"></p>
      </div>
      <footer class="actions modal-footer align-right"><button class="button" type="button" data-action="close-bank">取消</button><button class="button primary" type="submit">保存</button></footer>
    </form>`;
  bankDialog.showModal();
  bankDialog.querySelector('[name="mode"]').focus({ preventScroll: true });
}

function continueBatch(batch) {
  const { id, status } = batch;
  if (!["checking", "executing"].includes(status) || runningBatches.has(id)) return;
  runningBatches.add(id);

  setTimeout(async () => {
    let saved = false;
    try {
      await updateState(state => {
        const current = state.batches.find(item => item.id === id);
        if (current?.status !== status) return;
        if (status === "checking") finishBatchCheck(state, current);
        else executeBatch(state, current);
      });
      saved = true;
    } catch {
      try {
        await updateState(state => {
          const current = state.batches.find(item => item.id === id);
          if (current?.status !== status) return;
          current.status = status === "checking" ? "checkFailed" : "executionFailed";
          current.failure = status === "checking" ? "检查任务已中断，请重试检查。" : "分配任务已中断，请重试执行。";
        });
        saved = true;
      } catch {
        displayNotice("无法保存批次进度，请检查浏览器存储后重试。", true);
      }
    } finally {
      runningBatches.delete(id);
      const [view, viewingId] = (location.hash.slice(1) || "allocation").split("/");
      if (saved && (view === "allocation" || view === "tasks" || viewingId === id)) render();
    }
  }, 950);
}

function render() {
  const key = location.hash.slice(1) || "allocation";
  const [view, id, source] = key.split("/");
  try {
    if (deleteAnchor) deletePopover.hidePopover();
    if (view === "single") {
      history.replaceState(null, "", "#tasks");
      render();
      openSingle();
      return;
    }
    const state = readState();
    if (activeView !== key) taskSelections.clear();
    const batch = state.batches.find(item => item.id === id);
    const device = state.devices.find(item => item.id === id);
    const task = state.tasks.find(item => item.id === id);
    if (view === "device" && !device) {
      const migrated = state.tasks.find(item => item.migratedDeviceId === id);
      if (migrated) {
        history.replaceState(null, "", `#task/${migrated.id}${migrated.batchId ? `/${migrated.batchId}` : ""}`);
        render();
        return;
      }
    }
    if (view === "bank" && device?.serial) {
      history.replaceState(null, "", `#device/${device.id}${source ? `/${source}` : ""}`);
      render();
      openBankEdit(device.id);
      return;
    }
    const activation = ["devices", "device", "bank"].includes(view);
    document.getElementById("allocation-nav").setAttribute("aria-current", activation ? "false" : "page");
    document.getElementById("devices-nav").setAttribute("aria-current", activation ? "page" : "false");
    if (view === "upload") main.innerHTML = renderUpload();
    else if (view === "check" && batch) main.innerHTML = renderCheck(batch);
    else if (view === "result" && batch) main.innerHTML = renderResult(state, batch);
    else if (view === "tasks") main.innerHTML = renderTasks(state);
    else if (view === "task" && task) main.innerHTML = renderTaskDetail(state, task);
    else if (view === "devices") main.innerHTML = renderDevices(state);
    else if (view === "device" && device) main.innerHTML = renderDevice(device, source);
    else if (activation) main.innerHTML = `${pageHeader("POS 激活详情", "", "devices")}<p class="surface empty">设备记录已删除或不存在。${link("devices", "返回设备列表")}</p>`;
    else main.innerHTML = renderAllocations(state);
    document.title = `${main.querySelector("h1").textContent} · 运营管理平台`;
    if (activeView !== key) {
      if (view !== "tasks" && singleDialog.open) singleDialog.close();
      if (bankDialog.open) bankDialog.close();
      if (taskDialog.open) taskDialog.close();
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      activeView = key;
    }
    if (batch && ["check", "result"].includes(view)) continueBatch(batch);
  } catch (error) {
    console.error(error);
    main.innerHTML = `${pageHeader(allocationTitle)}<p class="surface empty" role="alert">无法读取本地分配记录，请检查浏览器存储权限后重新打开。</p>`;
  }
}

function getFormValues(form) {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, typeof value === "string" ? cleanInput(value) : value]));
}

function updateStoreLookup(form) {
  const value = cleanInput(form.elements.storeCode.value);
  const target = findStore(value);
  const match = document.getElementById("store-match");
  const error = document.getElementById("store-error");
  match.hidden = !target;
  match.innerHTML = target ? displayFields(targetFields(target)) : "";
  error.textContent = value && !target ? "收钱吧门店号无法唯一匹配品牌门店" : "";
  form.elements.storeCode.setAttribute("aria-invalid", Boolean(error.textContent));
}

function updateSerialLookup(form) {
  const serial = cleanInput(form.elements.serial.value);
  const device = findLinkedDevice(readState(), serial);
  document.getElementById("serial-error").textContent = device ? linkedDeviceReason(device) : "";
  form.elements.serial.setAttribute("aria-invalid", Boolean(device));
}

function checkBankPair(mode, merchant, terminal) {
  if (mode === "union" && Boolean(merchant) !== Boolean(terminal)) throw new Error("通联商户号和终端号须成对填写。");
}

function validateTimeRange(form, { startTime, endTime }) {
  if (startTime && endTime && startTime > endTime) {
    form.elements.endTime.setAttribute("aria-invalid", "true");
    form.elements.endTime.focus();
    throw new Error("结束时间不能早于开始时间。");
  }
}

const formActions = {
  ...activationFormActions,
  "allocation-filter"(form, values) {
    validateTimeRange(form, values);
    filters.allocation = values;
    listPages.delete("allocation");
    render();
  },
  "device-filter"(form, values) { filters.devices = values; render(); },
  async upload(form, values) {
    const file = values.file;
    if (!file?.size) throw new Error("请选择设备清单。");
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("请选择 .xlsx 或 .xls 文件。");
    const rows = workbookRows(file, values.mode, await file.arrayBuffer());
    const batch = await updateState(state => makeBatch(state, { filename: file.name, remark: values.remark, mode: values.mode, rows }));
    routeTo(`check/${batch.id}`);
  },
  async single(form, values) {
    updateStoreLookup(form);
    updateSerialLookup(form);
    const mode = values.mode;
    const merchant = mode === "union" ? values.merchant : "";
    const terminal = mode === "union" ? values.terminal : "";
    checkBankPair(mode, merchant, terminal);
    await updateState(state => {
      const data = validateRow(state, { ...values, merchant, terminal });
      if (data.errors.length) throw new Error(data.errors.join("；"));
      addActivationTask(state, data);
    });
    render();
    showSingleSuccess();
  },
  async bank(form, values) {
    checkBankPair(values.mode, values.merchant, values.terminal);
    await updateState(state => {
      const device = state.devices.find(item => item.id === form.dataset.id);
      if (!device?.serial) throw new Error("设备已经解除关联，请返回查看最新状态。");
      changeBankConfiguration(device, { mode: values.mode, merchant: values.mode === "union" ? values.merchant : "", terminal: values.mode === "union" ? values.terminal : "" });
    });
    bankDialog.close();
    render();
    main.querySelector('[data-action="edit-bank"]')?.focus({ preventScroll: true });
    displayNotice("银行卡终端信息已保存");
  }
};

document.addEventListener("submit", async event => {
  const form = event.target;
  const handler = formActions[form.dataset.form];
  if (!handler) return;
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  setFormError(form, "");
  try {
    await handler(form, getFormValues(form));
  } catch (error) {
    setFormError(form, error.message || "办理失败，请重试。");
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});

singleDialog.addEventListener("input", event => {
  const field = event.target;
  if (field.form?.dataset.form !== "single") return;
  setFormError(field.form, "");
  if (field.name === "storeCode") updateStoreLookup(field.form);
  if (field.name === "serial") updateSerialLookup(field.form);
});

document.addEventListener("change", event => {
  const field = event.target;
  if (field.type === "datetime-local" && field.closest(".time-range")) {
    field.form.elements.endTime.removeAttribute("aria-invalid");
    setFormError(field.form, "");
  }
  const bank = field.form?.querySelector(".union-fields");
  if (field.name === "mode" && bank) bank.hidden = field.value !== "union";
  if (field.name === "taskId" && field.form?.dataset.form === "select-void") changeTaskSelection(field);
});

function askConfirmation(title, description, actionLabel, operation) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-description").textContent = description;
  document.getElementById("confirm-action").textContent = actionLabel;
  confirmOperation = operation;
  dialog.returnValue = "cancel";
  dialog.showModal();
}

dialog.addEventListener("close", async () => {
  const operation = confirmOperation;
  confirmOperation = null;
  if (dialog.returnValue !== "confirm" || !operation) return;
  try {
    await operation();
  } catch (error) {
    render();
    displayNotice(error.message, true);
  }
});

function requestDeactivation(id) {
  const device = readState().devices.find(item => item.id === id);
  if (!device?.active) return render();
  askConfirmation("反激活设备", `确认反激活 ${device.serial}？原收钱吧终端将解绑，设备号与银行卡参数将从这条设备记录中清除。`, "确认反激活", async () => {
    await updateState(state => {
      const current = state.devices.find(item => item.id === id);
      if (!current?.active) throw new Error("设备状态已变化，请查看最新状态。");
      if (current.origin !== "legacy") {
        const task = state.tasks.find(item => item.id === current.taskId);
        const attempt = task?.attempts.find(item => item.result === "success" && item.terminal === current.sqbTerminal);
        if (attempt) attempt.unbind = "done";
        state.devices = state.devices.filter(item => item.id !== id);
        return;
      }
      Object.assign(current, {
        active: false, serial: "", code: "", mode: "none", merchant: "", terminal: "",
        sqbTerminal: "", type: "", version: "", report: null, updatedAt: new Date().toISOString()
      });
    });
    routeTo("devices");
    displayNotice("设备已反激活，设备号已释放");
  });
}

function deleteDescription(device) {
  return `确认删除设备实体 ${device.id}？${device.serial ? `设备号 ${device.serial} 将解除关联，可重新分配。` : "该设备记录将被移除。"}`;
}

function deletePendingDevice(id) {
  return updateState(state => {
    const current = state.devices.find(item => item.id === id);
    if (!current || current.active) throw new Error("设备已删除或激活，请查看最新状态。");
    state.devices = state.devices.filter(item => item.id !== id);
  });
}

function placeDeletePopover() {
  if (!deleteAnchor) return;
  const rect = deleteAnchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = deletePopover;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const above = rect.bottom + height + 14 > window.innerHeight;
  const top = above ? rect.top - height - 8 : rect.bottom + 8;
  deletePopover.dataset.side = above ? "above" : "below";
  deletePopover.style.left = `${left}px`;
  deletePopover.style.top = `${Math.max(8, top)}px`;
  deletePopover.style.setProperty("--arrow-x", `${Math.max(12, Math.min(width - 12, (rect.left + rect.right) / 2 - left))}px`);
}

function openRowDelete(button) {
  const device = readState().devices.find(item => item.id === button.dataset.id);
  if (!device || device.active) return render();
  if (deleteAnchor) deletePopover.hidePopover();
  deleteAnchor = button;
  button.setAttribute("aria-expanded", "true");
  document.getElementById("row-delete-description").textContent = deleteDescription(device);
  deletePopover.showPopover();
  placeDeletePopover();
  deletePopover.querySelector('[data-action="cancel-row-delete"]').focus({ preventScroll: true });
}

deletePopover.addEventListener("beforetoggle", event => {
  if (event.newState === "closed" && deleteAnchor) {
    deleteAnchor.setAttribute("aria-expanded", "false");
    deleteAnchor = null;
  }
});
window.addEventListener("resize", placeDeletePopover);
window.addEventListener("scroll", placeDeletePopover, true);

function showLegacyActivation(id) {
  const device = readState().devices.find(item => item.id === id);
  if (!device || !canUseLegacyActivation(device)) return render();
  const code = qrcode(0, "M");
  code.addData(`lightpos-demo:${device.id}:${device.code || "activation"}`);
  code.make();
  legacyDialog.innerHTML = `<header class="modal-heading"><h2 id="legacy-title">设备激活</h2><button class="modal-close" type="button" data-action="close-legacy" aria-label="关闭">×</button></header>
    <div class="legacy-content"><div class="legacy-target">${displayFields(targetFields(device.target))}</div>
      <div class="legacy-code"><div role="img" aria-label="轻 POS 激活二维码">${code.createSvgTag({ cellSize: 4, margin: 16 })}</div><p>请用轻 POS 扫码激活</p></div>
    </div>`;
  legacyDialog.showModal();
}

function selectTab(button) {
  selectedTabs.set(button.dataset.tabKey, button.dataset.tab);
  render();
  document.getElementById(`tab-${button.dataset.tab}`)?.focus({ preventScroll: true });
}

main.addEventListener("keydown", event => {
  const button = event.target.closest('[role="tab"]');
  if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const choices = [...button.parentElement.querySelectorAll('[role="tab"]')];
  const position = choices.indexOf(button);
  const keys = { Home: 0, End: choices.length - 1, ArrowLeft: (position - 1 + choices.length) % choices.length,
    ArrowRight: (position + 1) % choices.length };
  event.preventDefault();
  selectTab(choices[keys[event.key]]);
});

const actions = {
  ...activationActions,
  "reset-allocation"() { filters.allocation = {}; listPages.delete("allocation"); render(); },
  "list-page"(button) {
    listPages.set(button.dataset.list, Number(button.dataset.page));
    render();
    main.querySelector('.pagination [aria-current="page"]')?.focus({ preventScroll: true });
  },
  "reset-devices"() { filters.devices = {}; render(); },
  "open-single": openSingle,
  "close-single"() { singleDialog.close(); },
  "view-created-task-list"() {
    singleDialog.close();
    filters.tasks = {};
    resetTaskPage();
    routeTo("tasks");
  },
  "edit-bank"(button) { openBankEdit(button.dataset.id); },
  "close-bank"() { bankDialog.close(); },
  "download-template"(button) {
    const mode = button.closest("form").elements.mode.value;
    downloadWorkbook(`POS设备分配模板-${bankModes[mode]}.xlsx`, fieldsFor(mode), []);
  },
  async execute(button) {
    button.disabled = true;
    const id = button.dataset.id;
    await updateState(state => {
      const batch = state.batches.find(item => item.id === id);
      if (!batch) throw new Error("批次不存在。");
      if (batch.status === "executing" || batch.status === "succeeded") return;
      if (!["ready", "executionFailed"].includes(batch.status) || !countChecked(batch)) {
        throw new Error("本批次没有可执行的设备。");
      }
      batch.status = "executing";
      batch.failure = "";
    });
    routeTo(`result/${id}`);
  },
  async "retry-check"(button) {
    button.disabled = true;
    const id = button.dataset.id;
    await updateState(state => {
      const batch = state.batches.find(item => item.id === id);
      if (batch?.status !== "checkFailed" || !batch.inputRows) throw new Error("请查看批次的最新状态。");
      batch.status = "checking";
      batch.failure = "";
    });
    routeTo(`check/${id}`);
  },
  "cancel-batch"(button) {
    const id = button.dataset.id;
    askConfirmation("取消导入批次", `确认取消批次 ${id}？批次及检查结果将保留。`, "确认取消", async () => {
      await updateState(state => {
        const batch = state.batches.find(item => item.id === id);
        if (!batch || !["checking", "checkFailed", "ready"].includes(batch.status)) throw new Error("批次状态已变化，请查看最新结果。");
        batch.status = "cancelled";
        batch.cancelled = { user: currentUser, time: new Date().toISOString() };
      });
      render();
      displayNotice("批次已取消");
    });
  },
  tab: selectTab,
  deactivate(button) { requestDeactivation(button.dataset.id); },
  "row-delete": openRowDelete,
  "cancel-row-delete"() {
    const anchor = deleteAnchor;
    deletePopover.hidePopover();
    anchor?.focus({ preventScroll: true });
  },
  async "confirm-row-delete"(button) {
    const id = deleteAnchor?.dataset.id;
    if (!id) return;
    button.disabled = true;
    try {
      await deletePendingDevice(id);
      render();
      displayNotice("设备记录已删除");
    } catch (error) {
      render();
      displayNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  },
  "legacy-activate"(button) { showLegacyActivation(button.dataset.id); },
  "close-legacy"() { legacyDialog.close(); }
};

document.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    await actions[button.dataset.action](button);
  } catch (error) {
    button.disabled = false;
    displayNotice(error.message || "操作失败，请重试。", true);
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("storage", event => {
  if (event.key === storageKey && /^(allocation|devices?|tasks?|result|check)(\/|$)/.test(location.hash.slice(1) || "allocation")) render();
});
render();
