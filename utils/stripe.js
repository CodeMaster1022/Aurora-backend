// Stripe utility functions
// Note: Install Stripe SDK with: npm install stripe

let stripe = null;

const initializeStripe = () => {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

/**
 * Create a Stripe checkout session for donations
 * @param {Object} params - Checkout session parameters
 * @param {string} params.customerEmail - Email of the donor
 * @param {number} params.amount - Donation amount in smallest currency unit (e.g., cents)
 * @param {string} params.successUrl - URL to redirect after successful payment
 * @param {string} params.cancelUrl - URL to redirect if payment is cancelled
 * @returns {Promise<Object>} Checkout session object
 */
const createDonationCheckout = async ({
  customerEmail,
  amount = 500, // Default $5.00
  successUrl,
  cancelUrl
}) => {
  try {
    const stripeInstance = initializeStripe();
    
    if (!stripeInstance) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY in environment variables.');
    }

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Donation to Aurora',
              description: 'Thank you for supporting Aurora and helping others learn English!'
            },
            unit_amount: amount, // Amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'donation',
        platform: 'Aurora'
      }
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url
    };
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  initializeStripe,
  createDonationCheckout
};

