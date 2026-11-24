"use strict";

const storageKey = "meta-pos-device-allocation-demo-v1";
const currentUser = "实施人员";
const bankModes = { union: "通联", none: "其他" };
const deviceBankModes = { union: "通联", none: "暂不配置银行卡" };
const baseColumns = ["收钱吧门店号", "设备号", "收钱吧激活码"];
const unionColumns = ["通联商户号", "通联终端号"];
const stores = [
  { brand: "栖风咖啡", brandId: "700101", store: "静安万象店", storeId: "QF-101", storeCode: "1580000000000011", sqbStore: "栖风咖啡静安万象店", sqbMerchant: "栖风餐饮管理有限公司", sqbMerchantCode: "1680000000000101" },
  { brand: "栖风咖啡", brandId: "700101", store: "虹桥汇店", storeId: "QF-102", storeCode: "1580000000000012", sqbStore: "栖风咖啡虹桥汇店", sqbMerchant: "栖风餐饮管理有限公司", sqbMerchantCode: "1680000000000101" },
  { brand: "桥南运动", brandId: "700102", store: "龙华中心店", storeId: "QN-201", storeCode: "1580000000000021", sqbStore: "桥南运动龙华中心店", sqbMerchant: "桥南运动用品有限公司", sqbMerchantCode: "1680000000000102" },
  { brand: "青屿书店", brandId: "700103", store: "滨江店", storeId: "QY-301", storeCode: "1580000000000031", sqbStore: "青屿书店滨江店", sqbMerchant: "青屿图书有限公司", sqbMerchantCode: "1680000000000103" }
];
const sampleDeviceSerial = "DEMO-POS-1001";
const sampleDeviceReport = {
  cardActive: true, acquirer: "通联", merchant: "UM-DEMO-219", terminal: "UT-DEMO-009",
  posVersion: "1.4.1", cardVersion: "1.8.3", firmware: "A8S_3.1.0", connection: "Wi-Fi",
  receiptType: "订单", receiptCopies: "1"
};

function fieldsFor(mode) {
  return mode === "union" ? [...baseColumns, ...unionColumns] : baseColumns;
}

function findStore(storeCode) {
  const matches = stores.filter(store => store.storeCode === storeCode);
  return matches.length === 1 ? matches[0] : null;
}

function findLinkedDevice(state, serial) {
  if (!serial) return undefined;
  return state.devices.find(device => device.active && device.serial === serial)
    ?? state.tasks.find(task => task.status === "pending" && task.serial === serial);
}

function linkedDeviceReason(device) {
  return device.active
    ? `设备号已激活，当前归属 ${device.target.brand} / ${device.target.store}`
    : `设备号已分配到任务 ${device.id}（待激活）`;
}

function validateRow(state, row, repeats = 1) {
  const errors = [...(row.formatErrors || [])];
  const target = findStore(row.storeCode);
  if (!row.storeCode) errors.push("收钱吧门店号必填");
  else if (!target) errors.push("收钱吧门店号无法唯一匹配品牌门店");
  if (!row.serial) errors.push("设备号必填");
  else if (/^(?:\d+(?:\.\d+)?e[+-]\d+|\d+\.\d+e\d+)$/i.test(row.serial)) errors.push("设备号请以文本格式填写，保留完整编号");
  if (!row.code) errors.push("收钱吧激活码必填");
  if (row.mode === "union" && Boolean(row.merchant) !== Boolean(row.terminal)) {
    errors.push("通联商户号和终端号须成对填写");
  }
  if (repeats > 1 && row.serial) errors.push("同一清单内设备号重复");
  const linked = findLinkedDevice(state, row.serial);
  if (linked) errors.push(linkedDeviceReason(linked));
  return { ...row, target: target ? { ...target } : null, errors };
}

function checkRows(state, rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.serial, (counts.get(row.serial) || 0) + 1);
  return rows.map(row => validateRow(state, row, counts.get(row.serial)));
}

function addDevice(state, row, time = new Date().toISOString()) {
  const device = {
    id: String(state.nextDevice++), serial: row.serial, code: row.code,
    target: { ...row.target }, mode: row.mode, merchant: row.merchant, terminal: row.terminal,
    active: false, sqbTerminal: "", type: "", version: "", report: null, createdAt: time, updatedAt: time
  };
  state.devices.unshift(device);
  return device;
}

