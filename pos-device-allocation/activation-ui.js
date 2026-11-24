"use strict";

const taskDialog = document.getElementById("task-dialog");
const batchTaskFilters = new Map();
const taskSelections = new Map();

function activationViews(view) {
  const views = [["allocation", "导入批次"], ["tasks", "设备激活任务"]];
  return `<nav class="view-switch" aria-label="激活任务管理视图">${views.map(([path, label]) =>
    `<a href="#${path}"${path === view ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}

function taskStatusBadge(task) {
  const style = { pending: "pending", activated: "active", voided: "voided" }[task.status];
  return badge(style, activationStatuses[task.status]);
}

function latestTaskResult(task) {
  if (task.voided) return task.voided.reason;
  const attempt = task.attempts[0];
  if (!attempt) return "";
  if (attempt.result === "success") return "激活成功";
  if (attempt.unbind === "pending") return `${attempt.reason}，解绑待处理`;
  return attempt.reason;
}

function matchesTask(task, filter) {
  return includes(task.serial, filter.serial) && (!filter.status || task.status === filter.status) &&
    (!filter.brand || includes(task.target.brand, filter.brand) || includes(task.target.brandId, filter.brand)) &&
    (!filter.store || includes(task.target.store, filter.store) || includes(task.target.storeId, filter.store) || includes(task.target.storeCode, filter.store)) &&
    includes(task.batchId, filter.batch) && (!filter.source || task.source === filter.source) &&
    matchesTimeRange(task.createdAt, filter);
}

function taskListKey(batchId) {
  return batchId ? `batch:${batchId}` : "tasks";
}

function filteredTasks(state, batchId = "") {
  const filter = batchId ? batchTaskFilters.get(batchId) ?? {} : filters.tasks;
  return state.tasks.filter(task => (!batchId || task.batchId === batchId) && matchesTask(task, filter));
}

function taskTable(tasks, batchId = "") {
  const key = taskListKey(batchId);
  const page = listPage(key, tasks);
  const eligible = new Set(tasks.filter(canVoidTask).map(task => task.id));
  const selected = taskSelections.get(key);
  if (selected) {
    for (const id of selected) {
      if (!eligible.has(id)) selected.delete(id);
    }
  }
  const headers = [
    ...(selected ? ["选择"] : []),
    "生成时间", "设备号", "目标品牌", "目标门店", "来源", "批次号", "任务状态", "最近激活结果", "操作"
  ];
  const rows = page.rows.map(task => row(
    ...(selected ? [eligible.has(task.id) ? `<input class="task-checkbox" type="checkbox" name="taskId" value="${esc(task.id)}" aria-label="选择设备 ${esc(task.serial)}"${selected.has(task.id) ? " checked" : ""}>` : plain("")] : []),
    `<span class="num">${date(task.createdAt)}</span>`,
    `<span class="num">${esc(task.serial)}</span>`, esc(task.target.brand), esc(task.target.store), activationSources[task.source], plain(task.batchId),
    taskStatusBadge(task), `<span class="result-reason">${plain(latestTaskResult(task))}</span>`,
    `<div class="actions device-actions">${link(`task/${task.id}${batchId ? `/${batchId}` : ""}`, "查看任务详情")}
      ${eligible.has(task.id) ? taskAction(task, "void-task", "作废", "link-button danger-text") : ""}
    </div>`
  ));
  return `<form data-form="select-void" data-list="${esc(key)}" data-batch="${esc(batchId)}">
    ${selected ? `<div class="batch-void-toolbar" role="group" aria-label="批量作废操作">
        <div class="actions"><span data-selected-count aria-live="polite">已选 ${selected.size} 台</span>
          <button class="link-button" type="button" data-action="select-all-void"${eligible.size ? "" : " disabled"}>选中全部</button>
          <button class="link-button" type="button" data-action="clear-void"${selected.size ? "" : " disabled"}>全部取消</button>
        </div>
        <div class="actions"><button class="button danger" type="submit"${selected.size ? "" : " disabled"}>确认作废</button>
          <button class="button" type="button" data-action="cancel-void-selection">取消操作</button>
        </div>
      </div>` : eligible.size ? `<div class="batch-void-toolbar actions align-right"><button class="button danger-outline" type="button" data-action="start-void-selection">批量作废</button></div>` : ""}
    ${bodyTable(headers, rows, "暂无符合条件的设备激活任务")}
  </form>${pagination(page)}`;
}

function updateTaskSelection(form, selected) {
  for (const box of form.querySelectorAll('[name="taskId"]')) box.checked = selected.has(box.value);
  form.querySelector("[data-selected-count]").textContent = `已选 ${selected.size} 台`;
  form.querySelector('[data-action="clear-void"]').disabled = selected.size === 0;
  form.querySelector('[type="submit"]').disabled = selected.size === 0;
}

function changeTaskSelection(field) {
  const form = field.form;
  const selected = taskSelections.get(form.dataset.list);
  if (field.checked) selected.add(field.value);
  else selected.delete(field.value);
  updateTaskSelection(form, selected);
}

function resetTaskPage(batchId = "") {
  const key = taskListKey(batchId);
  listPages.delete(key);
  taskSelections.delete(key);
}

function renderTasks(state) {
  const f = filters.tasks;
  const tasks = filteredTasks(state);
  return `${pageHeader(allocationTitle, '<button class="button primary" type="button" data-action="open-single" aria-haspopup="dialog">单台分配</button>')}${activationViews("tasks")}
    <div class="stack list-stack">
      <form class="surface filter" data-form="task-filter" aria-label="搜索设备激活任务">
        <div class="form-grid">
          ${textInput("设备号", "serial", f.serial, "输入设备号")}
          ${textInput("品牌名称 / 编号", "brand", f.brand, "输入目标品牌")}
          ${textInput("门店名称 / 编号", "store", f.store, "输入目标门店或收钱吧门店号")}
          ${selectInput("任务状态", "status", { "": "全部状态", ...activationStatuses }, f.status || "")}
          ${selectInput("来源", "source", { "": "全部来源", ...activationSources }, f.source || "")}
          ${textInput("批次号", "batch", f.batch, "输入批次号")}
          ${timeRangeInput("生成时间范围", f)}
        </div>
        <div class="actions align-right"><button class="button" type="button" data-action="reset-tasks">重置</button><button class="button primary">搜索</button></div>
      </form>
      <section class="surface">
        <div class="panel-title"><h2>任务列表</h2></div>
        ${taskTable(tasks)}
      </section>
    </div>`;
}

function taskBatchContent(state, batch) {
  const f = batchTaskFilters.get(batch.id) ?? {};
  const tasks = filteredTasks(state, batch.id);
  return `<form class="filter batch-task-filter" data-form="batch-task-filter" data-id="${esc(batch.id)}" aria-label="搜索本批设备任务">
    <div class="form-grid">
      ${textInput("设备号", "serial", f.serial, "输入设备号")}
      ${selectInput("任务状态", "status", { "": "全部状态", ...activationStatuses }, f.status || "")}
      <div class="actions filter-inline"><button class="button" type="button" data-action="reset-batch-tasks" data-id="${esc(batch.id)}">重置</button><button class="button primary">搜索</button></div>
    </div>
  </form>${taskTable(tasks, batch.id)}`;
}

function activationHistory(task, device) {
  const headers = ["激活时间", "结果", "设备 ID", "收钱吧终端号", "原因", "解绑情况", "操作"];
  return bodyTable(headers, task.attempts.map(attempt => {
    const succeeded = attempt.result === "success";
    const wrongStoreCode = attempt.reasonCode === "mismatch" ? attempt.actualStore?.storeCode : "";
    const reason = wrongStoreCode ? `${attempt.reason}（实际收钱吧门店号 ${wrongStoreCode}）` : attempt.reason;
    const unbindStatus = succeeded && attempt.unbind === "done" ? "已解绑" : "";
    const canViewDevice = succeeded && !attempt.unbind && attempt.terminal && device?.sqbTerminal === attempt.terminal;
    return row(
      `<span class="num">${date(attempt.time)}</span>`, esc({ success: "成功", failed: "失败", unknown: "结果待确认" }[attempt.result]),
      plain(succeeded ? task.deviceId : ""), plain(succeeded ? attempt.terminal : ""),
      plain(reason), plain(unbindStatus),
      canViewDevice ? link(`device/${device.id}`, "设备详情", "nowrap") : plain("")
    );
  }), "暂无激活记录");
}

function taskAction(task, action, title, style = "button") {
  return `<button type="button" class="${style}" data-action="${action}" data-id="${esc(task.id)}">${title}</button>`;
}

function renderTaskDetail(state, task) {
  const device = state.devices.find(item => item.active && item.id === task.deviceId && item.taskId === task.id);
  const editable = canEditActivationTask(task);
  let controls = "";
  if (canVoidTask(task)) controls += taskAction(task, "void-task", "作废", "button danger-outline");
  if (device) controls += link(`device/${device.id}`, "查看设备", "button primary");
  if (task.status === "pending") {
    if (task.attempts[0]?.unbind === "pending") controls += taskAction(task, "retry-unbind", "重试解绑", "button primary");
    else if (task.attempts[0]?.result === "unknown") controls += taskAction(task, "lookup-pos", "模拟核对激活结果");
    else controls += taskAction(task, "simulate-pos", "模拟 POS 激活");
  }
  return `${pageHeader("设备激活任务详情", `<div class="actions">${controls}</div>`, "tasks")}
    <div class="stack">
      <section class="surface section" aria-label="任务信息"><h2>任务信息</h2>${displayFields([
        ["设备号", esc(task.serial)], ["任务编号", esc(task.id)], ["任务状态", taskStatusBadge(task)],
        ["分配时间", date(task.createdAt)],
        ["批次号", task.batchId ? link(`result/${task.batchId}`, task.batchId) : "—"],
        ["作废信息", task.voided ? `${esc(task.voided.reason)}${task.voided.user ? ` · ${esc(task.voided.user)} · ${date(task.voided.time)}` : ""}` : "—"],
        ["提交人", plain(task.user)]
      ])}</section>
      <section class="surface section" aria-label="目标门店"><h2>目标门店</h2>${displayFields([
        ...targetFields(task.target),
        ["收钱吧激活码", `<span class="actions">${task.code ? '<span aria-label="激活码已隐藏">••••••</span>' : "—"}
          ${editable ? taskAction(task, "edit-task-code", "修改激活码", "link-button") : ""}</span>`]
      ])}</section>
      <section class="surface section" aria-label="预分配银行卡终端参数"><div class="section-heading"><h2>预分配银行卡终端参数</h2>
        ${editable ? taskAction(task, "edit-task-bank", "编辑") : ""}</div>${displayFields([
        ["刷卡收单机构", esc(bankModes[task.mode])], ["商户号", plain(task.merchant)], ["终端号", plain(task.terminal)]
      ])}</section>
      <section class="surface" aria-label="激活记录"><div class="panel-title"><h2>激活记录</h2></div>${activationHistory(task, device)}</section>
    </div>`;
}

function openTaskDialog(title, content, { kind = "", id = "", label = "", danger = false, list = "", wide = false } = {}) {
  if (taskDialog.open) return;
  taskDialog.classList.toggle("wide-dialog", wide);
  taskDialog.innerHTML = `<form${kind ? ` data-form="${kind}" data-id="${esc(id)}"` : ""}${list ? ` data-list="${esc(list)}"` : ""}>
    <header class="modal-heading"><h2 id="task-dialog-title">${esc(title)}</h2><button class="modal-close" type="button" data-action="close-task-dialog" aria-label="关闭">×</button></header>
    <div class="modal-body form-stack">${content}<p class="form-error" role="alert"></p></div>
    ${kind ? `<footer class="actions modal-footer align-right"><button class="button" type="button" data-action="close-task-dialog">取消</button><button class="button ${danger ? "danger" : "primary"}" type="submit">${label}</button></footer>` : ""}
  </form>`;
  taskDialog.showModal();
  taskDialog.querySelector("input, select")?.focus({ preventScroll: true });
}

function readTask(id) {
  const task = readState().tasks.find(item => item.id === id);
  if (!task) throw new Error("设备激活任务不存在。");
  return task;
}

function openVoidTasks(ids, list = "") {
  if (!ids.length) throw new Error("请先勾选要作废的设备。");
  openTaskDialog("作废设备激活任务", `<p>已选 ${ids.length} 台设备，作废后可重新分配。</p><label>作废原因<input name="reason" required autocomplete="off" placeholder="输入作废原因"></label>`,
    { kind: "void-tasks", id: ids.join(","), label: "确认作废", danger: true, list });
}

function openPosSimulation(id, lookup) {
  const task = readTask(id);
  const choices = lookup ? { notActivated: "确认上一次未激活成功", success: "确认上一次已激活成功" } : {
    success: "激活成功", invalid: "激活码无效", expired: "激活码过期", foreign: "激活码属于其他门店",
    wrongStore: "实际门店不一致，自动解绑成功", wrongStorePending: "实际门店不一致，自动解绑待处理", unknown: "通信超时，结果未知"
  };
  openTaskDialog(lookup ? "模拟核对激活结果" : "模拟 POS 激活", `${displayFields([["设备号", esc(task.serial)], ["目标门店", esc(task.target.store)]])}
    ${selectInput("演示结果", "outcome", choices, Object.keys(choices)[0])}`, { kind: lookup ? "lookup-pos" : "simulate-pos", id, label: "确认" });
}

function bankHistoryValues(config) {
  if (!config) return "—";
  return `<div class="bank-history-values">
    <div><span class="subtle">收单机构</span> ${plain(deviceBankModes[config.mode])}</div>
    <div><span class="subtle">商户号</span> ${plain(config.merchant)}</div>
    <div><span class="subtle">终端号</span> ${plain(config.terminal)}</div>
  </div>`;
}

function openBankHistory(id) {
  const device = readState().devices.find(item => item.id === id && item.active);
  if (!device) throw new Error("设备已反激活，请返回查看最新状态。");
  const rows = (device.bankChanges ?? []).map(entry => row(
    `<span class="num">${date(entry.time)}</span>`, `<span class="nowrap">${esc(entry.user)}</span>`,
    `<span class="nowrap">${plain(entry.user === "系统" ? "" : entry.from)}</span>`,
    entry.before ? bankHistoryValues(entry.before) : '<span class="muted">初始配置</span>', bankHistoryValues(entry.after)));
  openTaskDialog("银行卡参数变更记录", bodyTable(["时间", "操作人", "操作端", "变更前", "变更后"], rows, "暂无变更记录"), { wide: true });
}

const activationFormActions = {
  "task-filter"(form, values) {
    validateTimeRange(form, values);
    filters.tasks = values;
    resetTaskPage();
    render();
  },
  "batch-task-filter"(form, values) { batchTaskFilters.set(form.dataset.id, values); resetTaskPage(form.dataset.id); render(); },
  "select-void"(form) {
    const list = form.dataset.list;
    openVoidTasks([...(taskSelections.get(list) ?? [])], list);
  },
  async "void-tasks"(form, values) {
    if (!values.reason) throw new Error("请填写作废原因。");
    const ids = new Set(form.dataset.id.split(","));
    const count = await updateState(state => voidTasks(state, ids, values.reason));
    if (form.dataset.list) taskSelections.delete(form.dataset.list);
    taskDialog.close();
    render();
    displayNotice(`${count} 台已作废${count < ids.size ? `，${ids.size - count} 台状态已变化，请核对` : ""}`, count === 0);
  },
  async "edit-task-code"(form, values) {
    if (!values.code) throw new Error("请填写收钱吧激活码。");
    await updateState(state => {
      const task = state.tasks.find(item => item.id === form.dataset.id);
      if (!task || !canEditActivationTask(task)) throw new Error("任务状态已变化，请核对最新的激活结果。");
      task.code = values.code;
      task.updatedAt = new Date().toISOString();
    });
    taskDialog.close();
    render();
    displayNotice("收钱吧激活码已更新");
  },
  async "edit-task-bank"(form, values) {
    const { mode } = values;
    const merchant = mode === "union" ? values.merchant : "";
    const terminal = mode === "union" ? values.terminal : "";
    checkBankPair(mode, merchant, terminal);
    await updateState(state => {
      const task = state.tasks.find(item => item.id === form.dataset.id);
      if (!task || !canEditActivationTask(task)) throw new Error("任务状态已变化，请核对最新的激活结果。");
      Object.assign(task, { mode, merchant, terminal, updatedAt: new Date().toISOString() });
    });
    taskDialog.close();
    render();
    displayNotice("预分配银行卡终端参数已更新");
  },
  "simulate-pos"(form, values) { return submitPosSimulation(form.dataset.id, values.outcome, false); },
  "lookup-pos"(form, values) { return submitPosSimulation(form.dataset.id, values.outcome, true); }
};

async function submitPosSimulation(id, outcome, lookup) {
  await updateState(state => {
    const task = state.tasks.find(item => item.id === id);
    if (!task) throw new Error("设备激活任务不存在。");
    demoActivate(state, task, outcome, { lookup });
  });
  taskDialog.close();
  render();
}

const activationActions = {
  "reset-tasks"() { filters.tasks = {}; resetTaskPage(); render(); },
  "reset-batch-tasks"(button) { batchTaskFilters.delete(button.dataset.id); resetTaskPage(button.dataset.id); render(); },
  "close-task-dialog"() { taskDialog.close(); },
  "void-task"(button) { openVoidTasks([button.dataset.id]); },
  "start-void-selection"(button) {
    taskSelections.set(button.form.dataset.list, new Set());
    render();
    main.querySelector('[data-action="select-all-void"]')?.focus({ preventScroll: true });
  },
  "select-all-void"(button) {
    const form = button.form;
    const selected = new Set(filteredTasks(readState(), form.dataset.batch).filter(canVoidTask).map(task => task.id));
    taskSelections.set(form.dataset.list, selected);
    updateTaskSelection(form, selected);
  },
  "clear-void"(button) {
    const form = button.form;
    const selected = taskSelections.get(form.dataset.list);
    selected.clear();
    updateTaskSelection(form, selected);
    form.querySelector('[data-action="select-all-void"]').focus({ preventScroll: true });
  },
  "cancel-void-selection"(button) {
    taskSelections.delete(button.form.dataset.list);
    render();
    main.querySelector('[data-action="start-void-selection"]')?.focus({ preventScroll: true });
  },
  "edit-task-code"(button) {
    const task = readTask(button.dataset.id);
    if (!canEditActivationTask(task)) throw new Error("请先核对任务状态和激活结果。");
    openTaskDialog("修改收钱吧激活码", `<label>收钱吧激活码<input name="code" required autocomplete="off" placeholder="输入目标门店的新激活码"></label>`,
      { kind: "edit-task-code", id: task.id, label: "保存" });
  },
  "edit-task-bank"(button) {
    const task = readTask(button.dataset.id);
    if (!canEditActivationTask(task)) throw new Error("请先核对任务状态和激活结果。");
    openTaskDialog("编辑预分配银行卡终端参数",
      `${selectInput("刷卡收单机构", "mode", bankModes, task.mode)}${cardFields(task.mode, task.merchant, task.terminal)}`,
      { kind: "edit-task-bank", id: task.id, label: "保存" });
  },
  "simulate-pos"(button) { openPosSimulation(button.dataset.id, false); },
  "lookup-pos"(button) { openPosSimulation(button.dataset.id, true); },
  async "retry-unbind"(button) {
    button.disabled = true;
    await updateState(state => {
      const task = state.tasks.find(item => item.id === button.dataset.id);
      if (!task) throw new Error("设备激活任务不存在。");
      retryUnbindDemo(task);
    });
    render();
    displayNotice("错绑终端已解绑，可在原任务重试激活");
  },
  "bank-history"(button) { openBankHistory(button.dataset.id); },
  "download-import-failures"(button) {
    const batch = readState().batches.find(item => item.id === button.dataset.id);
    if (!batch) throw new Error("批次不存在。");
    const values = batchFailures(batch).map(({ input, reason }) => [input.storeCode, input.serial, input.code,
      ...(batch.mode === "union" ? [input.merchant, input.terminal] : []), reason]);
    downloadWorkbook(`${batch.id}-失败清单.xlsx`, [...fieldsFor(batch.mode), "失败原因"], values);
  }
};
