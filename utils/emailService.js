const nodemailer = require('nodemailer');

// Create transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

/**
 * Send session confirmation email
 */
const sendSessionConfirmation = async ({ 
  recipientEmail, 
  recipientName, 
  otherParticipantName,
  sessionTitle,
  topics,
  icebreaker,
  date,
  time,
  duration,
  meetLink 
}) => {
  try {
    const emailContent = {
      from: process.env.EMAIL_USER,
      to: recipientEmail,
      subject: `Session Confirmed: ${sessionTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .info-box { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .meet-link { background: #4285f4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
            .meet-link:hover { background: #357ae8; }
            .topics { margin: 10px 0; }
            .topic-tag { background: #667eea; color: white; padding: 5px 10px; border-radius: 20px; display: inline-block; margin: 5px 5px 0 0; }
            .icebreaker { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Session Confirmed! 🎉</h1>
            </div>
            <div class="content">
              <p>Hi ${recipientName},</p>
              <p>Your session "${sessionTitle}" with ${otherParticipantName} has been confirmed!</p>
              
              <div class="info-box">
                <h3>Session Details</h3>
                <p><strong>Date:</strong> ${new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                <p><strong>Time:</strong> ${time}</p>
                <p><strong>Duration:</strong> ${duration} minutes</p>
              </div>

              ${topics && topics.length > 0 ? `
                <div class="info-box">
                  <h3>Topics</h3>
                  <div class="topics">
                    ${topics.map(topic => `<span class="topic-tag">${topic}</span>`).join('')}
                  </div>
                </div>
              ` : ''}

              ${icebreaker ? `
                <div class="icebreaker">
                  <h3>💡 Icebreaker Question</h3>
                  <p>${icebreaker}</p>
                </div>
              ` : ''}

              <div class="info-box">
                <h3>Join Meeting</h3>
                <p>Click the button below to join the Google Meet session:</p>
                <a href="${meetLink}" class="meet-link">Join Google Meet</a>
                <p style="font-size: 12px; color: #666;">Or copy this link: ${meetLink}</p>
              </div>

              <p>We're looking forward to your session!</p>
              <p>Best regards,<br>The Team</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Hi ${recipientName},

Your session "${sessionTitle}" with ${otherParticipantName} has been confirmed!

Session Details:
- Date: ${new Date(date).toLocaleDateString('en-US', { distantWeekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${time}
- Duration: ${duration} minutes

${topics && topics.length > 0 ? `Topics: ${topics.join(', ')}\n` : ''}
${icebreaker ? `Icebreaker: ${icebreaker}\n` : ''}

Join Meeting: ${meetLink}

We're looking forward to your session!

Best regards,
The Team
      `
    };

    await transporter.sendMail(emailContent);
    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send emails to both participants
 */
const sendSessionEmails = async ({ 
  speakerEmail, 
  speakerName, 
  learnerEmail, 
  learnerName, 
  sessionTitle,
  topics,
  icebreaker,
  date,
  time,
  duration,
  meetLink 
}) => {
  const results = [];
  
  // Send to speaker
  try {
    const speakerResult = await sendSessionConfirmation({
      recipientEmail: speakerEmail,
      recipientName: speakerName,
      otherParticipantName: learnerName,
      sessionTitle,
      topics,
      icebreaker,
      date,
      time,
      duration,
      meetLink
    });
    results.push({ type: 'speaker', ...speakerResult });
  } catch (error) {
    results.push({ type: 'speaker', success: false, error: error.message });
  }

  // Send to learner
  try {
    const learnerResult = await sendSessionConfirmation({
      recipientEmail: learnerEmail,
      recipientName: learnerName,
      otherParticipantName: speakerName,
      sessionTitle,
      topics,
      icebreaker,
      date,
      time,
      duration,
      meetLink
    });
    results.push({ type: 'learner', ...learnerResult });
  } catch (error) {
    results.push({ type: 'learner', success: false, error: error.message });
  }

  return results;
};

module.exports = {
  sendSessionConfirmation,
  sendSessionEmails
};
