const { google } = require('googleapis');
const calendar = google.calendar('v3');
const OAuth2 = google.auth.OAuth2;

// Configure global options for googleapis with extended timeout and retry
google.options({
  timeout: 60000, // 60 seconds timeout
  retry: true,
  retryConfig: {
    retry: 3, // Retry 3 times
    retryDelay: 1000, // Initial retry delay of 1 second
    httpMethodsToRetry: ['GET', 'POST', 'PUT', 'HEAD', 'OPTIONS'],
    statusCodesToRetry: [
      [100, 199],
      [429, 429],
      [500, 599]
    ]
  }
});

// Configure base OAuth2 client for token generation
const baseOAuth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Configure OAuth2 client's internal HTTP client with extended timeout
// The OAuth2 client uses gaxios internally, so we configure it directly
if (baseOAuth2Client._client && baseOAuth2Client._client.request) {
  const originalRequest = baseOAuth2Client._client.request.bind(baseOAuth2Client._client);
  baseOAuth2Client._client.request = function(opts, callback) {
    // Set extended timeout for OAuth token exchange (60 seconds)
    opts.timeout = opts.timeout || 60000;
    
    // If callback is provided, use callback pattern
    if (callback) {
      return originalRequest(opts, callback);
    }
    
    // Otherwise return promise and handle timeouts
    return originalRequest(opts).catch(error => {
      // Retry on timeout errors
      if (error.code === 'ETIMEDOUT' && opts._retryCount < 2) {
        opts._retryCount = (opts._retryCount || 0) + 1;
        console.log(`Retrying OAuth request (attempt ${opts._retryCount + 1})...`);
        return originalRequest(opts);
      }
      throw error;
    });
  };
}

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