function makeBatch(state, { filename, remark, mode, rows }, time = new Date().toISOString()) {
  const day = time.slice(0, 10).replaceAll("-", "");
  const batch = {
    id: `PD-${day}-${String(state.nextBatch++).padStart(4, "0")}`,
    filename, remark, mode, user: currentUser, checkedAt: time,
    status: "checking", inputRows: rows, checked: [], execution: null, failure: ""
  };
  state.batches.unshift(batch);
  return batch;
}

const batchCheckCancellationReason = "全部检查未通过";

function finishBatchCheck(state, batch) {
  if (batch.status !== "checking") return;
  batch.checked = checkRows(state, batch.inputRows);
  const hasValidRows = batch.checked.some(row => !row.errors.length);
  batch.status = hasValidRows ? "ready" : "cancelled";
  if (!hasValidRows) batch.cancelled = { reason: batchCheckCancellationReason, time: new Date().toISOString() };
  batch.failure = "";
  delete batch.inputRows;
}

function executeBatch(state, batch, time = new Date().toISOString()) {
  if (batch.execution) return batch.execution;
  if (!batch.checked.some(row => row.errors.length === 0)) throw new Error("本批次没有可执行的设备");

  const rows = batch.checked.map(row => {
    if (row.errors.length) return { row: row.line, status: "skipped", reason: row.errors.join("；") };
    const target = findStore(row.storeCode);
    if (!target || target.brandId !== row.target.brandId || target.storeId !== row.target.storeId) {
      return { row: row.line, status: "failed", reason: "原确认的门店归属已变更或失效" };
    }
    const linked = findLinkedDevice(state, row.serial);
    if (linked) return { row: row.line, status: "failed", reason: linkedDeviceReason(linked) };
    const task = addActivationTask(state, row, { batchId: batch.id, time });
    return { row: row.line, status: "success", taskId: task.id };
  });

  batch.execution = { time, user: currentUser, rows };
  batch.status = "succeeded";
  batch.failure = "";
  return batch.execution;
}

function cleanInput(value) {
  return String(value ?? "").trim();
}

function workbookRows(file, mode, buffer) {
  let book;
  try {
    book = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("无法读取该清单，请下载对应模板后重新上传。");
  }
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet || !sheet["!ref"]) throw new Error("清单没有可检查的数据。");
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  range.s = { r: 0, c: 0 };
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, range, raw: false, defval: "", blankrows: true });
  const expected = fieldsFor(mode);
  const header = (matrix[0] || []).map(cleanInput);
  const optionalReason = header[expected.length] === "失败原因";
  const permittedColumns = expected.length + Number(optionalReason);
  if (expected.some((field, index) => header[index] !== field) || header.slice(permittedColumns).some(Boolean)) {
    throw new Error(`「${file.name}」的表头与所选模板不符，请按对应模板填写。`);
  }
  const rows = matrix.slice(1).flatMap((cells, index) => {
    if (!cells.slice(0, expected.length).some(value => cleanInput(value)) && !cells.slice(permittedColumns).some(value => cleanInput(value))) return [];
    const [storeCode, serial, code, merchant = "", terminal = ""] = cells.slice(0, expected.length).map(cleanInput);
    const formatErrors = [];
    expected.forEach((field, col) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: col })];
      if (cell?.t === "n" && Math.abs(cell.v) >= 1e15) formatErrors.push(`${field}请以文本格式填写，避免长编号失真`);
    });
    if (cells.slice(permittedColumns).some(value => cleanInput(value))) formatErrors.push("清单含模板之外的字段");
    return [{ line: index + 2, storeCode, serial, code, mode, merchant, terminal, formatErrors }];
  });
  if (!rows.length) throw new Error("清单没有设备记录，请填写后重新上传。");
  return rows;
}

function downloadWorkbook(filename, columns, rows) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
  sheet["!cols"] = columns.map(field => ({ wch: field === "失败原因" ? 46 : 24 }));
  XLSX.utils.book_append_sheet(book, sheet, "POS 设备清单");
  XLSX.writeFile(book, filename, { compression: true });
}

function demoRow(line, storeCode, serial, code, mode = "none", merchant = "", terminal = "") {
  return { line, storeCode, serial, code, mode, merchant, terminal, formatErrors: [] };
}

