const { google } = require('googleapis');
const calendar = google.calendar('v3');
const OAuth2 = google.auth.OAuth2;

// Configure OAuth2 client
const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
);

/**
 * Create an OAuth2 client for a specific user
 */
const createUserOAuth2Client = (tokens) => {
  const client = new OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  if (tokens?.refreshToken) {
    client.setCredentials({
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      token_type: tokens.tokenType,
      expiry_date: tokens.expiryDate
    });
  }
  
  return client;
};

/**
 * Generate a random icebreaker question
 */
const getRandomIcebreaker = () => {
  const icebreakers = [
    "What's the most interesting place you've ever traveled to?",
    "If you could have dinner with anyone, who would it be?",
    "What's one thing you're grateful for today?",
    "What's a hobby you've always wanted to try?",
    "What's your favorite way to spend a weekend?",
    "If you could learn any skill instantly, what would it be?",
    "What's a book or movie that changed your perspective?",
    "What's the best piece of advice you've ever received?",
    "What's something that always makes you smile?",
    "If you could visit any country, where would you go?",
    "What's a goal you're currently working towards?",
    "What's your favorite type of cuisine and why?",
    "What's one thing you wish people knew about you?",
    "What's a memorable childhood memory you have?",
    "What's something you're passionate about?"
  ];
  
  return icebreakers[Math.floor(Math.random() * icebreakers.length)];
};

/**
 * Create a Google Calendar event with Meet link
 */
const createCalendarEvent = async ({ 
  speakerEmail, 
  learnerEmail, 
  speakerName, 
  learnerName,
  sessionTitle,
  topics,
  icebreaker,
  startDateTime,
  duration = 30, // Always 30 minutes
  speakerTokens // Speaker's Google OAuth2 tokens
}) => {
  try {
    // Check if speaker has Google Calendar connected
    if (!speakerTokens?.refreshToken) {
      throw new Error('Speaker has not connected their Google Calendar');
    }

    // Create OAuth2 client for this speaker
    const speakerOAuth2Client = createUserOAuth2Client(speakerTokens);
    
    const endDateTime = new Date(startDateTime);
    endDateTime.setMinutes(endDateTime.getMinutes() + duration);

    // Create event details
    const eventDetails = {
      summary: sessionTitle || `Session with ${speakerName}`,
      description: `
Session Details:
- Speaker: ${speakerName}
- Learner: ${learnerName}
${topics && topics.length > 0 ? `- Topics: ${topics.join(', ')}` : ''}
${icebreaker ? `- Icebreaker: ${icebreaker}` : ''}

Join the meeting using the link below.
      `.trim(),
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'UTC',
      },
      attendees: [
        { email: speakerEmail },
        { email: learnerEmail }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 15 } // 15 minutes before
        ],
      },
      conferenceData: {
        createRequest: {
          requestId: `session-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };

    // Create the event using speaker's OAuth2 credentials
    const event = await calendar.events.insert({
      auth: speakerOAuth2Client,
      calendarId: 'primary',
      resource: eventDetails,
      conferenceDataVersion: 1
    });

    // Extract the Meet link from the response
    const meetLink = event.data.conferenceData?.entryPoints?.[0]?.uri || 
                     event.data.hangoutLink || 
                     'https://meet.google.com'; // Fallback

    return {
      success: true,
      eventId: event.data.id,
      meetLink,
      hangoutLink: event.data.hangoutLink
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    
    // Fallback: return a generic Meet link if calendar creation fails
    return {
      success: false,
      meetLink: 'https://meet.google.com',
      error: error.message
    };
  }
};

/**
 * Generate a standalone Meet link (fallback method)
 */
const generateMeetLink = () => {
  // Generate a random Meet code
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let meetCode = '';
  for (let i = 0; i < 3; i++) {
    meetCode += chars[Math.floor(Math.random() * chars.length)] + 
                chars[Math.floor(Math.random() * chars.length)] + 
                chars[Math.floor(Math.random() * chars.length)];
    if (i < 2) meetCode += '-';
  }
  return `https://meet.google.com/${meetCode}`;
};

/**
 * Get Google OAuth2 authorization URL
 */
const getAuthUrl = () => {
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force consent to get refresh token
  });
};

/**
 * Exchange authorization code for tokens
 */
const getTokensFromCode = async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // Refresh the OAuth2 client with the new tokens
    oauth2Client.setCredentials(tokens);
    
    return {
      success: true,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiryDate: tokens.expiry_date,
        scope: tokens.scope
      }
    };
  } catch (error) {
    console.error('Error getting tokens from code:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  createCalendarEvent,
  generateMeetLink,
  getRandomIcebreaker,
  getAuthUrl,
  getTokensFromCode,
  createUserOAuth2Client
};