// Helper function to retry a promise with exponential backoff
const retryWithBackoff = async (fn, maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // If it's the last attempt or not a timeout/network error, throw
      if (attempt === maxRetries || (error.code !== 'ETIMEDOUT' && error.code !== 'ECONNRESET' && error.code !== 'ENOTFOUND')) {
        throw error;
      }
      
      // Exponential backoff: wait longer between each retry
      const waitTime = delay * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed. Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

// Exchange code for tokens
const getTokensFromCode = async (code) => {
  try {
    console.log('Attempting to exchange code for tokens...');
    console.log('Redirect URI:', process.env.GOOGLE_REDIRECT_URI);
    
    // Exchange authorization code for tokens with retry logic
    const { tokens } = await retryWithBackoff(async () => {
      try {
        return await baseOAuth2Client.getToken(code);
      } catch (error) {
        // Log the error but let retry logic handle it
        console.log(`Token exchange attempt failed: ${error.code || error.message}`);
        throw error;
      }
    }, 3, 1000);
    
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
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      throw new Error('Connection timeout to Google OAuth servers after multiple retry attempts. Please check your network connection, firewall settings, or try again later.');
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

  // Configure the OAuth2 client's internal HTTP client with extended timeout
  // This ensures token refresh requests have sufficient time to complete
  if (client._client && client._client.request) {
    const originalRequest = client._client.request.bind(client._client);
    client._client.request = function(opts, callback) {
      // Set extended timeout for OAuth token refresh (60 seconds)
      if (!opts.timeout) {
        opts.timeout = 60000;
      }
      
      // If callback is provided, use callback pattern
      if (callback) {
        return originalRequest(opts, callback);
      }
      
      // Otherwise return promise
      return originalRequest(opts);
    };
  }

  // The Google OAuth2 client will automatically refresh the token when making API calls
  // if a refresh_token is provided and the access_token is expired

  return client;
};

// Refresh access token if expired
const refreshAccessToken = async (client) => {
  try {
    // Use retry logic with exponential backoff for token refresh
    const { credentials } = await retryWithBackoff(async () => {
      try {
        return await client.refreshAccessToken();
      } catch (error) {
        // Log the error but let retry logic handle it
        console.log(`Token refresh attempt failed: ${error.code || error.message}`);
        throw error;
      }
    }, 3, 1000); // Retry up to 3 times with exponential backoff starting at 1 second
    
    client.setCredentials(credentials);
    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    
    // Provide more helpful error message for timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      throw new Error('Connection timeout to Google OAuth servers after multiple retry attempts. Please check your network connection, firewall settings, or try again later.');
    }
    
    throw error;
  }
};

/**
 * Get a valid OAuth client for a user, automatically refreshing the token if expired or about to expire
 * @param {Object} user - User document with googleCalendar data
 * @param {Function} updateUserCallback - Optional callback to update user in database (userId, updateData) => Promise
 * @returns {Object} OAuth2 client that is ready to use
 */
const getValidOAuthClient = async (user, updateUserCallback = null) => {
  if (!user || !user.googleCalendar || !user.googleCalendar.connected) {
    throw new Error('Google Calendar is not connected for this user');
  }

  if (!user.googleCalendar.accessToken || !user.googleCalendar.refreshToken) {
    throw new Error('Google Calendar credentials are missing');
  }

  // Create OAuth client
  let oauthClient = createOAuthClient(
    user.googleCalendar.accessToken,
    user.googleCalendar.refreshToken
  );

  // Set up event listener to catch automatic token refreshes during API calls
  // This ensures the database is updated if the Google OAuth client automatically refreshes the token
  if (updateUserCallback && typeof updateUserCallback === 'function') {
    oauthClient.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        // If we get a new refresh token, update it
        updateUserCallback(user._id, {
          'googleCalendar.refreshToken': tokens.refresh_token
        }).catch(err => console.error('Error updating refresh token:', err));
      }
      if (tokens.access_token) {
        // Update access token when it's automatically refreshed
        const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
        updateUserCallback(user._id, {
          'googleCalendar.accessToken': tokens.access_token,
          'googleCalendar.expiresAt': expiryDate
        }).catch(err => console.error('Error updating access token:', err));
      }
    });
  }

  // Check if token is expired or about to expire (refresh 5 minutes before expiry)
  const now = new Date();
  const expiresAt = user.googleCalendar.expiresAt ? new Date(user.googleCalendar.expiresAt) : null;
  const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

  // If token is expired or will expire within 5 minutes, refresh it proactively
  if (!expiresAt || (expiresAt.getTime() - now.getTime()) < REFRESH_BUFFER_MS) {
    try {
      console.log('Access token expired or expiring soon, refreshing...');
      const refreshedTokens = await refreshAccessToken(oauthClient);

      // Update the user's access token in the database
      const updateData = {
        'googleCalendar.accessToken': refreshedTokens.accessToken,
        'googleCalendar.expiresAt': refreshedTokens.expiryDate
      };

      // If updateUserCallback is provided, use it (for updating in database)
      if (updateUserCallback && typeof updateUserCallback === 'function') {
        await updateUserCallback(user._id, updateData);
      }

      // Update the local user object to reflect the new token
      user.googleCalendar.accessToken = refreshedTokens.accessToken;
      user.googleCalendar.expiresAt = refreshedTokens.expiryDate;

      // Recreate OAuth client with new token (event listener will be set up again)
      oauthClient = createOAuthClient(
        refreshedTokens.accessToken,
        user.googleCalendar.refreshToken
      );

      // Set up event listener again on the new client
      if (updateUserCallback && typeof updateUserCallback === 'function') {
        oauthClient.on('tokens', (tokens) => {
          if (tokens.refresh_token) {
            updateUserCallback(user._id, {
              'googleCalendar.refreshToken': tokens.refresh_token
            }).catch(err => console.error('Error updating refresh token:', err));
          }
          if (tokens.access_token) {
            const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
            updateUserCallback(user._id, {
              'googleCalendar.accessToken': tokens.access_token,
              'googleCalendar.expiresAt': expiryDate
            }).catch(err => console.error('Error updating access token:', err));
          }
        });
      }

      console.log('Access token refreshed successfully');
    } catch (refreshError) {
      console.error('Error refreshing access token:', refreshError);
      
      // If refresh fails, throw error so caller can handle it
      // The OAuth client is still returned, but the token might be invalid
      // The Google OAuth2 client library might still try to refresh it automatically during API calls
      throw new Error(`Failed to refresh access token: ${refreshError.message}`);
    }
  }

  return oauthClient;
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
  getValidOAuthClient,
  createCalendarEvent,
  generateMeetLink,
  getRandomIcebreaker
};
