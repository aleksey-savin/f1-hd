const mongoose = require("mongoose");
const Mikrotik = require("../models/mikrotik");
const MikrotikOutage = require("../models/mikrotikOutage");

// Разовая идемпотентная починка состояния мониторинга Mikrotik.
//
// До появления атомарных переходов (services/mikrotik/monitorState.js) health-check
// и крон алертов правили один документ двумя копиями и затирали поля друг друга.
// Это оставило в базе два вида мусора:
//
//   1. «Фантомные» вечно открытые эпизоды простоя. Старый attachTicket вызывался с
//      upsert по фильтру { mikrotik, open: true }: если восстановление успевало
//      закрыть эпизод раньше, upsert вставлял НОВЫЙ открытый эпизод, который уже
//      никто никогда не закроет. Отчёт доступности показывает по такому устройству
//      бесконечный простой.
//   2. Залипшее alert-состояние на устройствах, которые давно в сети:
//      offlineAlertedAt/alertTicketId/offlineSince остались от гонки. Крон алертов
//      ищет по `offlineAlertedAt: null`, поэтому следующий НАСТОЯЩИЙ простой такого
//      устройства не заведёт заявку никогда.
//
// Плюс гигиена нового поля firstFailureAt: оно продвигается оператором $min, а
// сохранённый null сортируется раньше любой даты и навсегда заморозил бы счётчик.
//
// Скрипт безопасно запускать повторно. По умолчанию — сухой прогон (только отчёт).
// Запускать ПОСЛЕ выката кода, иначе старый код наплодит фантомов прямо во время
// чистки:
//   docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js
//   docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js --apply
const APPLY = process.argv.includes("--apply");

// Устройство «действительно лежит» только если офлайн подтверждён краем потери связи.
const isConfirmedOffline = (record) =>
  record.status === "offline" && Boolean(record.offlineSince);

// Эпизод закрываем последним моментом, когда устройство точно было живо, но не
// раньше его начала (иначе получим отрицательную длительность).
const resolveEndedAt = (record, startedAt) => {
  const candidate =
    record?.lastSuccessfulConnectionAt || record?.lastCheckedAt || new Date();
  return candidate > startedAt ? candidate : new Date();
};

// 1. Фантомные открытые эпизоды.
async function repairOpenOutages() {
  const open = await MikrotikOutage.find({ open: true })
    .sort({ startedAt: 1 })
    .lean();
  if (open.length === 0) {
    console.log("✅ Открытых эпизодов простоя нет");
    return;
  }

  const byRecord = new Map();
  for (const episode of open) {
    const key = String(episode.mikrotik);
    if (!byRecord.has(key)) byRecord.set(key, []);
    byRecord.get(key).push(episode);
  }

  let orphaned = 0;
  let closed = 0;
  let duplicates = 0;
  let kept = 0;

  for (const [recordId, episodes] of byRecord) {
    const record = await Mikrotik.findById(recordId).lean();

    if (!record) {
      orphaned += episodes.length;
      console.log(
        `   🗑  ${recordId}: записи устройства нет — удаляем ${episodes.length} эпизод(ов)`,
      );
      if (APPLY) await MikrotikOutage.deleteMany({ mikrotik: recordId });
      continue;
    }

    // У подтверждённо лежащего устройства один открытый эпизод легитимен — самый
    // ранний. Остальные (легаси до partial-индекса) закрываем как дубли.
    const confirmed = isConfirmedOffline(record);
    const toClose = confirmed ? episodes.slice(1) : episodes;
    if (confirmed) {
      kept += 1;
      duplicates += toClose.length;
    } else {
      closed += toClose.length;
    }

    for (const episode of toClose) {
      const endedAt = resolveEndedAt(record, episode.startedAt);
      const reason = confirmed
        ? "дубль открытого эпизода"
        : `устройство не в подтверждённом офлайне (status=${record.status ?? "—"})`;
      console.log(
        `   🔧 ${recordId}: закрываем эпизод от ${episode.startedAt.toISOString()} — ${reason}`,
      );
      if (APPLY) {
        await MikrotikOutage.updateOne(
          { _id: episode._id },
          { $set: { endedAt }, $unset: { open: 1 } },
        );
      }
    }
  }

  console.log(
    `✅ Эпизоды: закрыто фантомных ${closed}, дублей ${duplicates}, удалено осиротевших ${orphaned}, оставлено настоящих ${kept}`,
  );
}

// 2. Залипшее alert-состояние на устройствах, которые сейчас не в офлайне.
async function repairStaleAlertState() {
  const filter = {
    status: { $ne: "offline" },
    $or: [
      { offlineAlertedAt: { $ne: null } },
      { alertTicketId: { $ne: null } },
      { offlineSince: { $ne: null } },
    ],
  };

  const stale = await Mikrotik.find(filter)
    .select("_id credentials.host offlineAlertedAt alertTicketId")
    .lean();
  if (stale.length === 0) {
    console.log("✅ Залипшего alert-состояния нет");
    return;
  }

  for (const record of stale) {
    console.log(
      `   🔧 ${record._id} (${record.credentials?.host ?? "—"}): снимаем alert-состояние` +
        (record.alertTicketId ? ` (заявка ${record.alertTicketId})` : ""),
    );
  }

  if (APPLY) {
    const result = await Mikrotik.updateMany(filter, {
      $set: { failedPolls: 0 },
      $unset: {
        offlineSince: "",
        offlineAlertedAt: "",
        alertTicketId: "",
        firstFailureAt: "",
      },
    });
    console.log(`✅ Alert-состояние снято у ${result.modifiedCount} устройств`);
  } else {
    console.log(`✅ Alert-состояние нужно снять у ${stale.length} устройств`);
  }
}

// 3. Гигиена firstFailureAt: null ломает $min; у лежащих устройств край потери
//    связи — это offlineSince.
async function repairFirstFailureAt() {
  // Именно $type: "null" — фильтр `{ firstFailureAt: null }` матчит ещё и документы,
  // где поля просто нет (а это норма), и тогда чинить было бы нечего.
  const explicitNull = { firstFailureAt: { $type: "null" } };
  const nulls = await Mikrotik.countDocuments(explicitNull);
  // Здесь, наоборот, `null` нужен в обоих смыслах: у лежащего устройства поле либо
  // отсутствует (запись из до-миграционного мира), либо занулено — край потери
  // связи для него известен, это offlineSince.
  const offline = await Mikrotik.find({
    status: "offline",
    offlineSince: { $ne: null },
    firstFailureAt: null,
  })
    .select("_id offlineSince")
    .lean();

  if (APPLY) {
    if (nulls > 0) {
      await Mikrotik.updateMany(explicitNull, {
        $unset: { firstFailureAt: "" },
      });
    }
    for (const record of offline) {
      await Mikrotik.updateOne(
        { _id: record._id },
        { $set: { firstFailureAt: record.offlineSince } },
      );
    }
  }

  console.log(
    `✅ firstFailureAt: очищено null ${nulls}, восстановлено по offlineSince ${offline.length}`,
  );
}

async function migrate() {
  try {
    console.log(
      APPLY
        ? "Режим: ЗАПИСЬ (--apply)"
        : "Режим: сухой прогон (укажите --apply, чтобы применить)",
    );
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    await repairStaleAlertState();
    await repairOpenOutages();
    await repairFirstFailureAt();
  } catch (error) {
    console.error("❌ Ошибка починки состояния Mikrotik:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  migrate();
}

module.exports = { migrate };
