"use strict";

const activationStatuses = { pending: "待处理", activated: "已完成", voided: "已作废" };
const activationSources = { single: "单台分配", batch: "批量分配" };

function addActivationTask(state, row, { batchId = "", time = new Date().toISOString() } = {}) {
  const task = {
    id: `AT-${String(state.nextTask++).padStart(5, "0")}`, serial: row.serial,
    target: { ...row.target }, code: row.code, mode: row.mode, merchant: row.merchant, terminal: row.terminal,
    source: batchId ? "batch" : "single", batchId, status: "pending", user: currentUser,
    createdAt: time, updatedAt: time, attempts: []
  };
  state.tasks.unshift(task);
  return task;
}

function activationHold(task) {
  const latest = task.attempts[0];
  if (latest?.unbind === "pending") return "错绑终端解绑待处理";
  if (latest?.result === "unknown") return "上一次激活结果待核对";
  return "";
}

function canVoidTask(task) {
  return task.status === "pending" && !activationHold(task);
}

function canEditActivationTask(task) {
  return task.status === "pending" && !activationHold(task);
}

function voidTasks(state, ids, reason, time = new Date().toISOString()) {
  let done = 0;
  state.tasks.forEach(task => {
    if (!ids.has(task.id) || !canVoidTask(task)) return;
    Object.assign(task, { status: "voided", voided: { time, reason, user: currentUser }, updatedAt: time });
    done++;
  });
  return done;
}

function bankConfiguration(device) {
  return { mode: device.mode, merchant: device.merchant || "", terminal: device.terminal || "" };
}

function seedBankConfiguration(device, time) {
  if (device.mode === "union" && device.merchant && device.terminal) {
    device.bankChanges = [{ time, user: "系统", from: "激活任务", before: null, after: bankConfiguration(device) }];
  }
}

function changeBankConfiguration(device, updated, time = new Date().toISOString()) {
  const before = bankConfiguration(device);
  if (Object.keys(before).every(key => before[key] === updated[key])) return;
  device.bankChanges ??= [];
  device.bankChanges.unshift({ time, user: currentUser, from: "运营平台", before, after: { ...updated } });
  Object.assign(device, updated, { updatedAt: time });
}

const exampleActivationFailures = {
  invalid: "收钱吧激活码无效",
  expired: "收钱吧激活码已过期",
  foreign: "收钱吧激活码属于其他门店",
  mismatch: "实际激活门店与任务目标门店不一致",
  unknown: "通信超时，激活结果待核对"
};

function demoActivate(state, task, outcome, { lookup = false, time = new Date().toISOString() } = {}) {
  const previous = task.attempts[0];
  if (task.status !== "pending" || previous?.unbind === "pending" || (lookup ? previous?.result !== "unknown" : previous?.result === "unknown")) {
    throw new Error("请先核对当前任务状态和上一次激活结果。");
  }
  const attempt = lookup ? previous : { time, target: { ...task.target } };
  if (lookup) attempt.checkedAt = time;
  const reasonCode = ["wrongStore", "wrongStorePending"].includes(outcome) ? "mismatch" : outcome;
  if (outcome === "success") {
    if (state.devices.some(device => device.active && device.serial === task.serial)) throw new Error("设备已有关联的收钱吧终端。");
    const device = addDevice(state, task, time);
    device.active = true;
    device.origin = "task";
    device.taskId = task.id;
    device.sqbTerminal = `1000${device.id}`;
    device.type = "商米 P3";
    device.version = "1.4.1";
    seedBankConfiguration(device, time);
    Object.assign(attempt, { result: "success", reason: "", reasonCode: "", actualStore: { ...task.target }, terminal: device.sqbTerminal });
    Object.assign(task, { status: "activated", deviceId: device.id, activatedAt: time });
  } else if (outcome === "notActivated" && lookup) {
    Object.assign(attempt, { result: "failed", reason: "已核对，本次未激活成功", reasonCode: "notActivated" });
  } else if (!lookup && exampleActivationFailures[reasonCode]) {
    Object.assign(attempt, { result: outcome === "unknown" ? "unknown" : "failed", reason: exampleActivationFailures[reasonCode], reasonCode });
    if (reasonCode === "mismatch") {
      attempt.actualStore = { ...stores.find(store => store.storeCode !== task.target.storeCode) };
      attempt.unbind = outcome === "wrongStorePending" ? "pending" : "done";
    }
  } else throw new Error("请选择激活结果。");
  if (!lookup) task.attempts.unshift(attempt);
  task.updatedAt = time;
}

function retryUnbindDemo(task) {
  const latest = task.attempts[0];
  if (task.status !== "pending" || latest?.unbind !== "pending") throw new Error("这条任务没有待处理的解绑。");
  latest.unbind = "done";
  task.updatedAt = new Date().toISOString();
}

function batchTasks(state, batch) {
  return state.tasks.filter(task => task.batchId === batch.id);
}

function batchFailures(batch) {
  const sourceRows = new Map(batch.checked.map(item => [item.line, item]));
  if (!batch.execution) return batch.checked.filter(item => item.errors.length).map(input => ({
    row: input.line, stage: "检查未通过", reason: input.errors.join("；"), input
  }));
  return batch.execution.rows.filter(item => item.status !== "success").map(item => ({
    ...item, stage: item.status === "skipped" ? "检查未通过" : "执行失败", input: sourceRows.get(item.row)
  }));
}

function migrateActivationTasks(state) {
  if (state.tasks) return;
  state.tasks = [];
  state.nextTask = 1;

  for (const batch of state.batches) {
    for (const item of batch.execution?.rows ?? []) {
      if (item.status !== "success") continue;
      const input = batch.checked.find(row => row.line === item.row);
      if (!input) continue;
      const device = state.devices.find(entry => entry.id === item.deviceId && entry.serial === input.serial);
      const configured = device && !device.active ? bankConfiguration(device) : {};
      const task = addActivationTask(state, { ...input, ...configured, target: item.target ?? input.target }, { batchId: batch.id, time: batch.execution.time });
      item.taskId = task.id;
      if (device?.active) {
        task.status = "activated";
        task.activatedAt = device.updatedAt;
        task.deviceId = device.id;
        device.taskId = task.id;
      } else if (device) task.migratedDeviceId = device.id;
      else {
        task.status = "voided";
        task.voided = { reason: "原设备记录已删除" };
      }
    }
  }
  for (const device of state.devices) {
    if (device.active || !device.serial || device.origin === "legacy") continue;
    if (!state.tasks.some(task => task.migratedDeviceId === device.id)) {
      const task = addActivationTask(state, device, { time: device.createdAt });
      task.migratedDeviceId = device.id;
    }
  }
  state.devices = state.devices.filter(device => device.active || device.origin === "legacy");
}