function initialState() {
  const state = { devices: [], batches: [], tasks: [], nextTask: 1, nextDevice: 230127000100, nextBatch: 1 };
  const active = addDevice(state, {
    ...demoRow(2, stores[0].storeCode, sampleDeviceSerial, "SQB-DEMO-101", "union", "UM-DEMO-231", "UT-DEMO-011"), target: stores[0]
  }, "2026-11-20T01:24:00Z");
  Object.assign(active, {
    active: true, sqbTerminal: "1000000000000011", type: "联迪 A8S", version: sampleDeviceReport.posVersion,
    report: { ...sampleDeviceReport }, updatedAt: "2026-11-20T02:13:00Z"
  });
  seedBankConfiguration(active, active.updatedAt);

  const handled = makeBatch(state, {
    filename: "桥南运动配机清单.xlsx", remark: "龙华中心店 · 新店配机", mode: "none",
    rows: [demoRow(2, stores[2].storeCode, "DEMO-POS-1002", "SQB-DEMO-201"), demoRow(3, "1580000000000099", "DEMO-POS-1003", "SQB-DEMO-999")]
  }, "2026-11-22T03:18:00Z");
  finishBatchCheck(state, handled);
  executeBatch(state, handled, "2026-11-22T03:23:00Z");

  const awaiting = makeBatch(state, {
    filename: "栖风咖啡首批设备.xlsx", remark: "静安和虹桥门店 · 11 月新店", mode: "union",
    rows: [
      demoRow(2, stores[0].storeCode, "DEMO-POS-1101", "SQB-DEMO-101", "union", "UM-DEMO-231", "UT-DEMO-021"),
      demoRow(3, stores[0].storeCode, "DEMO-POS-1102", "SQB-DEMO-101", "union", "UM-DEMO-231", "UT-DEMO-022"),
      demoRow(4, stores[1].storeCode, "DEMO-POS-1103", "SQB-DEMO-102", "union", "UM-DEMO-231", "UT-DEMO-023"),
      demoRow(5, "1580000000000099", "DEMO-POS-1104", "SQB-DEMO-999", "union")
    ]
  }, "2026-11-23T02:06:00Z");
  finishBatchCheck(state, awaiting);
  addActivationTask(state, {
    ...demoRow(2, stores[3].storeCode, "DEMO-POS-1102", "SQB-DEMO-301"), target: stores[3]
  }, { time: "2026-11-23T02:13:00Z" });
  return state;
}

function exampleSerialsInUse(state) {
  const used = new Set([...state.devices, ...state.tasks].map(item => item.serial));
  for (const batch of state.batches) for (const row of batch.inputRows ?? batch.checked) used.add(row.serial);
  return used;
}

function addExampleBatches(state) {
  const examples = [
    ["青屿书店滨江店.xlsx", "滨江店开业 · 首批收银设备", "none", "checking", [3, 3, 3]],
    ["桥南运动补充设备.xlsx", "龙华中心店 · 增补设备", "union", "checkFailed", [2, 2, 2]],
    ["栖风咖啡跨店配机.xlsx", "静安和虹桥门店 · 新店增补", "union", "ready", [0, 0, 1, 1, 3, -1]],
    ["青屿书店扩容.xlsx", "滨江店 · 周末扩容", "none", "executing", [3, 3, 3, 3]],
    ["桥南运动月度配机.xlsx", "龙华中心店 · 月度配机", "union", "succeeded", [2, 2, 2, -1]],
    ["栖风咖啡虹桥汇.xlsx", "虹桥汇店 · 开业配机", "union", "executionFailed", [1, 1, 1]],
    ["青屿书店换修清单.xlsx", "滨江店 · 换修新机", "none", "succeeded", [3, 3, 3]],
    ["栖风咖啡追加清单.xlsx", "静安万象店 · 追加配机", "none", "checkFailed", [0, 0]],
    ["桥南运动第二批.xlsx", "龙华中心店 · 开店第二批", "union", "executing", [2, 2, 2, 2, -1]],
    ["栖风咖啡试营业.xlsx", "静安万象店 · 试营业", "none", "ready", [0, 0, 1]]
  ];
  const usedSerials = exampleSerialsInUse(state);
  examples.forEach(([filename, remark, mode, status, targets], index) => {
    const time = `2026-11-${String(21 - index).padStart(2, "0")}T02:30:00Z`;
    const rows = targets.map((target, rowIndex) => {
      let serial = `DEMO-POS-${2101 + index * 10 + rowIndex}`;
      while (usedSerials.has(serial)) serial += "-S";
      usedSerials.add(serial);
      const storeCode = stores[target]?.storeCode ?? "1580000000000099";
      return demoRow(rowIndex + 2, storeCode, serial, `SQB-${serial}`, mode,
        mode === "union" ? `UM-DEMO-${index + 230}` : "", mode === "union" ? `UT-${serial}` : "");
    });
    const batch = makeBatch(state, { filename, remark, mode, rows }, time);
    batch.user = index % 3 === 1 ? "运营人员" : currentUser;
    if (!["checking", "checkFailed"].includes(status)) finishBatchCheck(state, batch);
    if (status === "succeeded") {
      executeBatch(state, batch, time);
      const examples = batchTasks(state, batch);
      if (examples[0]) demoActivate(state, examples[0], "success", { time });
      if (examples[1] && index === 4) demoActivate(state, examples[1], "expired", { time });
      if (examples[1] && index === 6) demoActivate(state, examples[1], "wrongStorePending", { time });
      if (examples[2] && index === 6) voidTasks(state, new Set([examples[2].id]), "现场核对后撤销分配", time);
    }
    batch.status = status;
    if (status === "checkFailed") batch.failure = "检查任务已中断，请重试检查。";
    if (status === "executionFailed") batch.failure = "分配任务已中断，请重试执行。";
    state.batches.push(state.batches.shift());
  });
}

