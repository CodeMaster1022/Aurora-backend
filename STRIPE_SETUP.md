# Stripe Setup Guide

To enable the donation feature, you need to configure Stripe in your backend.

## Steps to Set Up Stripe

### 1. Get Your Stripe API Keys

1. Sign up for a Stripe account at https://stripe.com (if you don't have one)
2. Navigate to the [Stripe Dashboard](https://dashboard.stripe.com)
3. Go to **Developers** → **API keys**
4. Copy your **Secret key** (starts with `sk_test_` for test mode or `sk_live_` for production)

### 2. Add Stripe Key to Environment Variables

Add the following line to your `.env` file in the `backend` directory:

```env
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
```

**For Development/Testing:**
- Use test mode keys (start with `sk_test_`)
- Test card numbers are available in the Stripe dashboard önder "Test data"

**For Production:**
- Use live mode keys (start with `sk_live_`)
- Make sure to keep these keys secure and never commit them to version control

### 3. Restart Your Server

After adding the environment variable, restart your backend server:

```bash
cd backend
npm run dev
# or
npm start
```

## Test Mode Card Numbers

When using test mode, you can use these test card numbers:

- **Success:** `4242 4242 4242 4242`
- **Requires authentication:** `4000 0025 0000 3155`
- **Declined:** `4000 0000 0000 0002`

Use any future expiration date, any 3-digit CVC, and any postal code.

## Troubleshooting

### Error: "Stripe is not configured"

- Make sure you've added `STRIPE_SECRET_KEY` to your `.env` file
- Verify the `.env` file is in the `backend` directory
- Restart your server after adding the environment variable
- Check that `dotenv` is properly configured in `server.js` (it should be: `require('dotenv').config()`)

### Error: "Invalid API Key"

- Verify you copied the entire secret key (it should start with `sk_test_` or `sk_live Crisis`)
- Make sure there are no extra spaces or quotes around the key in your `.env` file
- For test mode, ensure you're using a test mode key, not a live mode key

## Additional Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Test Cards](https://stripe.com/docs/testing)

