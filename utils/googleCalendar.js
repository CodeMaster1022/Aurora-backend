const { google } = require('googleapis');
const calendar = google.calendar('v3');
const OAuth2 = google.auth.OAuth2;

// Configure global options for googleapis
// google.options({
//   timeout: 60000,
//   retry: true
// });

// Configure base OAuth2 client for token generation
const baseOAuth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set custom options for HTTP requests
baseOAuth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    console.log('Received refresh token');
  }
});

// Get OAuth URL for initiating the flow
const getAuthUrl = () => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  return baseOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force consent to get refresh token
  });
};

// Exchange code for tokens
const getTokensFromCode = async (code) => {
  try {
    console.log('Attempting to exchange code for tokens...');
    console.log('Redirect URI:', process.env.GOOGLE_REDIRECT_URI);
    
    // Exchange authorization code for tokens
    const { tokens } = await baseOAuth2Client.getToken(code);
    
    console.log('Successfully received tokens from Google');
    console.log('Access token received:', !!tokens.access_token);
    console.log('Refresh token received:', !!tokens.refresh_token);
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null
    };
  } catch (error) {
    console.error('Error getting tokens from code:', error);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    
    // Provide more helpful error message
    if (error.code === 'ETIMEDOUT') {
      throw new Error('Connection timeout to Google OAuth servers. Please check your network connection or firewall settings.');
    }
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    throw error;
  }
};

// Create OAuth2 client for a specific speaker
const createOAuthClient = (accessToken, refreshToken) => {
  const client = new OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  return client;
};

// Refresh access token if expired
const refreshAccessToken = async (client) => {
  try {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    throw error;
  }
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
  oauthClient, // OAuth client for the speaker
  speakerEmail, 
  learnerEmail, 
  speakerName, 
  learnerName,
  sessionTitle,
  topics,
  icebreaker,
  startDateTime,
  duration = 30 // Always 30 minutes
}) => {
  try {
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

    // Create the event using speaker's OAuth client
    const event = await calendar.events.insert({
      auth: oauthClient,
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

module.exports = {
  getAuthUrl,
  getTokensFromCode,
  createOAuthClient,
  refreshAccessToken,
  createCalendarEvent,
  generateMeetLink,
  getRandomIcebreaker
};