function addActivatedExampleBatches(state) {
  const examples = [
    { filename: "青屿书店滨江换机.xlsx", remark: "滨江店 · 换机配机", mode: "union", targets: [3, 3, 3, 3, 3], activated: 3, voided: 2 },
    { filename: "桥南运动龙华配机.xlsx", remark: "龙华中心店 · 新店配机", mode: "none", targets: [2, 2, 2, 2, 2, -1], activated: 3, voided: 0 },
    { filename: "栖风咖啡开店配机.xlsx", remark: "静安和虹桥门店 · 开店配机", mode: "union", targets: [0, 0, 1, 1], activated: 4, voided: 0 }
  ];
  const usedSerials = exampleSerialsInUse(state);
  examples.forEach(({ filename, remark, mode, targets, activated, voided }, index) => {
    const time = `2026-11-24T0${index + 1}:30:00Z`;
    const rows = targets.map((target, rowIndex) => {
      let serial = `DEMO-POS-${3101 + index * 10 + rowIndex}`;
      while (usedSerials.has(serial)) serial += "-S";
      usedSerials.add(serial);
      return demoRow(rowIndex + 2, stores[target]?.storeCode ?? "1580000000000099", serial, `SQB-${serial}`, mode,
        mode === "union" ? `UM-DEMO-${241 + index}` : "", mode === "union" ? `UT-${serial}` : "");
    });
    const batch = makeBatch(state, { filename, remark, mode, rows }, time);
    finishBatchCheck(state, batch);
    executeBatch(state, batch, time);
    const tasks = batchTasks(state, batch);
    tasks.slice(0, activated).forEach(task => demoActivate(state, task, "success", { time }));
    if (voided) voidTasks(state, new Set(tasks.slice(activated, activated + voided).map(task => task.id)), "现场核对后撤销配机", time);
  });
  state.batches.sort((first, second) => second.checkedAt.localeCompare(first.checkedAt));
}

function readState() {
  const saved = localStorage.getItem(storageKey);
  const state = saved ? JSON.parse(saved) : initialState();
  const oldExample = state.devices.find(device => device.serial === sampleDeviceSerial && device.active && device.report === undefined);
  if (oldExample) oldExample.report = { ...sampleDeviceReport };
  migrateActivationTasks(state);
  if (!state.exampleBatchesAdded) {
    for (const batch of state.batches) batch.status ??= batch.execution ? "succeeded" : "ready";
    addExampleBatches(state);
    state.exampleBatchesAdded = true;
  }
  if (!state.legacyExampleAdded) {
    const legacy = addDevice(state, {
      ...demoRow(2, stores[1].storeCode, "", "LITE-DEMO-102"), target: stores[1]
    }, "2026-11-23T03:15:00Z");
    legacy.origin = "legacy";
    state.legacyExampleAdded = true;
  }
  if (!state.activatedExamplesAdded) {
    addActivatedExampleBatches(state);
    state.activatedExamplesAdded = true;
  }
  for (const batch of state.batches) {
    if (batch.status === "noValidRows" || (batch.status === "ready" && batch.checked.length && batch.checked.every(row => row.errors.length))) {
      batch.status = "cancelled";
      batch.cancelled ??= { reason: batchCheckCancellationReason };
    }
  }
  return state;
}

function updateState(change) {
  const save = () => {
    const state = readState();
    const result = change(state);
    localStorage.setItem(storageKey, JSON.stringify(state));
    return result;
  };
  return navigator.locks ? navigator.locks.request(storageKey, save) : Promise.resolve().then(save);
}
