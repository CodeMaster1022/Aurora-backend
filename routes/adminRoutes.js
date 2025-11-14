const express = require('express');
const {
  getAnalytics,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  listReviews,
  createReview,
  updateReview,
  deleteReview
} = require('../controllers/adminController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken, authorizeRoles('admin', 'moderator'));

router.get('/analytics', getAnalytics);

router
  .route('/users')
  .get(listUsers)
  .post(createUser);

router
  .route('/users/:id')
  .put(updateUser)
  .delete(deleteUser);

router.patch('/users/:id/status', updateUserStatus);

router
  .route('/reviews')
  .get(listReviews)
  .post(createReview);

router
  .route('/reviews/:id')
  .put(updateReview)
  .delete(deleteReview);

module.exports = router;

