const Notification = require('../models/Notification');
const { sendNotificationToSSE, sendUnreadCountUpdate } = require('../controllers/notificationController');

/**
 * Create a notification and send via SSE if user is connected
 */
const createNotification = async ({
  userId,
  type,
  title,
  message,
  link,
  relatedId,
  relatedModel
}) => {
  try {
    const notification = await Notification.create({
      user: userId,
      type,
      title,
      message,
      link,
      relatedId,
      relatedModel
    });

    // Convert to plain object for SSE
    const notificationObj = notification.toObject();

    // Send via SSE if user is connected
    console.log(`Sending notification via SSE to user: ${userId}`);
    sendNotificationToSSE(userId, notificationObj);

    // Update unread count
    await sendUnreadCountUpdate(userId);

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

/**
 * Create notification for session booked
 */
const notifySessionBooked = async (session, speaker, learner) => {
  try {
    // Notify speaker
    await createNotification({
      userId: speaker._id,
      type: 'session_booked',
      title: 'New Session Booked',
      message: `${learner.firstname} ${learner.lastname} booked a session: "${session.title}"`,
      link: `/speakers/profile`,
      relatedId: session._id,
      relatedModel: 'Session'
    });

    // Notify learner
    await createNotification({
      userId: learner._id,
      type: 'session_booked',
      title: 'Session Confirmed',
      message: `Your session with ${speaker.firstname} ${speaker.lastname} has been confirmed: "${session.title}"`,
      link: `/learners/dashboard`,
      relatedId: session._id,
      relatedModel: 'Session'
    });
  } catch (error) {
    console.error('Error notifying session booked:', error);
  }
};

/**
 * Create notification for session cancelled
 */
const notifySessionCancelled = async (session, cancelledBy, otherUser) => {
  try {
    const isSpeaker = cancelledBy._id.toString() === session.speaker.toString();
    const role = isSpeaker ? 'Speaker' : 'Learner';
    const otherRole = isSpeaker ? 'Learner' : 'Speaker';

    await createNotification({
      userId: otherUser._id,
      type: 'session_cancelled',
      title: 'Session Cancelled',
      message: `${role} ${cancelledBy.firstname} ${cancelledBy.lastname} cancelled the session: "${session.title}"`,
      link: isSpeaker ? `/learners/dashboard` : `/speakers/profile`,
      relatedId: session._id,
      relatedModel: 'Session'
    });
  } catch (error) {
    console.error('Error notifying session cancelled:', error);
  }
};

/**
 * Create notification for session reminder (24 hours before)
 */
const notifySessionReminder = async (session, user, userRole) => {
  try {
    const isSpeaker = userRole === 'speaker';
    const otherUser = isSpeaker ? session.learner : session.speaker;
    const otherUserName = typeof otherUser === 'object' 
      ? `${otherUser.firstname} ${otherUser.lastname}`
      : 'the other participant';

    await createNotification({
      userId: user._id,
      type: 'session_reminder',
      title: 'Session Reminder',
      message: `Your session "${session.title}" with ${otherUserName} is scheduled for tomorrow`,
      link: isSpeaker ? `/speakers/profile` : `/learners/dashboard`,
      relatedId: session._id,
      relatedModel: 'Session'
    });
  } catch (error) {
    console.error('Error notifying session reminder:', error);
  }
};

/**
 * Create notification for review received
 */
const notifyReviewReceived = async (review, reviewedUser) => {
  try {
    const reviewer = review.from;
    const reviewerName = typeof reviewer === 'object'
      ? `${reviewer.firstname} ${reviewer.lastname}`
      : 'Someone';

    await createNotification({
      userId: reviewedUser._id,
      type: 'review_received',
      title: 'New Review Received',
      message: `${reviewerName} left you a ${review.rating}-star review`,
      link: reviewedUser.role === 'speaker' ? `/speakers/profile` : `/learners/profile`,
      relatedId: review._id,
      relatedModel: 'Review'
    });
  } catch (error) {
    console.error('Error notifying review received:', error);
  }
};

/**
 * Create notification for session completed
 */
const notifySessionCompleted = async (session, user, userRole) => {
  try {
    const isSpeaker = userRole === 'speaker';
    const otherUser = isSpeaker ? session.learner : session.speaker;
    const otherUserName = typeof otherUser === 'object'
      ? `${otherUser.firstname} ${otherUser.lastname}`
      : 'the other participant';

    await createNotification({
      userId: user._id,
      type: 'session_completed',
      title: 'Session Completed',
      message: `Your session "${session.title}" with ${otherUserName} has been marked as completed`,
      link: isSpeaker ? `/speakers/profile` : `/learners/dashboard`,
      relatedId: session._id,
      relatedModel: 'Session'
    });
  } catch (error) {
    console.error('Error notifying session completed:', error);
  }
};

/**
 * Create notification for calendar connected
 */
const notifyCalendarConnected = async (user) => {
  try {
    await createNotification({
      userId: user._id,
      type: 'calendar_connected',
      title: 'Google Calendar Connected',
      message: 'Your Google Calendar has been successfully connected. Sessions will now be added to your calendar.',
      link: `/speakers/profile`,
      relatedId: user._id,
      relatedModel: 'User'
    });
  } catch (error) {
    console.error('Error notifying calendar connected:', error);
  }
};

module.exports = {
  createNotification,
  notifySessionBooked,
  notifySessionCancelled,
  notifySessionReminder,
  notifyReviewReceived,
  notifySessionCompleted,
  notifyCalendarConnected
};

