// Применение утверждённого предложения: сверка дрейфа, затем пакет через changeOps.applyPackage.
// Без моделей: хранилище и реестр операций приходят аргументами (боевое хранилище — mongoStore ниже).
//
// Дрейф: каждая цель каждой операции (и детали каскада) должна иметь тот же updatedAt, что в снимке
// предложения. Расхождение или пропавший документ — ничего не применяется, статус failed.
const { STATUS } = require("./changeSteps");

const DRIFT = "изменилось после предложения";
const DRIFT_ELSEWHERE = "другая операция пакета изменилась после предложения";
// Ответ хранилища: документ есть, но updatedAt у него нет (старые записи)
const UNDATED = "undated";

const timeOf = (value) => (value == null ? NaN : new Date(value).getTime());

/**
 * createExecutor({ ops, store, now }) -> { run(change, { actorId, onResult? }) -> { status, results, drift? } }
 * ops.applyPackage(items, ctx); store.currentUpdatedAt(model, id) -> Date | UNDATED | null (документа нет).
 * onResult(index, result) уходит в applyPackage: зовётся после каждой выполненной операции (при дрейфе — ни разу).
 * В results пропущенной операции — только причина; drift — строки для журнала: причина и текст операции.
 */
function createExecutor({ ops, store, now = () => new Date() }) {
  // Цель сходится со снимком? Даты нет с обеих сторон — сходится (сверять нечего, но и менять
  // её никто не мог незаметно: правка ставит updatedAt); дата только с одной стороны — дрейф.
  const same = (expectedRaw, currentRaw) => {
    if (currentRaw == null) return false; // документ пропал
    const expectedUndated = expectedRaw == null;
    const currentUndated = currentRaw === UNDATED;
    if (expectedUndated || currentUndated) return expectedUndated && currentUndated;
    const expected = timeOf(expectedRaw);
    const current = timeOf(currentRaw);
    return !Number.isNaN(expected) && expected === current;
  };

  // По операции: true — у неё что-то изменилось после предложения
  async function driftOf(operations) {
    const flags = [];
    for (const operation of operations) {
      let drifted = false;
      for (const target of operation.targets || []) {
        if (!same(target.updatedAt, await store.currentUpdatedAt(target.model, target.id))) {
          drifted = true;
          break;
        }
      }
      flags.push(drifted);
    }
    return flags;
  }

  async function run(change, { actorId, onResult } = {}) {
    const operations = change.operations || [];
    const flags = await driftOf(operations);
    if (flags.some(Boolean)) {
      return {
        status: STATUS.failed,
        results: flags.map((drifted) => ({ state: "skipped", error: drifted ? DRIFT : DRIFT_ELSEWHERE })),
        // Для хроники: заголовок операции (первая строка текста)
        drift: operations
          .filter((_, i) => flags[i])
          .map((operation) => `${DRIFT}: ${String(operation.text ?? "").split("\n")[0]}`),
      };
    }
    // Поля операции совпадают с элементом checkPackage; created/updatedBy — заявитель, не бот и не портал
    const items = operations.map((operation) => ({
      kind: operation.kind,
      ref: operation.ref || null,
      params: operation.params,
      text: operation.text,
      targets: operation.targets || [],
      ...(operation.componentIds ? { componentIds: operation.componentIds.map(String) } : {}),
      ...(operation.componentRefs?.length ? { componentRefs: [...operation.componentRefs] } : {}),
    }));
    return ops.applyPackage(items, { userId: actorId, now: now(), ...(onResult ? { onResult } : {}) });
  }

  return { run };
}

// Боевое хранилище; не покрыто тестами (нужна база). Модели целей регистрирует реестр операций
// (changeOps/names), поэтому берём их по имени.
const mongoStore = {
  async currentUpdatedAt(modelName, id) {
    const mongoose = require("mongoose");
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await mongoose.model(modelName).findById(id).select("updatedAt deletedAt").lean();
    // Удалённое (deletedAt) — как пропавшее, так же его видит describe при предложении
    if (!doc || doc.deletedAt) return null;
    return doc.updatedAt || UNDATED;
  },
};

module.exports = { createExecutor, mongoStore, DRIFT, DRIFT_ELSEWHERE, UNDATED };
