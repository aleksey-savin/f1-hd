const Subdivision = require("@/models/subdivision");

/**
 * Дерево подразделений клиента одним индексом.
 *
 * До этого модуля обход существовал двумя ad-hoc копиями: сборка вниз по
 * `parent` в карточке компании (controllers/company.js) и подъём вверх по
 * цепочке предков в services/clientTimezone.js. Отчёту по компаниям нужны обе
 * стороны (поддерево — для скоупа руководителя, путь до корня — для крошек),
 * поэтому обход вынесен сюда.
 *
 * Источник правды по связям — поле `parent`: оно и `subdivisions[]` пишутся
 * синхронно, но `parent` есть у каждого узла, а массив у родителя может
 * отстать. Узлы, чей родитель вне выборки (сирота после переноса компании),
 * считаются корнями — иначе они молча исчезли бы из дерева.
 */

// Тот же предел, что у подъёма по предкам в clientTimezone (защита от цикла
// parent → … → parent, который в БД никто не запрещает)
const MAX_DEPTH = 32;

const idOf = (value) => (value ? (value._id ?? value).toString() : null);

/**
 * Индекс по уже загруженным документам подразделений.
 * @param {Array} docs — lean-документы с _id, name, parent, company
 */
const buildSubdivisionIndex = (docs) => {
  const byId = new Map();
  const childrenOf = new Map();
  const roots = [];

  for (const doc of docs) {
    const id = doc._id.toString();
    byId.set(id, doc);
    if (!childrenOf.has(id)) {
      childrenOf.set(id, []);
    }
  }

  for (const doc of docs) {
    const id = doc._id.toString();
    const parentId = idOf(doc.parent);
    if (parentId && byId.has(parentId)) {
      childrenOf.get(parentId).push(id);
    } else {
      roots.push(id);
    }
  }

  /** Идентификаторы поддерева, включая сам узел. */
  const descendantsOf = (rootId) => {
    const start = rootId?.toString();
    if (!start || !byId.has(start)) {
      return [];
    }
    const result = [];
    const seen = new Set();
    const queue = [{ id: start, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (seen.has(id) || depth > MAX_DEPTH) {
        continue;
      }
      seen.add(id);
      result.push(id);
      for (const childId of childrenOf.get(id) || []) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }
    return result;
  };

  /** Путь от корня до узла включительно — для крошек карточки. */
  const pathOf = (nodeId) => {
    const chain = [];
    let current = byId.get(nodeId?.toString());
    let guard = 0;
    while (current && guard < MAX_DEPTH) {
      chain.unshift({ _id: current._id, name: current.name });
      const parentId = idOf(current.parent);
      current = parentId ? byId.get(parentId) : null;
      guard += 1;
    }
    return chain;
  };

  const depthOf = (nodeId) => Math.max(pathOf(nodeId).length - 1, 0);

  return { byId, childrenOf, roots, descendantsOf, pathOf, depthOf };
};

/**
 * Загрузить подразделения указанных компаний и построить индекс.
 * @param {{ companyIds: Array, select?: string }} params
 */
const loadSubdivisionTree = async ({ companyIds, select = "name parent company manager timezone" }) => {
  const ids = (companyIds || []).filter(Boolean);
  if (ids.length === 0) {
    return buildSubdivisionIndex([]);
  }
  const docs = await Subdivision.find({ company: { $in: ids } })
    .select(select)
    .sort({ name: 1 })
    .lean();
  return buildSubdivisionIndex(docs);
};

module.exports = { buildSubdivisionIndex, loadSubdivisionTree, MAX_DEPTH };
