exports.concatIdsArray = (array1, array2) => {
  const extractId = (item) => {
    if (typeof item === "object" && item !== null) {
      return item._id ? item._id.toString() : null;
    }
    return item ? item.toString() : null;
  };

  const combinedArray = [...array1, ...array2].map(extractId);

  const result = [...new Set(combinedArray)].filter(Boolean);

  return result;
};
