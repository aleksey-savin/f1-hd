const storage = require("../../services/storage");
const { MAX_FILES: MAX_PHOTOS } = require("../../middleware/imageUpload");
const { AppError } = require("../../middleware/errorHandling");

// Снимки хранятся одинаково у клиентского устройства и у модели устройства:
// файлы уже в S3 (imageUpload), в документе — только метаданные, где `name` —
// ключ объекта и одновременно путь /uploads/<name>. Фабрика собирает пару
// обработчиков под конкретную модель Mongoose.
const createPhotoHandlers = ({ Model, notFoundMessage }) => {
  const discard = (files) =>
    Promise.all(files.map((file) => storage.deleteObject(file.key))).catch(
      () => {},
    );

  const addPhotos = async (req, res, next) => {
    const uploaded = req.files || [];
    try {
      const entity = await Model.findById(req.params.id);
      if (!entity || entity.deletedAt) {
        // Файлы уже в бакете — не оставляем сирот.
        await discard(uploaded);
        return next(new AppError(notFoundMessage(req.params.id), 404));
      }

      if (uploaded.length === 0) {
        return next(new AppError("Не выбрано ни одного изображения", 400));
      }

      const free = MAX_PHOTOS - entity.photos.length;
      if (uploaded.length > free) {
        await discard(uploaded);
        return next(
          new AppError(
            free > 0
              ? `Можно добавить ещё ${free} фото — всего не больше ${MAX_PHOTOS}`
              : `Достигнут предел: ${MAX_PHOTOS} фото. Удалите лишние, чтобы добавить новые`,
            400,
          ),
        );
      }

      entity.photos.push(
        ...uploaded.map((file) => ({
          name: file.key,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          uploadedBy: req.userId,
        })),
      );
      entity.updatedBy = req.userId;
      await entity.save();

      res.status(201).json({ photos: entity.photos });
    } catch (error) {
      await discard(uploaded);
      next(
        new AppError(
          `Failed to add photos to ${req.params.id}`,
          500,
          true,
          error,
        ),
      );
    }
  };

  const deletePhoto = async (req, res, next) => {
    try {
      const { id, photoId } = req.params;

      const entity = await Model.findById(id);
      if (!entity || entity.deletedAt) {
        return next(new AppError(notFoundMessage(id), 404));
      }

      const photo = entity.photos.id(photoId);
      if (!photo) {
        return next(new AppError(`Photo ${photoId} not found`, 404));
      }

      const { name } = photo;
      photo.deleteOne();
      entity.updatedBy = req.userId;
      await entity.save();

      // Объект удаляем после успешной записи: файл-сирота безобиднее, чем
      // ссылка на удалённый объект.
      await storage.deleteObject(name);

      res.status(200).json({ photos: entity.photos });
    } catch (error) {
      next(
        new AppError(
          `Failed to delete photo ${req.params.photoId}`,
          500,
          true,
          error,
        ),
      );
    }
  };

  return { addPhotos, deletePhoto };
};

// Удаление снимков вместе с сущностью — они не переживают её.
const deleteAllPhotos = (entity) =>
  Promise.all(
    (entity?.photos || []).map((photo) => storage.deleteObject(photo.name)),
  );

module.exports = { createPhotoHandlers, deleteAllPhotos, MAX_PHOTOS };
