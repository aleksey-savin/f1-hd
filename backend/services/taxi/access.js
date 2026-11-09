const { AppError } = require('../../middleware/errorHandling');
const staff = (auth) => Boolean(auth?.userId && !auth.isEndUser);
const has = (auth, permission) => staff(auth) && Boolean(auth.can?.({ taxi: [permission] }));
const canOpenReport = (auth) => ['read', 'allocate', 'configure'].some((permission) => has(auth, permission));
const owns = (auth, trip) => Boolean(trip?.userId && String(trip.userId) === String(auth?.userId));
const canViewTrip = (auth, trip) => !trip?.deletedAt && staff(auth) && (owns(auth, trip) || has(auth, 'read') || has(auth, 'allocate'));
const requireStaff = (auth) => { if (!staff(auth)) throw new AppError('Недостаточно прав', 403); };
module.exports = { canViewTrip, requireStaff, has, canOpenReport };
