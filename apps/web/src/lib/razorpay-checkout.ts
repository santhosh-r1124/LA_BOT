/**
 * Razorpay Standard Checkout (Phase 10). Loads the gateway's hosted
 * checkout.js on first use and wraps its callback API in a promise.
 *
 * The success payload is NOT proof of payment — anyone can call the handler
 * from devtools. It's forwarded to the API, which verifies the HMAC
 * signature server-side (app/services/payments/razorpay_gateway.py) before
 * marking anything paid.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: { description?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', callback: (response: RazorpayFailure) => void): void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loader: Promise<RazorpayConstructor> | null = null;

function loadCheckout(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () =>
        window.Razorpay
          ? resolve(window.Razorpay)
          : reject(new Error('The payment window failed to initialise.'));
      script.onerror = () => {
        loader = null; // allow a retry after a network blip
        reject(new Error('Could not load the payment window. Check your connection.'));
      };
      document.body.appendChild(script);
    });
  }
  return loader;
}

export async function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  description: string;
  email?: string;
}): Promise<RazorpaySuccess> {
  const Razorpay = await loadCheckout();
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountMinor,
      currency: options.currency,
      name: 'Legal Advisor',
      description: options.description,
      prefill: options.email ? { email: options.email } : undefined,
      handler: (response: RazorpaySuccess) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment window closed before completing.')) },
    });
    checkout.on('payment.failed', (response) =>
      reject(new Error(response.error?.description || 'The payment failed.')),
    );
    checkout.open();
  });
}
